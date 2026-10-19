import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';

export const UNRESOLVED_PUBLICATION_STATES = ['started', 'uncertain', 'submitted', 'receipt_recorded'];

/** Durable evidence survives missing/corrupt legacy projection rows. */
export async function assertPublicationAttemptsSettled(tx: Prisma.TransactionClient, workspaceId: string, targetIds?: readonly string[], postId?: string) {
  if (targetIds?.length === 0) return;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM rebuild_publication_attempts WHERE "workspaceId" = ${workspaceId}
      AND state = ANY(${UNRESOLVED_PUBLICATION_STATES}::text[])
      AND (${targetIds === undefined} OR "targetId" = ANY(${[...(targetIds ?? [])]}::text[]))
      AND (${postId === undefined} OR "postId" = ${postId ?? ''}) LIMIT 1`;
  if (rows.length) throw new OperationError('conflict', 'A publication needs review before this post, data or connection can be changed. Check publication recovery first.');
}
