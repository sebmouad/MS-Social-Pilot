import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { workspaceAccessConfirmation } from '@/lib/root-workspace-access';

type WorkspaceAccessRow = { id: string; name: string; suspendedAt: Date | null };

/** Private control-plane operation; never nest it inside the shared workspace write lock. */
export async function setRootWorkspaceAccess(actorId: string, workspaceId: string, suspended: boolean, confirmation: string) {
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
