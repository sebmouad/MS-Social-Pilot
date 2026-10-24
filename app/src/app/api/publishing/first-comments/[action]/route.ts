import { OperationError } from '@/lib/operation-error';
import { recordFirstCommentOutcome, sendFirstComment } from '@/modules/publishing/server/first-comment';
import { bodyString, publishingWrite, requireBodyConfirmation } from '@/modules/publishing/server/rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ action: string }> };

/**
 * `send`   body: { postId, postTargetId, confirmation: "SEND FIRST COMMENT {postTargetId}" }
 * `record` body: { postId, postTargetId, outcome: 'sent'|'not_sent', remoteId? (required for sent), confirmation: "RECORD FIRST COMMENT {postTargetId} SENT|NOT SENT" }
 * Rejected comments are retried through the separate `retry` route.
 */
export async function POST(request: Request, context: Context) {
  const { action } = await context.params;
  if (action !== 'send' && action !== 'record') return publishingWrite(request, async () => { throw new OperationError('not_found', 'Unknown first-comment action.'); });
  return publishingWrite(request, async ({ actor, body }) => {
    const postId = bodyString(body, 'postId');
    const postTargetId = bodyString(body, 'postTargetId');
    if (action === 'send') {
      requireBodyConfirmation(body, `SEND FIRST COMMENT ${postTargetId}`);
      return sendFirstComment(actor, { postId, postTargetId });
    }
    const outcome = body.outcome;
    if (outcome !== 'sent' && outcome !== 'not_sent') throw new OperationError('invalid_request', 'outcome must be sent or not_sent.');
    const remoteId = typeof body.remoteId === 'string' ? body.remoteId.trim() : '';
    if (outcome === 'sent' && !remoteId) throw new OperationError('invalid_request', 'remoteId is required when outcome is sent.');
    if (outcome === 'not_sent' && remoteId) throw new OperationError('invalid_request', 'Do not include remoteId when outcome is not_sent.');
    const confirmation = `RECORD FIRST COMMENT ${postTargetId} ${outcome === 'sent' ? 'SENT' : 'NOT SENT'}`;
    requireBodyConfirmation(body, confirmation);
    return recordFirstCommentOutcome(actor, { postId, postTargetId, outcome, ...(remoteId ? { remoteId } : {}), confirmation });
  }, { failure: 'The comment result could not be confirmed. Check its current state before another action.' });
}
