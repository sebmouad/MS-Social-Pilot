import { z } from 'zod';

import { requireAuth } from '@/lib/auth';
import { assertPagesAllowed, postScope } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';
import { createStaggered } from '@/lib/stagger';
import { createCaptionTest } from '@/lib/caption-test';
import { createTranslated } from '@/lib/translated-posts';
import { createPostSchema } from '@/lib/validation';
import { parseLinkPreview, parseMedia } from '@/lib/json';
import { ok, readJson, route } from '@/lib/api';
import { errors } from '@/lib/errors';
import { postStatusFilter } from '@/lib/constants';

const rangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((range) => !range.from || !range.to || range.from.getTime() <= range.to.getTime());

/** List posts, newest scheduled first. Supports status and date filtering. */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const url = new URL(request.url);

  const statuses = postStatusFilter(url.searchParams.get('status') ?? undefined);
  const range = rangeSchema.safeParse({
    from: url.searchParams.get('from') || undefined,
    to: url.searchParams.get('to') || undefined,
  });
  // A malformed date used to become `Invalid Date`, which Prisma rejects deep
  // in the query — so a typo in a URL was a 500 and a logged "unhandled error".
  if (!range.success) throw errors.dateRange();
  const { from, to } = range.data;
  const limit = Math.min(Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 200);

  const scheduledAt: { gte?: Date; lte?: Date } = {};
  if (from) scheduledAt.gte = from;
  if (to) scheduledAt.lte = to;

  const posts = await prisma.post.findMany({
    where: {
      workspaceId: auth.workspace.id,
      ...postScope(auth.pageScope),
      ...(statuses ? { status: { in: statuses } } : {}),
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
  assertPagesAllowed(auth.pageScope, input.targetIds);

  const context = {
    workspaceId: auth.workspace.id,
    userId: auth.user.id,
    role: auth.role,
    requiresApproval: auth.workspace.requiresApproval,
  };
  const result = input.captionVariants?.length
    ? await createCaptionTest(context, input)
    : input.translations?.length
      ? await createTranslated(context, input)
      : await createStaggered(
          {
            ...context,
            locale: auth.workspace.defaultLocale,
            undoSendSeconds: (
              await prisma.workspace.findUniqueOrThrow({ where: { id: auth.workspace.id }, select: { undoSendSeconds: true } })
            ).undoSendSeconds,
          },
          input,
        );
  return ok(result, 201);
});
