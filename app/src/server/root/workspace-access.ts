import { rootUserIdSchema, rootUserConfirmationSchema } from '@/lib/root-user-controls';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { workspaceAccessConfirmation } from '@/lib/root-workspace-access';

type WorkspaceAccessRow = { id: string; name: string; suspendedAt: Date | null };

/** Private control-plane operation; never nest it inside the shared workspace write lock. */
export async function setRootWorkspaceAccess(actorId: string, workspaceId: string, suspended: boolean, confirmation: string) {
  if (!rootUserIdSchema.safeParse(workspaceId).success || !rootUserConfirmationSchema.safeParse(confirmation).success) throw new OperationError('invalid_request', 'Enter the exact confirmation shown.');
  const [timeout, maxWait] = await Promise.all([runtimeConfig('data.workspaceOperationTimeoutMs'), runtimeConfig('data.workspaceOperationLockWaitMs')]);
  return prisma.$transaction(async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { isInstanceOwner: true, disabledAt: true } });
    if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
    // Existing legacy column: this compatibility query does not apply a schema migration.
    // FOR UPDATE waits for in-flight operations holding the same row FOR SHARE.
    const rows = await tx.$queryRaw<WorkspaceAccessRow[]>`SELECT id, name, "suspendedAt" FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
    const workspace = rows[0];
    if (!workspace) throw new OperationError('not_found', 'Workspace not found.');
    if (confirmation !== workspaceAccessConfirmation(workspace.id, suspended)) throw new OperationError('invalid_request', 'Enter the exact confirmation shown.');
    const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId }, select: { status: true } });
    if (purge && purge.status !== 'completed') throw new OperationError('conflict', 'Workspace data deletion is in progress.');
    if (Boolean(workspace.suspendedAt) === suspended) return { changed: false, suspended, suspendedAt: workspace.suspendedAt };
    const suspendedAt = suspended ? new Date() : null;
    await tx.$executeRaw`UPDATE workspaces SET "suspendedAt" = ${suspendedAt}, "updatedAt" = NOW() WHERE id = ${workspaceId}`;
    const detail = JSON.stringify({ workspaceId, suspended });
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, ${suspended ? 'root.workspace_suspended' : 'root.workspace_restored'}, ${detail}::jsonb, NOW())`;
    return { changed: true, suspended, suspendedAt };
  }, { timeout, maxWait });
}

export const rootWorkspaceDeletionConfirmation = (workspaceId: string) => `DELETE WORKSPACE ${workspaceId}`;

/**
 * Root deletion of a whole workspace: only a suspended workspace, with an exact confirmation. Reuses the resumable
 * workspace data purge (database rows, then stored media), then removes the emptied workspace row. A failure part way
 * leaves the purge resumable and the workspace suspended, never half-visible to customers.
 */
