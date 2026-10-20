import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/client';
import { lockRootActor } from '@/server/root/legacy/authz';
import { writeRootAudit } from '@/server/root/legacy/audit';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { accountPasswordPolicy, validateNewPassword } from '@/server/account-settings';
import { hashLegacyPassword } from '@/server/auth';
import { needsTwoStepEnrollment } from '@/server/auth-policy';
import { mailReady, publicMailOrigin, sendTransactionalMail } from '@/server/mail';
import { TEAM_ROLES, TEAM_INVITE_SCHEMA, TEAM_INVITATION_REGISTRATION_SCHEMA, TEAM_INVITATION_REVOKE_SCHEMA, inviteTeamConfirmation, revokeTeamInvitationConfirmation, type InvitationStatus, type TeamActor, type TeamRole } from '../invitations';

export { TEAM_ROLES, TEAM_INVITE_SCHEMA, TEAM_INVITATION_REGISTRATION_SCHEMA, TEAM_INVITATION_REVOKE_SCHEMA, inviteTeamConfirmation, revokeTeamInvitationConfirmation } from '../invitations';
export type { TeamActor, TeamRole } from '../invitations';

type InviteRow = { id: string; workspaceId: string; email: string; role: string; tokenHash: string; invitedById: string; expiresAt: Date; acceptedAt: Date | null; acceptedByUserId: string | null; createdAt: Date; workspaceName?: string; inviterRole?: string; inviterDisabledAt?: Date | null };
type Tx = Prisma.TransactionClient;
const invalid = () => new OperationError('invalid_request', 'Choose valid invitation details and confirm the exact action.');
const unavailable = () => new OperationError('unavailable', 'Workspace invitations are temporarily unavailable. Try again later.');
const forbidden = () => new OperationError('forbidden', 'Workspace invitations are unavailable with your current access.');
const conflict = (message = 'This invitation is no longer available. Ask a workspace owner or admin for a new invitation.') => new OperationError('conflict', message);

async function protect<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; }
  catch (error) { if (error instanceof OperationError) throw error; throw new OperationError('upstream_failure', 'The invitation operation could not be confirmed. Refresh and check its current state before trying again.'); }
}
function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, input: unknown): T {
  const result = schema.safeParse(input); if (!result.success) throw invalid(); return result.data;
}
function hashToken(token: string) { return createHash('sha256').update(token, 'utf8').digest('hex'); }
function validToken(token: unknown): token is string {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const decoded = Buffer.from(token, 'base64url'); return decoded.length === 32 && decoded.toString('base64url') === token;
}
function htmlEscape(value: string) { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }
function validPublicOrigin(value: string) {
  try { const parsed = new URL(value); return parsed.origin === value && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && parsed.hostname === 'localhost')); }
  catch { return false; }
}
function role(value: string): value is TeamRole { return (TEAM_ROLES as readonly string[]).includes(value); }
function assertRole(value: string): asserts value is TeamRole { if (!role(value)) throw conflict(); }
function invitationStatus(row: Pick<InviteRow, 'acceptedAt' | 'expiresAt'>, now = new Date()): InvitationStatus {
  if (row.acceptedAt) return 'accepted'; return row.expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending';
}
/** Operator directory expression; alias `i`. State rules stay owned by Settings. */
export const invitationStatusSql = Prisma.sql`CASE WHEN i."acceptedAt" IS NOT NULL THEN 'accepted' WHEN i."expiresAt" <= NOW() THEN 'expired' ELSE 'pending' END`;

function requireConfirmation(actual: string, expected: string) { if (actual !== expected) throw invalid(); }

