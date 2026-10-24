import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { canUseFeature, entitledPlatformIds, hasPlatformCapability, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { TEAM_ADD_MEMBER_SCHEMA, TEAM_REMOVE_MEMBER_SCHEMA, TEAM_ROLES, TEAM_UPDATE_MEMBER_SCHEMA, addTeamConfirmation, removeTeamConfirmation, updateTeamConfirmation, type TeamActor, type TeamMemberAddInput, type TeamMemberRemoveInput, type TeamMemberUpdateInput, type TeamRole } from '../team';

export type { TeamActor, TeamRole, TeamMemberAddInput, TeamMemberUpdateInput, TeamMemberRemoveInput } from '../team';
export { TEAM_ROLES, TEAM_ADD_MEMBER_SCHEMA, TEAM_UPDATE_MEMBER_SCHEMA, TEAM_REMOVE_MEMBER_SCHEMA, addTeamConfirmation, updateTeamConfirmation, removeTeamConfirmation } from '../team';

const invalid = () => new OperationError('invalid_request', 'Choose valid team member details and confirm the exact action.');
const unavailable = () => new OperationError('unavailable', 'Team settings are temporarily unavailable. Try again later.');
const missing = () => new OperationError('not_found', 'This team member or destination is unavailable in the current workspace.');
const forbidden = () => new OperationError('forbidden', 'Team management is unavailable in this workspace.');
async function protect<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; }
  catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError('upstream_failure', 'The team operation could not be confirmed. Refresh the directory before trying again.');
  }
}

function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
async function limits() {
  try {
    const [maxMembers, maxChannels, timeout, maxWait, workspaceTimeout] = await Promise.all([
      runtimeConfig('settings.teamMaxMembers'), runtimeConfig('settings.teamMaxChannels'),
      runtimeConfig('settings.teamOperationTimeoutMs'), runtimeConfig('settings.teamOperationMaxWaitMs'), runtimeConfig('data.workspaceOperationTimeoutMs'),
    ]);
    if (![maxMembers, maxChannels, timeout, maxWait, workspaceTimeout].every(positive) || timeout + maxWait >= workspaceTimeout) throw unavailable();
    return { maxMembers, maxChannels, timeout, maxWait };
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw unavailable();
  }
}

async function authorize(actor: TeamActor, write: boolean) {
  if (!actor || typeof actor.userId !== 'string' || !actor.userId || typeof actor.workspaceId !== 'string' || !actor.workspaceId) throw new OperationError('unauthorized', 'Sign in with an active workspace account.');
  let user, entitlements, permissions;
  try {
    [user, entitlements, permissions] = await Promise.all([
      prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } }),
      loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
      loadPermissions(actor.userId, actor.workspaceId),
    ]);
  } catch { throw unavailable(); }
  if (!user || user.disabledAt) throw new OperationError('unauthorized', 'Sign in with an active account to manage the team.');
  if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, 'settings/team') ||
      !permissions || !canAccessFeature(permissions, 'settings/team', write ? 'write' : 'read')) throw forbidden();
  const memberships = await prisma.membership.findFirst({ where: { userId: actor.userId, workspaceId: actor.workspaceId }, select: { role: true } });
  if (!memberships) throw new OperationError('unauthorized', 'You are no longer a member of this workspace.');
  if (memberships.role !== 'owner' && memberships.role !== 'admin') throw forbidden();
  return { role: memberships.role, entitlements, permissions };
}

async function recheck(tx: Prisma.TransactionClient, actor: TeamActor, write: boolean) {
  const rows = await tx.$queryRaw<Array<{ userId: string; role: string; disabledAt: Date | null }>>`
    SELECT m."userId", m.role::text AS role, u."disabledAt"
    FROM memberships m JOIN users u ON u.id = m."userId"
    WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId}
    FOR UPDATE OF m`;
  const current = rows[0];
  if (!current || current.disabledAt) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
  if (current.role !== 'owner' && current.role !== 'admin') throw forbidden();
  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, 'settings/team') || !permissions || !canAccessFeature(permissions, 'settings/team', write ? 'write' : 'read')) throw forbidden();
  return { role: current.role, entitlements, permissions };
}

async function lockUsers(tx: Prisma.TransactionClient, ids: readonly string[], allowDisabled: readonly string[] = []) {
  for (const id of [...new Set(ids)].sort()) {
    const rows = await tx.$queryRaw<Array<{ id: string; disabledAt: Date | null }>>`SELECT id, "disabledAt" FROM users WHERE id = ${id} FOR SHARE`;
    if (!rows[0] || (rows[0].disabledAt && !allowDisabled.includes(id))) throw new OperationError('conflict', 'An account involved in this change is disabled or unavailable.');
  }
}

