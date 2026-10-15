import { prisma } from '@/server/data';

/** Fail closed before any workspace mutation or provider call during erasure. */
export async function assertWorkspaceNotPurging(workspaceId: string): Promise<void> {
  const purge = await prisma.workspaceDataPurge.findUnique({
    where: { workspaceId }, select: { status: true },
  });
  if (purge && purge.status !== 'completed') {
    throw new Error('Workspace data deletion is in progress.');
  }
}
