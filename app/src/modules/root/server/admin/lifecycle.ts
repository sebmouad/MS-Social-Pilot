import { synchronousPolicy, withinSynchronousLimit } from '@/lib/config/synchronous-policy';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { rootUserConfirmationSchema, rootUserIdSchema } from '@/lib/root-user-controls';
import { setRootUserDisabled } from '@/server/root/user-controls';
import { setRootWorkspaceAccess } from '@/server/root/workspace-access';
import { assertRootActor, lockWorkspaceOwners, conflict, invalid } from './authz';
import { writeRootAudit } from './audit';
import { rootResultLimit, adminSetting, rootTransaction } from './policy';
import { transferConfirmation, transferSchema } from './shared';

/**
 * Account and workspace lifecycle. Disable/enable and suspend/restore delegate to
 * the existing Root services so there is one implementation of their locks,
 * session revocation and audit. Nothing here deletes accounts, workspaces or data.
 */
export async function setLifecycleUserAccess(actorId: string, userId: string, disabled: boolean, confirmation: string) {
  if (!rootUserIdSchema.safeParse(userId).success || !rootUserConfirmationSchema.safeParse(confirmation).success) throw invalid('Choose an account and enter the exact confirmation.');
  return setRootUserDisabled(actorId, userId, disabled, confirmation);
}

export async function setLifecycleWorkspaceAccess(actorId: string, workspaceId: string, suspended: boolean, confirmation: string) {
  if (!workspaceId || workspaceId.length > synchronousPolicy('root.identifierMaxCharacters') || !confirmation || confirmation.length > synchronousPolicy('root.confirmationMaxCharacters')) throw invalid('Choose a workspace and enter the exact confirmation.');
  return setRootWorkspaceAccess(actorId, workspaceId, suspended, confirmation);
}

/** Disabled accounts, suspended workspaces and queued deletions, bounded. Read only. */
export async function loadRootLifecycle(actorId: string, resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const limit = rootResultLimit(await adminSetting('root.admin.lifecycleListLimit'), resultCap);
  const [users, workspaces, purges] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; name: string; email: string; disabledAt: Date; isInstanceOwner: boolean }>>`SELECT id, name, email, "disabledAt", "isInstanceOwner" FROM users WHERE "disabledAt" IS NOT NULL ORDER BY "disabledAt" DESC, id LIMIT ${limit}`,
    prisma.$queryRaw<Array<{ id: string; name: string; suspendedAt: Date; owners: string[] }>>`SELECT w.id, w.name, w."suspendedAt", ARRAY(SELECT u.email FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = w.id AND m.role::text = 'owner' ORDER BY u.email) AS owners FROM workspaces w WHERE w."suspendedAt" IS NOT NULL ORDER BY w."suspendedAt" DESC, w.id LIMIT ${limit}`,
    prisma.$queryRaw<Array<{ workspaceId: string; status: string }>>`SELECT "workspaceId", status FROM workspace_data_purges WHERE status <> 'completed' ORDER BY "workspaceId" LIMIT ${limit}`,
  ]);
  return {
    disabledUsers: users.map(user => ({ id: user.id, name: user.name, email: user.email, root: user.isInstanceOwner, disabledAt: user.disabledAt.toISOString() })),
    suspendedWorkspaces: workspaces.map(workspace => ({ id: workspace.id, name: workspace.name, suspendedAt: workspace.suspendedAt.toISOString(), owners: workspace.owners })),
    pendingDeletions: purges,
    limit,
    deletion: 'unavailable' as const,
  };
}

/**
 * Make an active existing account the workspace owner. Exact confirmation; the
 * previous owners either stay co-owners or become admins. The workspace row is
 * locked, so concurrent ownership changes serialize, and membership + audit are atomic.
 */
export async function transferWorkspaceOwnership(actorId: string, input: unknown) {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) throw invalid('Enter a workspace, an existing account email and the exact confirmation.');
  const { workspaceId, newOwnerEmail, previousOwners, confirmation } = parsed.data;
  return rootTransaction(async tx => {
    await assertRootActor(tx, actorId);
    const workspace = (await tx.$queryRaw<Array<{ id: string; name: string }>>`SELECT id, name FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`)[0];
    if (!workspace) throw new OperationError('not_found', 'Workspace not found.');
    const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId }, select: { status: true } });
    if (purge && purge.status !== 'completed') throw conflict('Workspace data deletion is in progress.');
    if (confirmation !== transferConfirmation(workspaceId, newOwnerEmail)) throw invalid('Enter the exact confirmation shown.');
    // Serialize against Root account-disable operations so an account cannot
    // be made workspace owner after it was concurrently disabled.
    const users = await tx.$queryRaw<Array<{ id: string; email: string; disabledAt: Date | null }>>`SELECT id, email, "disabledAt" FROM users WHERE email = ${newOwnerEmail}`;
    const user = users[0];
    if (!user || user.disabledAt) throw invalid('Choose an existing active account as the new owner.');
    const owners = await lockWorkspaceOwners(tx, actorId, workspaceId, [user.id]);
    const activeTarget = await tx.user.findUnique({ where: { id: user.id }, select: { disabledAt: true } });
    if (!activeTarget || activeTarget.disabledAt) throw invalid('Choose an existing active account as the new owner.');
    const existing = await tx.membership.findUnique({ where: { userId_workspaceId: { userId: user.id, workspaceId } }, select: { id: true, role: true } });
    const others = owners.filter(owner => owner.userId !== user.id);
    if (existing?.role === 'owner' && (previousOwners === 'keep' || !others.length)) throw conflict('That account already owns this workspace.');
    if (existing) {
      if (existing.role !== 'owner') await tx.membership.update({ where: { id: existing.id }, data: { role: 'owner' } });
    } else {
      await tx.membership.create({ data: { id: randomUUID(), userId: user.id, workspaceId, role: 'owner' } });
    }
    await tx.$executeRaw`UPDATE memberships SET "allPages" = true WHERE "userId" = ${user.id} AND "workspaceId" = ${workspaceId}`;
    let demoted = 0;
    if (previousOwners === 'demote_admin' && others.length) {
      demoted = (await tx.membership.updateMany({ where: { workspaceId, role: 'owner', userId: { not: user.id } }, data: { role: 'admin' } })).count;
    }
    await writeRootAudit(tx, actorId, 'root.workspace_ownership_transferred', { workspaceId, toUserId: user.id, previousOwnerIds: others.map(owner => owner.userId), previousOwners, demoted, createdMembership: !existing });
    return { changed: true, workspaceId, newOwnerId: user.id, demoted, createdMembership: !existing };
  });
}