async function invitationLimits() {
  try {
    const [enabled, ttlHours, maxPending, pageLimit, sessionMinutes, maxMembers, timeout, maxWait, workspaceTimeout] = await Promise.all([
      runtimeConfig('settings.invitationsEnabled'), runtimeConfig('settings.invitationTtlHours'), runtimeConfig('settings.invitationMaxPending'),
      runtimeConfig('settings.invitationPageLimit'), runtimeConfig('settings.invitationSessionMinutes'), runtimeConfig('settings.teamMaxMembers'),
      runtimeConfig('settings.teamOperationTimeoutMs'), runtimeConfig('settings.teamOperationMaxWaitMs'), runtimeConfig('data.workspaceOperationTimeoutMs'),
    ]);
    if (typeof enabled !== 'boolean' || ![ttlHours, maxPending, pageLimit, sessionMinutes, maxMembers, timeout, maxWait, workspaceTimeout].every(value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0) || (timeout as number) + (maxWait as number) >= (workspaceTimeout as number)) throw unavailable();
    return { enabled, ttlHours: ttlHours as number, maxPending: maxPending as number, pageLimit: pageLimit as number, sessionMinutes: sessionMinutes as number, maxMembers: maxMembers as number, timeout: timeout as number, maxWait: maxWait as number };
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}

async function authorize(actor: TeamActor, write: boolean) {
  if (!actor || typeof actor.userId !== 'string' || !actor.userId || typeof actor.workspaceId !== 'string' || !actor.workspaceId) throw new OperationError('unauthorized', 'Sign in with an active workspace account.');
  let user, entitlements, permissions;
  try {
    [user, entitlements, permissions] = await Promise.all([
      prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } }),
      loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId),
    ]);
  } catch { throw unavailable(); }
  if (!user || user.disabledAt) throw new OperationError('unauthorized', 'Sign in with an active account to manage invitations.');
  if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, 'settings/team') || !permissions || !canAccessFeature(permissions, 'settings/team', write ? 'write' : 'read')) throw forbidden();
  const membership = await prisma.membership.findFirst({ where: { userId: actor.userId, workspaceId: actor.workspaceId }, select: { role: true } });
  if (!membership) throw new OperationError('unauthorized', 'You are no longer a member of this workspace.');
  if (membership.role !== 'owner' && membership.role !== 'admin') throw forbidden();
  return { role: membership.role };
}

async function lockAndRecheckActor(tx: Tx, actor: TeamActor, write = true) {
  const rows = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
  const current = rows[0];
  if (!current || current.disabledAt) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
  if (current.role !== 'owner' && current.role !== 'admin') throw forbidden();
  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, 'settings/team') || !permissions || !canAccessFeature(permissions, 'settings/team', write ? 'write' : 'read')) throw forbidden();
  return current;
}

