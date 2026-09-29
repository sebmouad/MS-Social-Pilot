import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import { canRefreshAnalytics, syncPostInsights, throttleAnalyticsRefresh } from '@/lib/analytics';
import { ok, route } from '@/lib/api';
import { errors } from '@/lib/errors';

/**
 * Pull fresh engagement numbers for recently published posts.
 *
 * Deliberately batched and stale-first: refreshing everything on every page
 * load would burn the app's rate limit, since these counters move slowly.
 *
 * Reads through `syncPostInsights` — the same function the worker's analytics
 * job uses. It used to call a smaller reader that returned seven fields, so
 * pressing refresh here *overwrote* the full catalogue the job had stored and
 * silently emptied the per-post metric explorer until the next scheduled pass.
 * One reader, one shape.
 *
 * Editor and above, and throttled per workspace, for the same reason as the
 * per-Page sync: each press is a Graph call per post in the batch.
 */
export const POST = route(async () => {
  const auth = await requireAuth();
  if (!canRefreshAnalytics(auth.role)) throw errors.noPermission();
  throttleAnalyticsRefresh(auth.workspace.id);

  const rows = await prisma.postTarget.findMany({
    where: {
      status: 'published',
      remotePostId: { not: null },
      post: { workspaceId: auth.workspace.id },
    },
    orderBy: [{ insightsSyncedAt: { sort: 'asc', nulls: 'first' } }, { publishedAt: 'desc' }],
    // Half the worker's batch: this one runs while somebody waits for it.
    take: Math.max(1, Math.floor(env.analyticsBatch / 2)),
    select: { id: true, target: { select: { name: true } } },
  });

  let refreshed = 0;
  let metrics = 0;
  const failures: string[] = [];

  for (const row of rows) {
    const result = await syncPostInsights(row.id);
    if (result.ok) {
      refreshed += 1;
      metrics += result.metrics;
    } else if (result.error) {
      failures.push(`${row.target.name}: ${result.error}`);
    }
  }

  return ok({ refreshed, checked: rows.length, metrics, errors: failures });
});
