import type { Prisma } from '../../../generated/client';

/** Legacy storage uses `instagram`; the adapter's professional kind stays module-owned. */
export async function alignInstagramSelection(tx: Prisma.TransactionClient, workspaceId: string, target: { id: string; type: string; providerId: string }, enabled: boolean) {
  if (target.type !== 'instagram') return;
  await tx.instagramAccount.updateMany({ where: { workspaceId, igUserId: target.providerId }, data: { enabled } });
}