async function transaction<T>(workspaceId: string, bounds: Awaited<ReturnType<typeof invitationLimits>>, operation: (tx: Tx) => Promise<T>) {
  return withWorkspaceOperation(workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))::text`;
    return operation(tx);
  }, { timeout: bounds.timeout, maxWait: bounds.maxWait }));
}

async function audit(tx: Tx, workspaceId: string, actorId: string, action: string, detail: object) {
  await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${workspaceId}, ${actorId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}

async function loadInviteByHash(token: string): Promise<InviteRow | null> {
  const rows = await prisma.$queryRaw<InviteRow[]>`SELECT i.id, i."workspaceId", i.email, i.role::text AS role, i."tokenHash", i."invitedById", i."expiresAt", i."acceptedAt", i."acceptedByUserId", i."createdAt", w.name AS "workspaceName", m.role::text AS "inviterRole", u."disabledAt" AS "inviterDisabledAt" FROM invitations i JOIN workspaces w ON w.id = i."workspaceId" LEFT JOIN memberships m ON m."userId" = i."invitedById" AND m."workspaceId" = i."workspaceId" LEFT JOIN users u ON u.id = i."invitedById" WHERE i."tokenHash" = ${hashToken(token)} LIMIT 1`;
  return rows[0] ?? null;
}
async function lockedInvite(tx: Tx, token: string): Promise<InviteRow | null> {
  const rows = await tx.$queryRaw<InviteRow[]>`SELECT i.id, i."workspaceId", i.email, i.role::text AS role, i."tokenHash", i."invitedById", i."expiresAt", i."acceptedAt", i."acceptedByUserId", i."createdAt", w.name AS "workspaceName" FROM invitations i JOIN workspaces w ON w.id = i."workspaceId" WHERE i."tokenHash" = ${hashToken(token)} FOR UPDATE OF i`;
  return rows[0] ?? null;
}

async function validateCurrentInviter(invite: InviteRow, tx?: Tx) {
  const inviter = tx
    ? (await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${invite.invitedById} AND m."workspaceId" = ${invite.workspaceId} FOR SHARE OF m, u`)[0]
    : (await prisma.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${invite.invitedById} AND m."workspaceId" = ${invite.workspaceId}`)[0];
  if (!inviter || inviter.disabledAt || (inviter.role !== 'owner' && inviter.role !== 'admin') || (invite.role === 'owner' && inviter.role !== 'owner')) throw conflict();
  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(invite.invitedById, invite.workspaceId, { allowInstallationInspection: false }), loadPermissions(invite.invitedById, invite.workspaceId),
  ]);
  if (!entitlements || entitlements.workspaceId !== invite.workspaceId || !canUseFeature(entitlements, 'settings/team') || !permissions || !canAccessFeature(permissions, 'settings/team', 'write')) throw conflict();
}

function requireUsableInvite(invite: InviteRow | null, now = new Date()): asserts invite is InviteRow {
  if (!invite || !role(invite.role) || invite.acceptedAt || invite.expiresAt.getTime() <= now.getTime()) throw conflict();
}

export async function invitationAvailability(): Promise<boolean> {
  try {
    const bounds = await invitationLimits();
    if (!bounds.enabled) return false;
    const [ready, origin] = await Promise.all([mailReady(), publicMailOrigin()]);
    return ready && validPublicOrigin(origin);
  } catch { return false; }
}

export async function listTeamInvitations(actor: TeamActor): Promise<{ invitations: Array<{ id: string; email: string; role: TeamRole; expiresAt: Date; acceptedAt: Date | null; createdAt: Date; status: InvitationStatus }>; available: boolean }> {
  const bounds = await invitationLimits(); await authorize(actor, false);
  return protect(transaction(actor.workspaceId, bounds, async tx => {
    await lockAndRecheckActor(tx, actor, false);
    const rows = await tx.$queryRaw<InviteRow[]>`SELECT id, "workspaceId", email, role::text AS role, "tokenHash", "invitedById", "expiresAt", "acceptedAt", "acceptedByUserId", "createdAt" FROM invitations WHERE "workspaceId" = ${actor.workspaceId} ORDER BY "createdAt" DESC, id DESC LIMIT ${bounds.pageLimit + 1}`;
    if (rows.length > bounds.pageLimit) throw new OperationError('conflict', 'This invitation list exceeds the configured limit. Contact a workspace owner to reduce it before viewing.');
    const [ready, origin] = await Promise.all([mailReady(), publicMailOrigin().catch(() => '')]);
    return { invitations: rows.map(row => {
      if (!role(row.role)) throw unavailable();
      return { id: row.id, email: row.email, role: row.role, expiresAt: row.expiresAt, acceptedAt: row.acceptedAt, createdAt: row.createdAt, status: invitationStatus(row) };
    }), available: bounds.enabled && ready && validPublicOrigin(origin) };
  }));
}

export async function inviteTeamMember(actor: TeamActor, input: unknown): Promise<{ id: string; delivery: 'sent' | 'failed' | 'unavailable' | 'uncertain'; expiresAt: Date }> {
  const value = parse(TEAM_INVITE_SCHEMA, input); requireConfirmation(value.confirmation, inviteTeamConfirmation(value.email));
  const bounds = await invitationLimits(); if (!bounds.enabled) throw forbidden();
  const [ready, origin] = await Promise.all([mailReady(), publicMailOrigin().catch(() => '')]);
  if (!ready || !validPublicOrigin(origin)) throw unavailable();
  const current = await authorize(actor, true); if (value.role === 'owner' && current.role !== 'owner') throw forbidden();
  let token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const created = await protect(transaction(actor.workspaceId, bounds, async tx => {
    const actorState = await lockAndRecheckActor(tx, actor, true);
    if (value.role === 'owner' && actorState.role !== 'owner') throw forbidden();
    const existingUser = await tx.user.findUnique({ where: { email: value.email }, select: { id: true } });
    if (existingUser && await tx.membership.findUnique({ where: { userId_workspaceId: { userId: existingUser.id, workspaceId: actor.workspaceId } }, select: { id: true } })) throw new OperationError('conflict', 'This person is already a member of the workspace.');
    const found = await tx.$queryRaw<Array<{ id: string; role: string; acceptedAt: Date | null; expiresAt: Date }>>`SELECT id, role::text AS role, "acceptedAt", "expiresAt" FROM invitations WHERE "workspaceId" = ${actor.workspaceId} AND email = ${value.email} FOR UPDATE`;
    if (found[0]?.role === 'owner' && actorState.role !== 'owner') throw forbidden();
    if (found[0]?.acceptedAt) throw new OperationError('conflict', 'This address already accepted a workspace invitation.');
    const pending = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM invitations WHERE "workspaceId" = ${actor.workspaceId} AND "acceptedAt" IS NULL AND "expiresAt" > NOW()`;
    if (Number(pending[0]?.count ?? 0) >= bounds.maxPending && (!found[0] || found[0].expiresAt.getTime() <= Date.now())) throw new OperationError('conflict', 'This workspace has reached its pending invitation limit.');
    const id = found[0]?.id ?? randomUUID();
    const expiresAt = new Date(Date.now() + bounds.ttlHours * 3600000);
    if (found[0]) await tx.$executeRaw`UPDATE invitations SET role = ${value.role}::"WorkspaceRole", "tokenHash" = ${tokenHash}, "invitedById" = ${actor.userId}, "expiresAt" = ${expiresAt}, "acceptedAt" = NULL, "acceptedByUserId" = NULL, "createdAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    else await tx.$executeRaw`INSERT INTO invitations (id, "workspaceId", email, role, "tokenHash", "invitedById", "expiresAt", "createdAt") VALUES (${id}, ${actor.workspaceId}, ${value.email}, ${value.role}::"WorkspaceRole", ${tokenHash}, ${actor.userId}, ${expiresAt}, NOW())`;
    await audit(tx, actor.workspaceId, actor.userId, found[0] ? 'team.invitation_reissued' : 'team.invitation_created', { invitationId: id, email: value.email, role: value.role, expiresAt });
    await lockAndRecheckActor(tx, actor, true);
    return { id, expiresAt, workspaceName: (await tx.$queryRaw<Array<{ name: string }>>`SELECT name FROM workspaces WHERE id = ${actor.workspaceId}`)[0]?.name ?? 'your workspace' };
  }));
  let delivery: 'sent' | 'failed' | 'unavailable' | 'uncertain';
  try {
    const base = new URL(origin);
    {
      base.pathname = '/join'; base.search = ''; base.hash = token;
      const link = base.toString(); const workspace = created.workspaceName;
      const text = `You have been invited to join ${workspace} as ${value.role}. Open this link to continue: ${link}\n\nThis invitation expires on ${created.expiresAt.toISOString()}. If you were not expecting this email, you can ignore it.`;
      const html = `<p>You have been invited to join ${htmlEscape(workspace)} as ${htmlEscape(value.role)}.</p><p><a href="${htmlEscape(link)}">Review invitation</a></p><p>This invitation expires on ${htmlEscape(created.expiresAt.toISOString())}. If you were not expecting this email, you can ignore it.</p>`;
      delivery = (await sendTransactionalMail({ to: value.email, subject: 'You have a workspace invitation', text, html, template: 'workspace_invitation', workspaceId: actor.workspaceId })).status;
    }
  } catch { delivery = 'unavailable'; }
  token = '';
  try { await transaction(actor.workspaceId, bounds, tx => audit(tx, actor.workspaceId, actor.userId, 'team.invitation_delivery', { invitationId: created.id, delivery })); }
  catch { delivery = 'uncertain'; }
  return { id: created.id, delivery, expiresAt: created.expiresAt };
}

export async function revokeTeamInvitation(actor: TeamActor, input: unknown): Promise<{ id: string; revoked: true }> {
  const value = parse(TEAM_INVITATION_REVOKE_SCHEMA, input); requireConfirmation(value.confirmation, revokeTeamInvitationConfirmation(value.id));
  const bounds = await invitationLimits(); await authorize(actor, true);
  return protect(transaction(actor.workspaceId, bounds, async tx => {
    const current = await lockAndRecheckActor(tx, actor, true);
    const invite = await revokeInvitationRecord(tx, actor.workspaceId, value.id, current.role === 'owner');
    await audit(tx, actor.workspaceId, actor.userId, 'team.invitation_revoked', { invitationId: invite.id, email: invite.email, role: invite.role });
    await lockAndRecheckActor(tx, actor, true);
    return { id: invite.id, revoked: true as const };
  }));
}

/** Shared state transition; both workspace and installation authority use the same locked record. */
async function revokeInvitationRecord(tx: Tx, workspaceId: string, id: string, mayRevokeOwner: boolean) {
  const rows = await tx.$queryRaw<Array<Pick<InviteRow, 'id' | 'workspaceId' | 'email' | 'role' | 'acceptedAt'>>>`SELECT id, "workspaceId", email, role::text AS role, "acceptedAt" FROM invitations WHERE id = ${id} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
  const invite = rows[0];
  if (!invite) throw new OperationError('not_found', 'This invitation is unavailable in the current workspace.');
  if (invite.acceptedAt) throw new OperationError('conflict', 'An accepted invitation cannot be revoked.');
  if (invite.role === 'owner' && !mayRevokeOwner) throw forbidden();
  const removed = await tx.$executeRaw`DELETE FROM invitations WHERE id = ${invite.id} AND "workspaceId" = ${workspaceId} AND "acceptedAt" IS NULL`;
  if (removed !== 1) throw conflict();
  return invite;
}

