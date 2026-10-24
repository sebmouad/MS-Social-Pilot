
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';

export const UNRESOLVED_PUBLICATION_STATES = ['started', 'uncertain', 'submitted', 'receipt_recorded'];

/** Durable evidence survives missing/corrupt legacy projection rows. */
export async function assertPublicationAttemptsSettled(tx: Prisma.TransactionClient, workspaceId: string, targetIds?: readonly string[], postId?: string) {
  const errorText = await loadPublishingErrorText();
  if (targetIds?.length === 0) return;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM publication_attempts WHERE "workspaceId" = ${workspaceId}
      AND state = ANY(${UNRESOLVED_PUBLICATION_STATES}::text[])
      AND (${targetIds === undefined} OR "targetId" = ANY(${[...(targetIds ?? [])]}::text[]))
      AND (${postId === undefined} OR "postId" = ${postId ?? ''}) LIMIT 1`;
  if (rows.length) throw new PublishingOperationError('conflict', 'aPublicationNeedsReviewBeforeThisPostDataOr', {}, errorText);
}
