import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { cancelPost, updatePost } from '@/lib/posts';
import { updatePostSchema } from '@/lib/validation';
import { parseInsights, parseLinkPreview, parseMedia } from '@/lib/json';
import { fail, ok, readJson, route } from '@/lib/api';

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const post = await prisma.post.findFirst({
    where: { id, workspaceId: auth.workspace.id },
    include: { targets: { include: { target: true } } },
  });
  if (!post) return fail('Post not found.', 404);

  return ok({
    id: post.id,
    message: post.message,
    link: post.link,
    linkPreview: parseLinkPreview(post.linkPreview),
    media: parseMedia(post.media),
    status: post.status,
    publishMode: post.publishMode,
    scheduledAt: post.scheduledAt,
    publishedAt: post.publishedAt,
    timezone: post.timezone,
    targets: post.targets.map((postTarget) => ({
      id: postTarget.id,
      targetId: postTarget.targetId,
      name: postTarget.target.name,
      type: postTarget.target.type,
      status: postTarget.status,
      url: postTarget.remoteUrl,
      error: postTarget.errorMessage,
      attempts: postTarget.attempts,
      insights: parseInsights(postTarget.insights),
    })),
  });
});

export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  const input = updatePostSchema.parse(await readJson(request));

  await updatePost(
    {
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      role: auth.role,
      requiresApproval: auth.workspace.requiresApproval,
    },
    id,
    input,
  );
  return ok({ ok: true });
});

/**
 * Cancel a post. Destinations already handed to Facebook are deleted there
 * too; partial failures are reported rather than swallowed.
 */
export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const result = await cancelPost(
    { workspaceId: auth.workspace.id, userId: auth.user.id, role: auth.role },
    id,
  );
  return ok(result);
});