export async function deleteRootWorkspace(actorId: string, workspaceId: string, confirmation: string) {
  if (!rootUserIdSchema.safeParse(workspaceId).success || !rootUserConfirmationSchema.safeParse(confirmation).success) throw new OperationError('invalid_request', 'Enter the exact confirmation shown.');
  if (confirmation !== rootWorkspaceDeletionConfirmation(workspaceId)) throw new OperationError('invalid_request', 'Enter the exact confirmation shown.');
  const { purgeWorkspaceData } = await import('@/server/data-control');
  const counts = await purgeWorkspaceData({ userId: actorId, workspaceId }, async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { isInstanceOwner: true, disabledAt: true } });
    if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
    const rows = await tx.$queryRaw<WorkspaceAccessRow[]>`SELECT id, name, "suspendedAt" FROM workspaces WHERE id = ${workspaceId}`;
    if (!rows[0]) throw new OperationError('not_found', 'Workspace not found.');
    if (!rows[0].suspendedAt) throw new OperationError('conflict', 'Suspend this workspace before deleting it.');
  });
  const timeout = await runtimeConfig('data.deleteTransactionTimeoutMs');
  await prisma.$transaction(async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { isInstanceOwner: true, disabledAt: true } });
    if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
    const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId }, select: { status: true } });
    if (purge?.status !== 'completed') throw new OperationError('conflict', 'Workspace data deletion is still in progress.');
    await tx.$executeRaw`DELETE FROM workspace_data_purges WHERE "workspaceId" = ${workspaceId}`;
    await tx.$executeRaw`UPDATE users SET "lastActiveWorkspaceId" = NULL WHERE "lastActiveWorkspaceId" = ${workspaceId}`;
    await tx.$executeRaw`DELETE FROM workspaces WHERE id = ${workspaceId}`;
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, 'root.workspace_deleted', ${JSON.stringify({ workspaceId, counts })}::jsonb, NOW())`;
  }, { timeout });
  return { deleted: true as const, workspaceId, counts };
}

export const rootOrphanAdAccountsConfirmation = (workspaceId: string) => `REMOVE UNLINKED AD ACCOUNTS ${workspaceId}`;
// An ad account is unlinked when no Facebook connection of its workspace holds it any more (the connection was removed
// or erased after a Meta deletion request). Its figures, stored campaigns and change history go with it (ON DELETE CASCADE).
const unlinked = (workspaceId: string) => prisma.$queryRaw<Array<{ id: string; name: string }>>`
  SELECT a.id, a.name FROM ad_accounts a WHERE a."workspaceId" = ${workspaceId}
    AND (a."socialAccountId" IS NULL OR NOT EXISTS (SELECT 1 FROM social_accounts s WHERE s.id = a."socialAccountId" AND s."workspaceId" = a."workspaceId"))
  ORDER BY a.name, a.id`;

/** Read-only: the ad accounts of a workspace that no connection holds. */
export async function previewRootOrphanAdAccounts(actorId: string, workspaceId: string) {
  if (!rootUserIdSchema.safeParse(workspaceId).success) throw new OperationError('invalid_request', 'Choose a valid workspace.');
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { isInstanceOwner: true, disabledAt: true } });
  if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
  const rows = await unlinked(workspaceId);
  return { workspaceId, count: rows.length, names: rows.map(row => row.name).slice(0, 50), confirmation: rootOrphanAdAccountsConfirmation(workspaceId) };
}

/**
 * Root cleanup: removes the ad accounts no connection holds, with an exact confirmation. Linked ad accounts are never
 * touched, and nothing is sent to Meta. Refused while an ads change is still being applied for one of them.
 */
export async function removeRootOrphanAdAccounts(actorId: string, workspaceId: string, confirmation: string) {
  if (!rootUserIdSchema.safeParse(workspaceId).success || !rootUserConfirmationSchema.safeParse(confirmation).success) throw new OperationError('invalid_request', 'Enter the exact confirmation shown.');
  if (confirmation !== rootOrphanAdAccountsConfirmation(workspaceId)) throw new OperationError('invalid_request', 'Enter the exact confirmation shown.');
  const [timeout, maxWait] = await Promise.all([runtimeConfig('data.workspaceOperationTimeoutMs'), runtimeConfig('data.workspaceOperationLockWaitMs')]);
  const { assertAdsOperationsSettled } = await import('@/modules/ads/management/retention');
  return prisma.$transaction(async tx => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { isInstanceOwner: true, disabledAt: true } });
    if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
    const rows = await tx.$queryRaw<WorkspaceAccessRow[]>`SELECT id, name, "suspendedAt" FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
    if (!rows[0]) throw new OperationError('not_found', 'Workspace not found.');
    const ids = (await tx.$queryRaw<Array<{ id: string }>>`
      SELECT a.id FROM ad_accounts a WHERE a."workspaceId" = ${workspaceId}
        AND (a."socialAccountId" IS NULL OR NOT EXISTS (SELECT 1 FROM social_accounts s WHERE s.id = a."socialAccountId" AND s."workspaceId" = a."workspaceId"))
      FOR UPDATE`).map(row => row.id);
    if (!ids.length) return { removed: 0 };
    await assertAdsOperationsSettled(tx, workspaceId, ids);
    const removed = await tx.adAccount.deleteMany({ where: { workspaceId, id: { in: ids } } });
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actorId}, 'root.workspace_orphan_ad_accounts_removed', ${JSON.stringify({ workspaceId, adAccounts: removed.count })}::jsonb, NOW())`;
    return { removed: removed.count };
  }, { timeout, maxWait });
}