/** Private installation authority, independent of workspace membership. Suspension/purge guards still apply. */
export async function revokeInstallationInvitation(actorId: string, workspaceId: string, input: unknown) {
  const value = parse(TEAM_INVITATION_REVOKE_SCHEMA, input);
  requireConfirmation(value.confirmation, revokeTeamInvitationConfirmation(value.id));
  const bounds = await invitationLimits();
  return protect(transaction(workspaceId, bounds, async tx => {
    await lockRootActor(tx, actorId);
    const invite = await revokeInvitationRecord(tx, workspaceId, value.id, true);
    await writeRootAudit(tx, actorId, 'root.invitation_revoked', { workspaceId, invitationId: invite.id });
    return { id: invite.id, workspaceId, revoked: true as const };
  }));
}

export async function previewTeamInvitation(rawToken: string): Promise<{ id: string; email: string; role: TeamRole; workspaceId: string; workspaceName: string; expiresAt: Date; existingAccount: boolean }> {
  if (!(await invitationLimits()).enabled) throw forbidden();
  if (!validToken(rawToken)) throw conflict();
  return protect((async () => {
    const invite = await loadInviteByHash(rawToken); requireUsableInvite(invite);
    assertRole(invite.role);
    await validateCurrentInviter(invite);
    const existing = await prisma.user.findUnique({ where: { email: invite.email }, select: { id: true, disabledAt: true } });
    if (existing?.disabledAt) throw conflict('This invitation cannot be used because the matching account is disabled. Contact a workspace owner.');
    return { id: invite.id, email: invite.email, role: invite.role, workspaceId: invite.workspaceId, workspaceName: invite.workspaceName ?? 'Workspace', expiresAt: invite.expiresAt, existingAccount: Boolean(existing) };
  })());
}

