import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { prisma, getSessionByTokenHash } from '@/server/data';
import { hashLegacyPassword, isUsableLegacySession, verifyLegacyPassword } from '@/server/auth';
import { accountPasswordPolicy, auditAccountMutation, validateNewPassword } from '@/server/account-settings';
import { runtimeConfig } from '@/server/config/store';
import { loadEntitlements, canUseFeature } from '@/server/entitlements';
import { loadPermissions } from '@/server/permissions/loader';
import { canAccessFeature } from '@/server/permissions';

export type AccountActor = { userId: string; workspaceId: string; sessionTokenHash: string; apiKeyId?: string };
const invalid = () => new OperationError('invalid_request', 'Enter valid account details and the matching confirmation.');
export const accountConfirmations = {
  profile: 'UPDATE ACCOUNT PROFILE', password: 'CHANGE ACCOUNT PASSWORD',
  session: (id: string) => `REVOKE ACCOUNT SESSION ${id}`,
};
export async function authorizeAccountSession(actor: AccountActor, write = false, feature = 'settings/account') {
  if (actor.apiKeyId || !actor.sessionTokenHash) throw new OperationError('forbidden', 'Use a signed-in browser session to manage your account.');
  const [session, permissions, entitlements] = await Promise.all([
    getSessionByTokenHash(actor.sessionTokenHash), loadPermissions(actor.userId, actor.workspaceId),
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
  ]);
  if (!isUsableLegacySession(session, actor.userId)) throw new OperationError('unauthorized', 'Sign in to continue.');
  if (!permissions || !entitlements || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, feature) || !canAccessFeature(permissions, feature, write ? 'write' : 'read')) throw new OperationError('forbidden', 'Account settings are unavailable.');
}
const authorize = authorizeAccountSession;
export async function readAccount(actor: AccountActor) {
  await authorize(actor);
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true, email: true } });
  if (!user) throw new OperationError('not_found', 'Account unavailable.');
  return { ...user, passwordPolicy: await accountPasswordPolicy(), nameMaxLength: await runtimeConfig('settings.accountNameMaxLength') };
}
export async function updateAccountProfile(actor: AccountActor, input: unknown) {
  await authorize(actor, true);
  const max = await runtimeConfig('settings.accountNameMaxLength');
  const parsed = z.object({ name: z.string().trim().min(1).max(max), confirmation: z.literal(accountConfirmations.profile) }).strict().safeParse(input);
  if (!parsed.success) throw invalid();
  const { name } = parsed.data;
  await prisma.$transaction(async tx => {
    const changed = await tx.user.updateMany({ where: { id: actor.userId, disabledAt: null }, data: { name } });
    if (changed.count !== 1) throw new OperationError('conflict', 'Account unavailable.');
    await auditAccountMutation(tx, actor.userId, 'account.profile_updated', { fields: ['name'] });
  });
  return { name };
}
export async function changeAccountPassword(actor: AccountActor, input: unknown) {
  await authorize(actor, true);
  const policy = await accountPasswordPolicy();
  const parsed = z.object({ currentPassword: z.string().min(1), newPassword: z.string(), confirmation: z.literal(accountConfirmations.password) }).strict().safeParse(input);
  if (!parsed.success || !validateNewPassword(parsed.data.newPassword, policy) || Buffer.byteLength(parsed.data.currentPassword, 'utf8') > policy.maxBytes) throw invalid();
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { passwordHash: true, disabledAt: true } });
  if (!user || user.disabledAt || !verifyLegacyPassword(parsed.data.currentPassword, user.passwordHash)) throw new OperationError('invalid_request', 'Current password is incorrect.');
  const passwordHash = hashLegacyPassword(parsed.data.newPassword);
  await prisma.$transaction(async tx => {
    const changed = await tx.user.updateMany({ where: { id: actor.userId, disabledAt: null, passwordHash: user.passwordHash }, data: { passwordHash } });
    if (changed.count !== 1) throw new OperationError('conflict', 'Account changed. Refresh before retrying.');
    await tx.session.deleteMany({ where: { userId: actor.userId, tokenHash: { not: actor.sessionTokenHash } } });
    await auditAccountMutation(tx, actor.userId, 'account.password_changed', { otherSessionsRevoked: true });
  });
  return { ok: true };
}
export async function listAccountSessions(actor: AccountActor, input: unknown = {}, maxItems?: number) {
  await authorize(actor);
  const parsed = z.object({ offset: z.number().int().safe().nonnegative().optional() }).strict().safeParse(input);
  if (!parsed.success) throw invalid();
  const offset = parsed.data.offset ?? 0;
  const configured = await runtimeConfig('settings.accountSessionPageSize');
  const limit = maxItems === undefined ? configured : Math.min(configured, z.number().int().positive().parse(maxItems));
  const rows = await prisma.session.findMany({ where: { userId: actor.userId, pending: null, expiresAt: { gt: new Date() } }, orderBy: [{ expiresAt: 'desc' }, { id: 'asc' }], skip: offset, take: limit + 1, select: { id: true, expiresAt: true, tokenHash: true } });
  return { sessions: rows.slice(0, limit).map(({ id, expiresAt, tokenHash }) => ({ id, expiresAt, current: tokenHash === actor.sessionTokenHash })), nextOffset: rows.length > limit ? offset + limit : null };
}
export async function revokeAccountSession(actor: AccountActor, input: unknown) {
  await authorize(actor, true);
  const parsed = z.object({ id: z.string().min(1), confirmation: z.string() }).strict().safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== accountConfirmations.session(parsed.data.id)) throw invalid();
  await prisma.$transaction(async tx => {
    const changed = await tx.session.deleteMany({ where: { id: parsed.data.id, userId: actor.userId, pending: null, expiresAt: { gt: new Date() }, tokenHash: { not: actor.sessionTokenHash } } });
    if (!changed.count) throw new OperationError('not_found', 'Other active session not found.');
    await auditAccountMutation(tx, actor.userId, 'account.session_revoked', { sessionId: parsed.data.id });
  });
  return { ok: true };
}
