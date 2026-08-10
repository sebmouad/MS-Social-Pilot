import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createPost } from '@/lib/posts';
import { createPostSchema } from '@/lib/validation';
import { parseLinkPreview, parseMedia } from '@/lib/json';
import { ok, readJson, route } from '@/lib/api';
import { isPostStatus } from '@/lib/constants';

/** List posts, newest scheduled first. Supports status and date filtering. */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const url = new URL(request.url);

  const status = url.searchParams.get('status');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);

  const scheduledAt: { gte?: Date; lte?: Date } = {};
  if (from) scheduledAt.gte = new Date(from);
  if (to) scheduledAt.lte = new Date(to);

  const posts = await prisma.post.findMany({
    where: {
      workspaceId: auth.workspace.id,
      ...(status && isPostStatus(status) ? { status } : {}),
      ...(from || to ? { scheduledAt } : {}),
    },
    include: { targets: { include: { target: true } }, author: { select: { name: true } } },
    orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return ok({
    posts: posts.map((post) => ({
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
      author: post.author.name,
      targets: post.targets.map((postTarget) => ({
        id: postTarget.id,
        name: postTarget.target.name,
        type: postTarget.target.type,
        status: postTarget.status,
        url: postTarget.remoteUrl,
        error: postTarget.errorMessage,
        attempts: postTarget.attempts,
        nextAttemptAt: postTarget.nextAttemptAt,
      })),
    })),
  });
});

export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = createPostSchema.parse(await readJson(request));

  const result = await createPost(
    { workspaceId: auth.workspace.id, userId: auth.user.id },
    input,
  );
  return ok(result, 201);
});
