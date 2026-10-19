import { createHash } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { deletePost, publishPost, reschedulePost } from '@/modules/publishing/server/lifecycle';
import { authorizePublishing } from './access';
import { duplicatePost } from './duplicate';
import { BULK_SCHEMA, bulkConfirmation, summarizeBulk, type BulkItemResult, type BulkResult } from '../bulk';
import type { PublishingActor } from './types';

/** Stable per-item idempotency key so a replayed bulk duplicate never creates extra drafts. */
export function itemRequestId(requestId: string, postId: string) {
  const hex = createHash('sha256').update(`${requestId}:${postId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const failure = (postId: string, error: unknown): BulkItemResult => {
  if (error instanceof OperationError) return { postId, outcome: error.code === 'conflict' ? 'skipped' : 'failed', code: error.code, message: error.message };
  return { postId, outcome: 'needs_review', code: 'unconfirmed', message: 'The result could not be confirmed. Check this post before another action.' };
};

/**
 * Runs one action over up to 50 posts sequentially. Authorization is checked
 * once up front for a fast refusal and again by every per-post service.
 */
export async function runBulkPostAction(actor: PublishingActor, input: unknown): Promise<BulkResult> {
  const parsed = BULK_SCHEMA.safeParse(input);
  if (!parsed.success) throw new OperationError('invalid_request', 'Choose posts and an action, then confirm.');
  const { action, requestId, confirmation, date, time } = parsed.data;
  const postIds = [...new Set(parsed.data.postIds)];
  if (postIds.length !== parsed.data.postIds.length) throw new OperationError('invalid_request', 'Each post can be selected once.');
  if (confirmation !== bulkConfirmation(action, postIds.length)) throw new OperationError('invalid_request', 'Confirm the exact bulk action.');
  if (action === 'reschedule' && (!date || !time)) throw new OperationError('invalid_request', 'Choose a future date and time.');
  const auth = await authorizePublishing(actor, 'publishing/posts', 'write');
  let timeZone = '';
  if (action === 'reschedule') {
    const workspace = await prisma.workspace.findUnique({ where: { id: auth.actor.workspaceId }, select: { timezone: true } });
    if (!workspace?.timezone) throw new OperationError('unavailable', 'This workspace has no valid time zone.');
    timeZone = workspace.timezone;
  }
  const items: BulkItemResult[] = [];
  for (const postId of postIds) {
    try {
      if (action === 'delete') {
        const receipt = await deletePost(actor, postId, false);
        items.push({ postId, outcome: receipt.state === 'completed' || receipt.state === 'none' ? 'done' : 'needs_review' });
      } else if (action === 'duplicate') {
        const result = await duplicatePost(actor, { postId, requestId: itemRequestId(requestId, postId), confirmation: `DUPLICATE POST ${postId}` });
        items.push({ postId, outcome: 'done', newPostId: result.postId });
      } else if (action === 'reschedule') {
        await reschedulePost(actor, { postId, date: date!, time: time!, timeZone });
        items.push({ postId, outcome: 'done' });
      } else {
        // Retry only failed posts; a draft or scheduled post must never be published by a retry.
        const current = await prisma.post.findFirst({ where: { id: postId, workspaceId: auth.actor.workspaceId }, select: { status: true } });
        if (current?.status !== 'failed' && current?.status !== 'partially_failed') { items.push({ postId, outcome: 'skipped', code: 'conflict', message: 'Only posts with failed destinations can be retried.' }); continue; }
        const result = await publishPost(actor, postId, undefined, { retryOnly: true });
        items.push({ postId, outcome: result.failed || result.needsReconciliation || result.firstCommentsNeedingReview || result.firstCommentsNotSent ? 'needs_review' : 'done' });
      }
    } catch (error) {
      items.push(failure(postId, error));
    }
  }
  return summarizeBulk(action, items);
}
