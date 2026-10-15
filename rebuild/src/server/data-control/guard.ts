import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';

/** Fail closed before any workspace mutation or provider call during erasure. */
export async function assertWorkspaceNotPurging(workspaceId: string): Promise<void> {
  const purge = await prisma.workspaceDataPurge.findUnique({
    where: { workspaceId }, select: { status: true },
  });
  if (purge && purge.status !== 'completed') {
    throw new Error('Workspace data deletion is in progress.');
  }
}

/** Keep a shared workspace row lock until every provider and local side effect finishes.
 * Erasure takes FOR UPDATE on the same row, so it cannot pass this boundary
 * while an operation is already in flight. The callback must not update the
 * workspace row itself; child-table writes only acquire compatible SHARE locks.
 */
export async function withWorkspaceOperation<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
  const [timeout, maxWait] = await Promise.all([
    runtimeConfig('data.workspaceOperationTimeoutMs'),
    runtimeConfig('data.workspaceOperationLockWaitMs'),
  ]);
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR SHARE`;
    if (!rows.length) throw new Error('This workspace is unavailable.');
    const purge = await tx.workspaceDataPurge.findUnique({ where: { workspaceId }, select: { status: true } });
    if (purge && purge.status !== 'completed') throw new Error('Workspace data deletion is in progress.');
    return operation();
  }, { timeout, maxWait });
}
