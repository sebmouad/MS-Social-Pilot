import { requireAuth } from '@/lib/auth';
import { canManageOthersPosts } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { publishNow } from '@/lib/scheduler/runner';
import { fail, ok, route } from '@/lib/api';

/** "Post now" — publish a draft or scheduled post immediately. */
export const POST = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const post = await prisma.post.findFirst({
    where: { id, workspaceId: auth.workspace.id },
    include: { targets: true },
  });
  if (!post) return fail('Post not found.', 404);
  if (post.authorId !== auth.user.id && !canManageOthersPosts(auth.role)) {
    return fail('You can only publish your own posts.', 403);
  }

  if (post.status === 'published') return fail('This post has already been published.', 409);
  if (post.status === 'publishing') return fail('This post is being published right now.', 409);
  if (post.targets.some((target) => target.status === 'scheduled_remote')) {
    return fail(
      'Facebook is already holding this post for its scheduled time. Cancel it first to publish now.',
      409,
    );
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
