import { z } from 'zod';
import { TargetType } from '@prisma/client';

import { requireAuth } from '@/lib/auth';
import { assertPageParam } from '@/lib/page-access';
import { prisma } from '@/lib/prisma';
import { errors } from '@/lib/errors';
import { analysePage } from '@/lib/page-analysis-data';
import { syncPostInsights, syncTargetAnalytics } from '@/lib/analytics';
import { syncWorkspaceEdges } from '@/lib/engagement';
import { ok, readJson, route } from '@/lib/api';
import { refreshState, startRefresh } from '@/lib/background-refresh';

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
  assertPageParam(auth.pageScope, url.searchParams.get('targetId'));
  if (url.searchParams.get('status') === '1') {
    const page = await pageFor(auth.workspace.id, url.searchParams.get('targetId') ?? '');
    return ok(refreshState(refreshKey(auth.workspace.id, page.id)));
  }
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

/**
 * Start reading Facebook for this Page and answer at once; GET with
 * `status=1` says how it is going. The read can take longer than the proxy
 * waits, so it is never held open on the request (lib/background-refresh).
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = querySchema.parse(await readJson(request));
  assertPageParam(auth.pageScope, input.targetId);
  const page = await pageFor(auth.workspace.id, input.targetId);

  const state = startRefresh(refreshKey(auth.workspace.id, page.id), () =>
    refreshPage(auth.workspace.id, page.id, input.days),
  );
  return ok(state, 202);
});

function refreshKey(workspaceId: string, targetId: string): string {
  return `analysis:${workspaceId}:${targetId}`;
}

async function refreshPage(workspaceId: string, pageId: string, days: number) {
  const page = { id: pageId };
  const now = new Date();
  // Both halves of the comparison, and at least the ninety days the best-time
  // grid is drawn from.
  const since = new Date(now.getTime() - Math.max(days * 2, 90) * DAY_MS);

  const problems: string[] = [];

  const insights = await syncTargetAnalytics({ targetId: page.id, since, until: now });
  if (insights.error) problems.push(insights.error);

  // Only the Page's own posts: the analysis is built from posts and Page
  // figures, and the inbox, comments and videos have their own buttons.
  const edges = await syncWorkspaceEdges({ workspaceId, targetId: page.id, since, edges: ['externalPosts'] });
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

  return {
    stored: insights.stored,
    postsRefreshed: refreshed,
    // Each distinct problem once: one expired token fails every call the same way.
    problems: [...new Set(problems)].slice(0, 5),
  };
}
