import { z } from 'zod';
import { TargetType } from '@prisma/client';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { errors } from '@/lib/errors';
import { analysePage } from '@/lib/page-analysis-data';
import { syncPostInsights, syncTargetAnalytics } from '@/lib/analytics';
import { syncWorkspaceEdges } from '@/lib/engagement';
import { ok, readJson, route } from '@/lib/api';

/**
 * Page analysis, as data — and the button that brings it up to date.
 *
 * GET answers from what is stored, instantly. POST reads Facebook first: the
 * Page's daily figures over this period and the one before it, the posts made
 * on the Page with their insights, and the insights of recent posts published
 * from here. That is everything the analysis is built from, so one press
 * leaves nothing stale behind it.
 */
export const dynamic = 'force-dynamic';
/** A Page with a long history and many posts takes a while to read. */
export const maxDuration = 120;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Our own posts refreshed per press: the worker catches up on the rest. */
const POSTS_PER_REFRESH = 25;

const querySchema = z.object({
  targetId: z.string().min(1),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

async function pageFor(workspaceId: string, targetId: string) {
  const page = await prisma.target.findFirst({
    where: { id: targetId, workspaceId, type: TargetType.page },
    select: { id: true },
  });
  if (!page) throw errors.destinationNotFound();
  return page;
}

export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const url = new URL(request.url);
  const input = querySchema.parse({
    targetId: url.searchParams.get('targetId') ?? undefined,
    days: url.searchParams.get('days') ?? undefined,
  });

  const to = new Date();
  const from = new Date(to.getTime() - input.days * DAY_MS);

  return ok({
    analysis: await analysePage({
      workspaceId: auth.workspace.id,
      targetId: input.targetId,
      from,
      to,
      timeZone: auth.workspace.timezone,
    }),
  });
});

export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = querySchema.parse(await readJson(request));
  const page = await pageFor(auth.workspace.id, input.targetId);

  const now = new Date();
  // Both halves of the comparison, and at least the ninety days the best-time
  // grid is drawn from.
  const since = new Date(now.getTime() - Math.max(input.days * 2, 90) * DAY_MS);

  const problems: string[] = [];

  const insights = await syncTargetAnalytics({ targetId: page.id, since, until: now });
  if (insights.error) problems.push(insights.error);

  const edges = await syncWorkspaceEdges({ workspaceId: auth.workspace.id, targetId: page.id, since });
  for (const result of edges.results) {
    for (const failure of result.errors) problems.push(`${failure.edge}: ${failure.message}`);
  }

  const ours = await prisma.postTarget.findMany({
    where: { targetId: page.id, status: 'published', remotePostId: { not: null }, publishedAt: { gte: since } },
    orderBy: [{ insightsSyncedAt: { sort: 'asc', nulls: 'first' } }, { publishedAt: 'desc' }],
    take: POSTS_PER_REFRESH,
    select: { id: true },
  });
  let refreshed = 0;
  for (const row of ours) {
    const result = await syncPostInsights(row.id);
    if (result.ok) refreshed += 1;
    else if (result.error) problems.push(result.error);
  }

  return ok({
    stored: insights.stored,
    postsRefreshed: refreshed,
    // Each distinct problem once: one expired token fails every call the same way.
    problems: [...new Set(problems)].slice(0, 5),
  });
});
