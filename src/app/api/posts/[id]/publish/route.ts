import { requireAuth } from '@/lib/auth';
import { assertPostInScope } from '@/lib/page-access';
import {
  canManageOthersPosts,
  canPublishWithoutApproval,
  PUBLISHABLE_APPROVAL_STATUSES,
} from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { publishNow } from '@/lib/scheduler/runner';
import { ok, route } from '@/lib/api';
import { errors } from '@/lib/errors';

/** "Post now" — publish a draft or scheduled post immediately. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await assertPostInScope(auth.pageScope, auth.workspace.id, id);

  const post = await prisma.post.findFirst({
    where: { id, workspaceId: auth.workspace.id },
    include: { targets: true },
  });
  if (!post) throw errors.postNotFound();
  if (post.authorId !== auth.user.id && !canManageOthersPosts(auth.role)) {
    throw errors.publishOwnOnly();
  }

  // "Post now" skips the approval queue by its nature, so it belongs to the
  // people review does not apply to. `publishNow` only checks the post's own
  // approval state, and a contributor's draft is saved `not_required` — nothing
  // has been submitted yet — so that check alone let the author of an
  // unreviewed draft put it straight on the client's Page.
  if (auth.workspace.requiresApproval && !canPublishWithoutApproval(auth.role)) {
    throw errors.publishNeedsReview();
  }
  // Waiting for a decision, or refused one: not going anywhere until a
  // reviewer says so, whoever presses the button.
  if (!PUBLISHABLE_APPROVAL_STATUSES.includes(post.approvalStatus)) {
    throw errors.awaitingApproval();
  }

  if (post.status === 'published') throw errors.alreadyPublished();
  if (post.status === 'publishing') throw errors.alreadyPublishing();
  if (post.targets.some((target) => target.status === 'scheduled_remote')) {
    throw errors.heldByFacebook();
  }

  const result = await publishNow(post.id);

  const targets = await prisma.postTarget.findMany({
    where: { postId: post.id },
    include: { target: { select: { name: true } } },
  });

  return ok({
    ...result,
    results: targets.map((postTarget) => ({
      name: postTarget.target.name,
      status: postTarget.status,
      url: postTarget.remoteUrl,
      error: postTarget.errorMessage,
    })),
  });
});
