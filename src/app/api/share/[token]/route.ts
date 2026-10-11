import { sendChat } from '@/lib/chat';
import { clientIp } from '@/lib/client-ip';
import { AppError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { hit } from '@/lib/rate-limit';
import { decisionSchema, openShareLink, sharedPostWhere } from '@/lib/share-links';
import { ok, readJson, route } from '@/lib/api';

const LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 };

/**
 * A client's answer on a review link: approve, ask for changes, or comment.
 *
 * No session — the token is the authority, and it can only reach posts of
 * the link's own workspace and Pages. Recorded as feedback beside the post
 * for the team, who still make the final call in Approvals; a link sent to
 * the wrong address must not be able to publish anything.
 */
export const POST = route(async (request: Request, context: { params: Promise<{ token: string }> }) => {
  const { token } = await context.params;
  const throttle = hit(`share:${clientIp(request) ?? 'unknown'}`, LIMIT);
  if (!throttle.allowed) {
    throw new AppError({ key: 'errors.tooManyRequests', fallback: 'Too many requests. Try again in a few minutes.', status: 429 });
  }

  const link = await openShareLink(token);
  if (!link || link.kind !== 'review') throw new AppError({ key: 'errors.notFound', fallback: 'Not found.', status: 404 });

  const input = decisionSchema.parse(await readJson(request));
  if (input.decision === 'comment' && !input.comment) {
    throw new AppError({ key: 'errors.commentRequired', fallback: 'Write a comment first.', status: 422 });
  }
  if (!link.allowComments && input.comment) {
    throw new AppError({ key: 'errors.commentsOff', fallback: 'Comments are switched off for this link.', status: 422 });
  }
  const post = await prisma.post.findFirst({ where: { id: input.postId, ...sharedPostWhere(link) }, select: { id: true } });
  if (!post) throw new AppError({ key: 'errors.notFound', fallback: 'Not found.', status: 404 });

  const decision = await prisma.reviewDecision.create({
    data: {
      shareLinkId: link.id,
      postId: post.id,
      decision: input.decision,
      comment: input.comment ?? null,
      authorName: input.authorName,
    },
    select: { id: true, decision: true, createdAt: true },
  });
  await sendChat({
    workspaceId: link.workspaceId,
    event: 'reviewDecision',
    key: `review_${input.decision}`,
    params: { name: input.authorName, link: link.title, comment: input.comment ? `: “${input.comment.slice(0, 200)}”` : '' },
    path: '/approvals?view=board',
  });
  return ok({ decision }, 201);
});