async function lockOwnerUsers(tx: Prisma.TransactionClient, workspaceId: string) {
  const rows = await tx.$queryRaw<Array<{ userId: string }>>`SELECT "userId" FROM memberships WHERE "workspaceId" = ${workspaceId} AND role::text = 'owner' ORDER BY "userId"`;
  for (const row of rows) await tx.$queryRaw`SELECT id FROM users WHERE id = ${row.userId} FOR SHARE`;
}

async function checkTargetScope(tx: Prisma.TransactionClient, actor: TeamActor, entitlements: Awaited<ReturnType<typeof loadEntitlements>>, ids: readonly string[], maxChannels: number) {
  if (ids.length > maxChannels) throw new OperationError('invalid_request', 'Choose fewer destinations for this team member.');
  if (!ids.length) return;
  const rows = await tx.target.findMany({ where: { workspaceId: actor.workspaceId, id: { in: [...ids] }, enabled: true }, select: { id: true, socialAccount: { select: { workspaceId: true, provider: true, invalidatedAt: true } } } });
  if (rows.length !== ids.length || rows.some(row => !row.socialAccount || row.socialAccount.workspaceId !== actor.workspaceId || row.socialAccount.invalidatedAt || !entitlements || !hasPlatformCapability(entitlements, row.socialAccount.provider))) throw missing();
}

async function audit(tx: Prisma.TransactionClient, actor: TeamActor, action: string, detail: object) {
  await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
}

async function assertOwnerInvariant(tx: Prisma.TransactionClient, workspaceId: string, membershipId: string, nextRole?: TeamRole, currentDisabledAt?: Date | null) {
  const current = await tx.$queryRaw<Array<{ role: string }>>`SELECT role::text AS role FROM memberships WHERE id = ${membershipId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
  if (!current[0]) throw missing();
  if (current[0].role === 'owner' && nextRole !== 'owner' && !currentDisabledAt) {
    await lockOwnerUsers(tx, workspaceId);
    const owners = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${workspaceId} AND m.role::text = 'owner' AND u."disabledAt" IS NULL`;
    if (Number(owners[0]?.count ?? 0) <= 1) throw new OperationError('conflict', 'A workspace must keep at least one active owner.');
  }
}

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
}
function validateConfirmation(actual: string, expected: string) { if (actual !== expected) throw invalid(); }
function requireRole(value: string): asserts value is TeamRole { if (!TEAM_ROLES.includes(value as TeamRole)) throw invalid(); }
function requireFullScope(role: TeamRole, allPages: boolean) { if ((role === 'owner' || role === 'admin') && !allPages) throw new OperationError('invalid_request', 'Workspace owners and admins must have access to all destinations.'); }

export async function addTeamMember(actor: TeamActor, input: unknown) {
  const value = parse<TeamMemberAddInput>(TEAM_ADD_MEMBER_SCHEMA, input);
  validateConfirmation(value.confirmation, addTeamConfirmation(value.email));
  requireRole(value.role); requireFullScope(value.role, value.allPages);
  const bounds = await limits();
  if (value.targetIds.length > bounds.maxChannels) throw new OperationError('invalid_request', 'Choose fewer destinations for this team member.');
  await authorize(actor, true);
  return protect(withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))::text`;
    const current = await recheck(tx, actor, true);
    const count = await tx.membership.count({ where: { workspaceId: actor.workspaceId } });
    if (count >= bounds.maxMembers) throw new OperationError('conflict', 'This workspace has reached its team member limit.');
    const user = await tx.user.findUnique({ where: { email: value.email }, select: { id: true, name: true, disabledAt: true } });
    if (!user || user.disabledAt) throw new OperationError('not_found', 'No active account matches that email. Check the address with the person you want to add.');
    await lockUsers(tx, [actor.userId, user.id]);
    if (value.role === 'owner' && current.role !== 'owner') throw forbidden();
    const existing = await tx.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId: actor.workspaceId } }, select: { id: true } });
    if (existing) throw new OperationError('conflict', 'This person is already a workspace member.');
    await checkTargetScope(tx, actor, current.entitlements, value.targetIds, bounds.maxChannels);
    await recheck(tx, actor, true);
    const id = randomUUID();
    await tx.membership.create({ data: { id, userId: user.id, workspaceId: actor.workspaceId, role: value.role } });
    await tx.$executeRaw`UPDATE memberships SET "allPages" = ${value.allPages} WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId}`;
    if (value.targetIds.length) await tx.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") SELECT ${id}, target_id FROM UNNEST(${value.targetIds}::text[]) AS target_id`;
    await audit(tx, actor, 'team.member_added', { membershipId: id, userId: user.id, role: value.role, allPages: value.allPages, targetIds: value.targetIds });
    await recheck(tx, actor, true);
    return { id, added: true as const };
  }, { timeout: bounds.timeout, maxWait: bounds.maxWait })));
}

