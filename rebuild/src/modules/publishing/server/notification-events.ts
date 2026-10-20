import { createHash } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { emitWorkspaceAlert } from '@/modules/settings/notifications/producers';

/** Called inside the transaction consuming a scheduled post, under Publishing's
 * destination locks. A failed/unknown send still consumes the local queue slot. */
export async function enqueueEmptyQueueNotifications(tx: Prisma.TransactionClient, workspaceId: string, postId: string, targetIds: readonly string[]) {
  for (const targetId of new Set(targetIds)) {
    const remaining = await tx.$queryRaw<Array<{ id: string }>>`SELECT p.id FROM posts p JOIN post_targets pt ON pt."postId"=p.id WHERE p."workspaceId"=${workspaceId} AND pt."targetId"=${targetId} AND p.status::text='scheduled' AND p.id<>${postId} LIMIT 1`;
    if (remaining.length) continue;
    const eventId = `queue_empty_${createHash('sha256').update(JSON.stringify([postId, targetId])).digest('hex')}`;
    await emitWorkspaceAlert(tx, { workspaceId, eventId, kind: 'queue_empty', targetId });
  }
}