export async function acceptTeamInvitation(rawToken: string, userId: string, confirmation: unknown): Promise<{ workspaceId: string; joined: true }> {
  if (!validToken(rawToken) || typeof userId !== 'string' || !userId) throw conflict();
  const bounds = await invitationLimits(); if (!bounds.enabled) throw forbidden();
  const invite = await loadInviteByHash(rawToken); requireUsableInvite(invite);
  requireConfirmation(typeof confirmation === 'string' ? confirmation : '', `ACCEPT INVITATION ${invite.id}`);
  return protect(transaction(invite.workspaceId, bounds, async tx => {
    const locked = await lockedInvite(tx, rawToken); requireUsableInvite(locked);
    await validateCurrentInviter(locked, tx);
    const users = await tx.$queryRaw<Array<{ id: string; email: string; disabledAt: Date | null; isInstanceOwner: boolean; totpEnabledAt: Date | null }>>`SELECT id, email, "disabledAt", "isInstanceOwner", "totpEnabledAt" FROM users WHERE id = ${userId} FOR UPDATE`;
    const user = users[0]; if (!user || user.disabledAt) throw new OperationError('unauthorized', 'Sign in with an active account to accept this invitation.');
    if (user.email.toLowerCase() !== locked.email.toLowerCase()) throw forbidden();
    const [twoStepPolicy, passkeyCount] = await Promise.all([runtimeConfig('security.twoStep'), tx.passkey.count({ where: { userId } })]);
    if (needsTwoStepEnrollment(twoStepPolicy, user.isInstanceOwner, [locked.role]) && !user.totpEnabledAt && passkeyCount === 0) throw new OperationError('forbidden', 'Set up two-step verification before joining this workspace.');
    if (await tx.membership.findUnique({ where: { userId_workspaceId: { userId, workspaceId: locked.workspaceId } }, select: { id: true } })) throw new OperationError('conflict', 'This account is already a member of the invited workspace.');
    const count = await tx.membership.count({ where: { workspaceId: locked.workspaceId } });
    if (count >= bounds.maxMembers) throw new OperationError('conflict', 'This workspace has reached its team member limit.');
    const membershipId = randomUUID();
    await tx.membership.create({ data: { id: membershipId, userId, workspaceId: locked.workspaceId, role: locked.role as TeamRole } });
    await tx.$executeRaw`UPDATE memberships SET "allPages" = ${locked.role === 'admin' || locked.role === 'owner'} WHERE id = ${membershipId} AND "workspaceId" = ${locked.workspaceId}`;
    await tx.$executeRaw`UPDATE invitations SET "acceptedAt" = NOW(), "acceptedByUserId" = ${userId} WHERE id = ${locked.id} AND "tokenHash" = ${hashToken(rawToken)} AND "acceptedAt" IS NULL`;
    await audit(tx, locked.workspaceId, userId, 'team.invitation_accepted', { invitationId: locked.id, membershipId, role: locked.role });
    return { workspaceId: locked.workspaceId, joined: true as const };
  }));
}

