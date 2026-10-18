import type { ReviewParticipant } from '@/server/publishing/lifecycle';
import type { SharingActor } from '../contracts';

/**
 * The only way sharing changes an approval. Sharing never writes post status itself;
 * the default adapter delegates to the Publishing review lifecycle, acting as the link
 * creator, so the creator's CURRENT approval permission, scope and workspace state
 * decide whether a client's answer takes effect. The participant joins the lifecycle's own
 * transaction, so the status change and the stored client answer commit or fail together.
 */
/** Protocol constant of `reviewPost` (server/publishing/lifecycle.ts rejects longer notes); kept in step with it by a test. */
export const REVIEW_NOTE_MAX = 500;
export type ReviewPort = {
  review(actor: SharingActor, postId: string, decision: 'approve' | 'reject', note?: string, participant?: ReviewParticipant): Promise<unknown>;
};

const lifecyclePort: ReviewPort = {
  async review(actor, postId, decision, note, participant) {
    const { reviewPost } = await import('@/server/publishing/lifecycle');
    return reviewPost(actor, postId, decision, note, participant);
  },
};

let port: ReviewPort = lifecyclePort;
export const getReviewPort = () => port;
/** Test seam / alternate host wiring. Pass nothing to restore the lifecycle adapter. */
export function setReviewPort(next?: ReviewPort) { port = next ?? lifecyclePort; }