async function lockedMember(tx: Prisma.TransactionClient, actor: TeamActor, membershipId: string, allowDisabled = false) {
  const rows = await tx.$queryRaw<Array<{ id: string; userId: string; role: string; disabledAt: Date | null }>>`
    SELECT m.id, m."userId", m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId"
    WHERE m.id = ${membershipId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m`;
  if (!rows[0]) throw missing();
  if (rows[0].disabledAt && !allowDisabled) throw new OperationError('conflict', 'This member account is disabled.');
  return rows[0];
}

export async function updateTeamMember(actor: TeamActor, input: unknown) {
  const value = parse<TeamMemberUpdateInput>(TEAM_UPDATE_MEMBER_SCHEMA, input);
  validateConfirmation(value.confirmation, updateTeamConfirmation(value.membershipId));
  requireRole(value.role); requireFullScope(value.role, value.allPages);
  const bounds = await limits();
  if (value.targetIds.length > bounds.maxChannels) throw new OperationError('invalid_request', 'Choose fewer destinations for this team member.');
  await authorize(actor, true);
  return protect(withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))::text`;
    const current = await recheck(tx, actor, true);
    const member = await lockedMember(tx, actor, value.membershipId);
    await lockUsers(tx, [actor.userId, member.userId]);
    if (member.role === 'owner' && current.role !== 'owner') throw forbidden();
    if (value.role === 'owner' && current.role !== 'owner') throw forbidden();
    if (member.userId === actor.userId && member.role !== value.role) throw new OperationError('conflict', 'You cannot change your own role.');
    if (member.role === 'owner' && value.role !== 'owner' && !member.disabledAt) await lockOwnerUsers(tx, actor.workspaceId);
    await recheck(tx, actor, true);
    await assertOwnerInvariant(tx, actor.workspaceId, member.id, value.role, member.disabledAt);
    await checkTargetScope(tx, actor, current.entitlements, value.targetIds, bounds.maxChannels);
    await tx.membership.update({ where: { id: member.id }, data: { role: value.role } });
    await tx.$executeRaw`DELETE FROM member_page_access WHERE "membershipId" = ${member.id}`;
    await tx.$executeRaw`UPDATE memberships SET "allPages" = ${value.allPages} WHERE id = ${member.id} AND "workspaceId" = ${actor.workspaceId}`;
    if (value.targetIds.length) await tx.$executeRaw`INSERT INTO member_page_access ("membershipId", "targetId") SELECT ${member.id}, target_id FROM UNNEST(${value.targetIds}::text[]) AS target_id`;
    await audit(tx, actor, 'team.member_updated', { membershipId: member.id, userId: member.userId, previousRole: member.role, role: value.role, allPages: value.allPages, targetIds: value.targetIds });
    await recheck(tx, actor, true);
    return { id: member.id, updated: true as const };
  }, { timeout: bounds.timeout, maxWait: bounds.maxWait })));
}

export async function removeTeamMember(actor: TeamActor, input: unknown) {
  const value = parse<TeamMemberRemoveInput>(TEAM_REMOVE_MEMBER_SCHEMA, input);
  validateConfirmation(value.confirmation, removeTeamConfirmation(value.membershipId));
  const bounds = await limits();
  await authorize(actor, true);
  return protect(withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.workspaceId}))::text`;
    const current = await recheck(tx, actor, true);
    const member = await lockedMember(tx, actor, value.membershipId, true);
    await lockUsers(tx, [actor.userId, member.userId], [member.disabledAt ? member.userId : '']);
    if (member.role === 'owner' && current.role !== 'owner') throw forbidden();
    if (member.userId === actor.userId) throw new OperationError('conflict', 'You cannot remove your own workspace access.');
    if (member.role === 'owner' && !member.disabledAt) await lockOwnerUsers(tx, actor.workspaceId);
    await recheck(tx, actor, true);
    await assertOwnerInvariant(tx, actor.workspaceId, member.id, undefined, member.disabledAt);
    await audit(tx, actor, 'team.member_removed', { membershipId: member.id, userId: member.userId, role: member.role });
    await tx.membership.delete({ where: { id: member.id } });
    await recheck(tx, actor, true);
    return { id: member.id, removed: true as const };
  }, { timeout: bounds.timeout, maxWait: bounds.maxWait })));
}

