import { requireAuth } from '@/lib/auth';
import { canManageOthersPosts } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { publishNow } from '@/lib/scheduler/runner';
import { ok, route } from '@/lib/api';
import { errors } from '@/lib/errors';

/** "Post now" — publish a draft or scheduled post immediately. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const post = await prisma.post.findFirst({
    where: { id, workspaceId: auth.workspace.id },
    include: { targets: true },
  });
  if (!post) throw errors.postNotFound();
  if (post.authorId !== auth.user.id && !canManageOthersPosts(auth.role)) {
    throw errors.publishOwnOnly();
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
