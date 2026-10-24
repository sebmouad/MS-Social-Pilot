import { randomBytes } from 'node:crypto';
import type { Prisma } from '../../../generated/client';
import type { InboxReview } from '@/platforms/types';

/**
 * Upsert reviews into the shared review table. Resolution state is local and
 * never overwritten by a sync; an edited review keeps its row and identity.
 * Raw SQL because the rebuild client does not map this table.
 */
export async function storeFacebookReviews(tx: Prisma.TransactionClient, targetId: string, reviews: readonly InboxReview[], now: Date = new Date()): Promise<number> {
  const seen = new Set<string>();
  let stored = 0;
  for (const review of reviews) {
    if (seen.has(review.id)) continue;
    seen.add(review.id);
    await tx.$executeRaw`INSERT INTO page_reviews (id, "targetId", "remoteId", "reviewerName", rating, "recommendationType", "reviewText", "createdTime", "fetchedAt")
      VALUES (${`review_${randomBytes(12).toString('hex')}`}, ${targetId}, ${review.id}, ${review.authorName}, ${review.rating}, ${review.recommendation}, ${review.text}, ${review.createdAt}, ${now})
      ON CONFLICT ("targetId", "remoteId") DO UPDATE SET "reviewerName" = EXCLUDED."reviewerName", rating = EXCLUDED.rating,
        "recommendationType" = EXCLUDED."recommendationType", "reviewText" = EXCLUDED."reviewText", "createdTime" = EXCLUDED."createdTime", "fetchedAt" = EXCLUDED."fetchedAt"`;
    stored++;
  }
  return stored;
}
