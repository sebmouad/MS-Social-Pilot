import { prisma } from './prisma';
import { decryptSecret } from './crypto';
import { asGraphError } from './facebook/graph';
import { replyToComment } from './facebook/edges';

/**
 * The first comment: posted as the Page under a post the moment it goes out.
 *
 * Scheduling tools offer it because a Page post reads better without a link,
 * a wall of hashtags or the small print, and the first comment is where those
 * go. It is the same Graph call on a Facebook post and an Instagram media
 * object: `POST /{id}/comments`.
 *
 * Three rules shape this:
 *
 * 1. **It never fails the post.** The post is already on the Page when this
 *    runs; a comment Facebook refuses is recorded on the destination and can
 *    be retried, and nothing here throws back into the publisher — which would
 *    otherwise treat the error as a failed publish and post it a second time.
 * 2. **It is claimed before it is sent.** `firstCommentAt` is set in the same
 *    statement that checks nobody else has, so two workers, a worker and a
 *    retry, or two clicks on Retry cannot comment twice.
 * 3. **A refusal releases the claim**, so a retry can try again.
 */
export async function postFirstComment(
  postTargetId: string,
  now: Date = new Date(),
): Promise<'posted' | 'skipped' | 'failed'> {
  try {
    const row = await prisma.postTarget.findUnique({
      where: { id: postTargetId },
      include: {
        post: { select: { firstComment: true } },
        target: { include: { socialAccount: true } },
      },
    });
    const message = row?.post.firstComment?.trim();
    if (!row || !message || !row.remotePostId || row.status !== 'published' || row.firstCommentId) {
      return 'skipped';
    }

    const claimed = await prisma.postTarget.updateMany({
      where: { id: postTargetId, firstCommentId: null, firstCommentAt: null },
      data: { firstCommentAt: now },
    });
    if (claimed.count === 0) return 'skipped';

    const encrypted = row.target.accessToken ?? row.target.socialAccount?.accessToken ?? null;
    if (!encrypted) {
      await release(postTargetId, 'No access token is stored for this destination. Reconnect it, then retry.');
      return 'failed';
    }

    try {
      const commentId = await replyToComment(row.remotePostId, decryptSecret(encrypted), message);
      await prisma.postTarget.update({
        where: { id: postTargetId },
        data: { firstCommentId: commentId, firstCommentError: null },
      });
      return 'posted';
    } catch (error) {
      await release(postTargetId, asGraphError(error).displayMessage);
      return 'failed';
    }
  } catch {
    // A database error here must not reach the publisher either: the post is
    // out, and the comment can be retried from the post list.
    return 'failed';
  }
}

async function release(postTargetId: string, reason: string): Promise<void> {
  await prisma.postTarget.update({
    where: { id: postTargetId },
    data: { firstCommentAt: null, firstCommentError: reason },
  });
}

/**
 * Retry the first comment wherever it was refused on a post's published
 * destinations. Returns how many went through.
 */
export async function retryFirstComments(postId: string): Promise<{ posted: number; failed: number }> {
  const rows = await prisma.postTarget.findMany({
    where: { postId, status: 'published', firstCommentId: null, firstCommentError: { not: null } },
    select: { id: true },
  });
  let posted = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await postFirstComment(row.id);
    if (result === 'posted') posted += 1;
    else if (result === 'failed') failed += 1;
  }
  return { posted, failed };
}