export async function registerTeamInvitation(input: unknown): Promise<{ created: true; workspaceId: string }> {
  const value = parse(TEAM_INVITATION_REGISTRATION_SCHEMA, input);
  if (!validToken(value.token)) throw conflict();
  const bounds = await invitationLimits(); if (!bounds.enabled) throw forbidden();
  const invite = await loadInviteByHash(value.token); requireUsableInvite(invite);
  requireConfirmation(value.confirmation, `CREATE ACCOUNT AND JOIN ${invite.id}`);
  await validateCurrentInviter(invite);
  const policy = await accountPasswordPolicy(); if (!validateNewPassword(value.password, policy)) throw new OperationError('invalid_request', `Password must be at least ${policy.minLength} characters and no more than ${policy.maxBytes} bytes.`);
  const passwordHash = hashLegacyPassword(value.password);
  return protect(transaction(invite.workspaceId, bounds, async tx => {
    const locked = await lockedInvite(tx, value.token); requireUsableInvite(locked);
    await validateCurrentInviter(locked, tx);
    const existing = await tx.user.findUnique({ where: { email: locked.email }, select: { id: true } });
    if (existing) throw new OperationError('conflict', 'An account already uses this email. Sign in and accept the invitation from that account.');
    const count = await tx.membership.count({ where: { workspaceId: locked.workspaceId } });
    if (count >= bounds.maxMembers) throw new OperationError('conflict', 'This workspace has reached its team member limit.');
    const userId = randomUUID(); const membershipId = randomUUID();
    await tx.user.create({ data: { id: userId, email: locked.email, name: value.name, passwordHash } });
    await tx.$executeRaw`UPDATE users SET "emailVerifiedAt" = NOW() WHERE id = ${userId}`;
    await tx.membership.create({ data: { id: membershipId, userId, workspaceId: locked.workspaceId, role: locked.role as TeamRole } });
    await tx.$executeRaw`UPDATE memberships SET "allPages" = ${locked.role === 'admin' || locked.role === 'owner'} WHERE id = ${membershipId} AND "workspaceId" = ${locked.workspaceId}`;
    await tx.$executeRaw`UPDATE invitations SET "acceptedAt" = NOW(), "acceptedByUserId" = ${userId} WHERE id = ${locked.id} AND "tokenHash" = ${hashToken(value.token)} AND "acceptedAt" IS NULL`;
    await audit(tx, locked.workspaceId, userId, 'team.invitation_registered', { invitationId: locked.id, membershipId, role: locked.role });
    return { created: true as const, workspaceId: locked.workspaceId };
  }));
}
