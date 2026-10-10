import { getTranslations } from 'next-intl/server';

import { requireAuth } from '@/lib/auth';
import { assertPagesAllowed, assertPostInScope, postScope } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';
import { cancelPost, nativeFallbackKey, updatePost } from '@/lib/posts';
import { updatePostSchema } from '@/lib/validation';
import { parseInsights, parseLinkPreview, parseMedia } from '@/lib/json';
import { ok, readJson, route } from '@/lib/api';
import { errors } from '@/lib/errors';

type Context = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const post = await prisma.post.findFirst({
    where: { id, workspaceId: auth.workspace.id, ...postScope(auth.pageScope) },
    include: { targets: { include: { target: true } } },
  });
  if (!post) throw errors.postNotFound();

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
  await assertPostInScope(auth.pageScope, auth.workspace.id, id);
  if (input.targetIds) assertPagesAllowed(auth.pageScope, input.targetIds);

  const result = await updatePost(
    {
      workspaceId: auth.workspace.id,
      userId: auth.user.id,
      role: auth.role,
      requiresApproval: auth.workspace.requiresApproval,
    },
    id,
    input,
  );

  // The one outcome of a save the author would not otherwise learn: they chose
  // "let Facebook hold it" and Facebook would have refused the time.
  if (result.nativeFallback) {
    const t = await getTranslations('posts');
    return ok({ ok: true, notice: t(nativeFallbackKey(result.nativeFallback)) });
  }
  return ok({ ok: true });
});

/**
 * Cancel a post. Destinations already handed to Facebook are deleted there
 * too; partial failures are reported rather than swallowed.
 */
export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await assertPostInScope(auth.pageScope, auth.workspace.id, id);

  const result = await cancelPost(
    { workspaceId: auth.workspace.id, userId: auth.user.id, role: auth.role },
    id,
  );
  return ok(result);
});
