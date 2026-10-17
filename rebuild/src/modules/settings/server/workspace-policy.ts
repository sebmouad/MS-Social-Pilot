import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { workspacePolicyConfirmation, workspacePolicySchema, type WorkspacePolicyActor } from '../workspace-policy';

const unavailable = () => new OperationError('unavailable', 'Workspace policies are temporarily unavailable. Try again later.');
const forbidden = () => new OperationError('forbidden', 'Workspace policy management is available to workspace owners and admins.');
const validTimeZone = (value: string) => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } };
async function authorize(actor: WorkspacePolicyActor, write: boolean) {
  if (!actor || !actor.userId || !actor.workspaceId) throw new OperationError('unauthorized', 'Sign in with an active workspace account.');
  const [user, membership, entitlements, permissions] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } }),
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
    loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!user || user.disabledAt || !membership) throw new OperationError('unauthorized', 'Sign in with an active account to manage workspace policies.');
  if (membership.role !== 'owner' && membership.role !== 'admin') throw forbidden();
  if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, 'settings/workspace') || !permissions || !canAccessFeature(permissions, 'settings/workspace', write ? 'write' : 'read')) throw forbidden();
}
async function maxZoneLength() {
  try { const cap = Number(await runtimeConfig('settings.workspacePolicyTimezoneMaxCharacters')); if (Number.isSafeInteger(cap) && cap >= 16 && cap <= 128) return cap; throw unavailable(); }
  catch { throw unavailable(); }
}

export async function readWorkspacePolicy(actor: WorkspacePolicyActor) {
  try {
    await authorize(actor, false);
    await assertWorkspaceNotPurging(actor.workspaceId);
    const rows = await prisma.$queryRaw<Array<{ timezone: string; requiresApproval: boolean }>>`SELECT timezone, "requiresApproval" FROM workspaces WHERE id = ${actor.workspaceId}`;
    if (!rows[0] || !validTimeZone(rows[0].timezone) || typeof rows[0].requiresApproval !== 'boolean') throw unavailable();
    return { ok: true as const, timezone: rows[0].timezone, requiresApproval: rows[0].requiresApproval, maxTimezoneCharacters: await maxZoneLength() };
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}

/** Exclusive workspace lock prevents a purge or concurrent policy edit from crossing this atomic update. */
export async function updateWorkspacePolicy(actor: WorkspacePolicyActor, input: unknown) {
  const value = workspacePolicySchema.safeParse(input);
  if (!value.success) throw new OperationError('invalid_request', 'Choose a valid workspace time zone and policy.');
  try { await authorize(actor, true); }
  catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
  const maxCharacters = await maxZoneLength();
  if (value.data.timezone.length > maxCharacters || !validTimeZone(value.data.timezone) || value.data.confirmation !== workspacePolicyConfirmation(actor.workspaceId)) throw new OperationError('invalid_request', 'Choose a valid workspace time zone and enter the exact confirmation.');
  let timeout: number, maxWait: number;
  try { [timeout, maxWait] = await Promise.all([runtimeConfig('settings.teamOperationTimeoutMs'), runtimeConfig('settings.teamOperationMaxWaitMs')]); }
  catch { throw unavailable(); }
  if (!Number.isSafeInteger(timeout) || !Number.isSafeInteger(maxWait)) throw unavailable();
  try {
    return await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string; suspendedAt: Date | null; requiresApproval: boolean }>>`SELECT id, "suspendedAt", "requiresApproval" FROM workspaces WHERE id = ${actor.workspaceId} FOR UPDATE`;
      if (!rows[0]) throw new OperationError('not_found', 'This workspace is unavailable.');
      if (rows[0].suspendedAt) throw new OperationError('forbidden', 'This workspace is suspended.');
      const lockKey = JSON.stringify(['workspace-policy', actor.workspaceId]);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text`;
      const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId: actor.workspaceId }, select: { status: true } });
      if (purge && purge.status !== 'completed') throw new OperationError('conflict', 'Workspace data deletion is in progress.');
      const current = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
      if (!current[0] || current[0].disabledAt) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
      if (current[0].role !== 'owner' && current[0].role !== 'admin') throw forbidden();
      const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId)]);
      if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, 'settings/workspace') || !permissions || !canAccessFeature(permissions, 'settings/workspace', 'write')) throw forbidden();
      if (rows[0].requiresApproval && !value.data.requiresApproval) {
        const released = await tx.$queryRaw<Array<{ total: bigint; scheduled: bigint; drafts: bigint }>>`WITH released AS (
          UPDATE posts SET "approvalStatus" = 'not_required', status = CASE WHEN "scheduledAt" IS NULL THEN 'draft'::"PostStatus" ELSE 'scheduled'::"PostStatus" END
          WHERE "workspaceId" = ${actor.workspaceId} AND status = 'pending_approval' AND "approvalStatus" = 'pending'
          RETURNING "scheduledAt"
        ) SELECT COUNT(*)::bigint AS total, COUNT(*) FILTER (WHERE "scheduledAt" IS NOT NULL)::bigint AS scheduled, COUNT(*) FILTER (WHERE "scheduledAt" IS NULL)::bigint AS drafts FROM released`;
        const releasedCounts = released[0];
        if (Number(releasedCounts?.total ?? 0) > 0) await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'approvals.disabled', ${JSON.stringify({ released: Number(releasedCounts?.total ?? 0), scheduled: Number(releasedCounts?.scheduled ?? 0), drafts: Number(releasedCounts?.drafts ?? 0) })}::jsonb, NOW())`;
      }
      await tx.$executeRaw`UPDATE workspaces SET timezone = ${value.data.timezone}, "requiresApproval" = ${value.data.requiresApproval}, "updatedAt" = NOW() WHERE id = ${actor.workspaceId}`;
      await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, 'workspace.policy_updated', ${JSON.stringify({ timezone: value.data.timezone, requiresApproval: value.data.requiresApproval })}::jsonb, NOW())`;
      return { ok: true as const, timezone: value.data.timezone, requiresApproval: value.data.requiresApproval };
    }, { timeout, maxWait });
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}