export type TeamDirectoryMember = { id: string; userId: string; role: string; name: string; email: string; allPages: boolean; targetIds: string[] };
export type TeamDirectoryTarget = { id: string; name: string; type: string };
export type TeamDirectory = { members: TeamDirectoryMember[]; targets: TeamDirectoryTarget[]; actorRole: string; actorId: string; total: number; hasMore: boolean; defaults: { role: string; allPages: boolean } };

export async function getTeamDirectory(actor: TeamActor, options: { maxMembers?: number } = {}): Promise<TeamDirectory> {
  const bounds = await limits();
  const [defaultRole, defaultAllPages] = await Promise.all([runtimeConfig('settings.teamDefaultRole'), runtimeConfig('settings.teamDefaultAllChannels')]);
  if (options.maxMembers !== undefined && (!Number.isSafeInteger(options.maxMembers) || options.maxMembers < 1 || options.maxMembers > bounds.maxMembers)) throw invalid();
  const auth = await authorize(actor, false);
  return protect(withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
    await recheck(tx, actor, false);
    const total = await tx.membership.count({ where: { workspaceId: actor.workspaceId } });
    if (total > bounds.maxMembers) throw unavailable();
    const limit = options.maxMembers ?? bounds.maxMembers;
    const rows = await tx.$queryRaw<Array<{ id: string; userId: string; role: string; name: string; email: string; allPages: boolean | null }>>`
      SELECT m.id, m."userId", m.role::text AS role, u.name, u.email, m."allPages" AS "allPages"
      FROM memberships m JOIN users u ON u.id = m."userId"
      WHERE m."workspaceId" = ${actor.workspaceId}
      ORDER BY CASE m.role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name, m.id LIMIT ${limit + 1}`;
    if (options.maxMembers === undefined && rows.length > limit) throw unavailable();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const scopeRows = page.length ? await tx.$queryRaw<Array<{ membershipId: string; targetId: string; rowNumber: bigint | number; rowCount: bigint | number }>>`
      WITH distinct_scope AS (
        SELECT DISTINCT access."membershipId", access."targetId"
        FROM member_page_access access JOIN memberships m ON m.id = access."membershipId" AND m."workspaceId" = ${actor.workspaceId}
        JOIN targets t ON t.id = access."targetId" AND t."workspaceId" = ${actor.workspaceId}
        WHERE access."membershipId" = ANY(${page.map(row => row.id)}::text[])
      ), ranked AS (
        SELECT "membershipId", "targetId", ROW_NUMBER() OVER (PARTITION BY "membershipId" ORDER BY "targetId") AS "rowNumber",
          COUNT(*) OVER (PARTITION BY "membershipId") AS "rowCount"
        FROM distinct_scope
      ) SELECT "membershipId", "targetId", "rowNumber", "rowCount" FROM ranked
      WHERE "rowNumber" <= ${bounds.maxChannels + 1} ORDER BY "membershipId", "targetId"` : [];
    if (scopeRows.some(row => Number(row.rowCount) > bounds.maxChannels)) throw unavailable();
    const scopeByMembership = new Map<string, string[]>();
    for (const row of scopeRows) {
      const scoped = scopeByMembership.get(row.membershipId) ?? [];
      scoped.push(row.targetId);
      scopeByMembership.set(row.membershipId, scoped);
    }
    const members = page.map(row => ({ id: row.id, userId: row.userId, role: row.role, name: row.name, email: row.email,
      allPages: row.role === 'owner' || row.role === 'admin' || row.allPages === true,
      targetIds: row.role === 'owner' || row.role === 'admin' ? [] : scopeByMembership.get(row.id) ?? [],
    }));
    const providers = entitledPlatformIds(auth.entitlements);
    const availableTargets = providers.length ? await tx.target.findMany({
      where: { workspaceId: actor.workspaceId, enabled: true, socialAccount: { is: { workspaceId: actor.workspaceId, provider: { in: providers }, invalidatedAt: null } } },
      select: { id: true, name: true, type: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: bounds.maxChannels + 1,
    }) : [];
    if (availableTargets.length > bounds.maxChannels) throw unavailable();
    const targets = availableTargets;
    await recheck(tx, actor, false);
    return { members, targets, actorRole: auth.role, actorId: actor.userId, total, hasMore, defaults: { role: defaultRole, allPages: defaultAllPages } };
  }, { timeout: bounds.timeout, maxWait: bounds.maxWait })));
}
