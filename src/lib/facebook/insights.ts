import type { PostInsights } from '../json';
import { GraphError, graphRequest } from './graph';

/**
 * Post-level analytics.
 *
 * Two calls, because Facebook splits the numbers across two places:
 *   - engagement counts live on the post object as summary totals;
 *   - impressions/reach/clicks live on the /insights edge and are Pages-only.
 *
 * Insights metric names change between Graph versions and some are silently
 * dropped, so a failure to read insights degrades to "engagement only" rather
 * than failing the whole refresh.
 */

/**
 * The subset kept on PostTarget for lists and reports. The *full* catalogue is
 * fetched separately by src/lib/facebook/analytics.ts — these are the few
 * figures every screen needs, so they are denormalised onto the row rather than
 * re-read from the insights store each render.
 */
const INSIGHT_METRICS = [
  'post_impressions',
  'post_impressions_unique',
  'post_engaged_users',
  'post_clicks',
] as const;

interface InsightsResponse {
  data: Array<{
    name: string;
    values: Array<{ value: number }>;
  }>;
}

interface EngagementResponse {
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  shares?: { count?: number };
}

const EMPTY: PostInsights = {
  impressions: null,
  reach: null,
  engagedUsers: null,
  reactions: null,
  comments: null,
  shares: null,
  clicks: null,
};

export async function fetchPostInsights(
  remotePostId: string,
  accessToken: string,
  options: { includeInsights?: boolean } = {},
): Promise<PostInsights> {
  const result: PostInsights = { ...EMPTY };

  // Engagement counts: available for both Pages and Groups.
  try {
    const { data } = await graphRequest<EngagementResponse>(remotePostId, {
      accessToken,
      params: { fields: 'likes.summary(true).limit(0),comments.summary(true).limit(0),shares' },
    });
    result.reactions = data.likes?.summary?.total_count ?? null;
    result.comments = data.comments?.summary?.total_count ?? null;
    result.shares = data.shares?.count ?? 0;
  } catch (error) {
    // A deleted post yields code 100; surface that, hide everything else.
    if (error instanceof GraphError && error.kind === 'auth') throw error;
  }

  if (options.includeInsights === false) return result;

  try {
    const { data } = await graphRequest<InsightsResponse>(`${remotePostId}/insights`, {
      accessToken,
      params: { metric: INSIGHT_METRICS.join(',') },
    });

    for (const metric of data.data ?? []) {
      const value = metric.values?.[0]?.value ?? null;
      switch (metric.name) {
        case 'post_impressions':
          result.impressions = value;
          break;
        case 'post_impressions_unique':
          result.reach = value;
          break;
        case 'post_engaged_users':
          result.engagedUsers = value;
          break;
        case 'post_clicks':
          result.clicks = value;
          break;
      }
    }
  } catch (error) {
    if (error instanceof GraphError && error.kind === 'auth') throw error;
    // Groups have no insights edge, and metric names drift between versions —
    // engagement numbers alone are still worth showing.
  }

  return result;
}

/**
 * Everything Graph will give us about one post: every catalogue metric plus
 * the engagement counters that live on the post object.
 *
 * Unlike {@link fetchPostInsights}, a metric Meta has removed does not cost the
 * rest of the request — the fetcher isolates bad names by bisection.
 */
export async function fetchFullPostInsights(
  remotePostId: string,
  accessToken: string,
): Promise<{
  engagement: Awaited<ReturnType<typeof import('./analytics').fetchPostEngagement>> | null;
  series: Awaited<ReturnType<typeof import('./analytics').fetchInsights>>;
}> {
  const { fetchInsights, fetchPostEngagement } = await import('./analytics');

  const [engagement, series] = await Promise.all([
    fetchPostEngagement(remotePostId, accessToken).catch(() => null),
    fetchInsights({
      objectId: remotePostId,
      level: 'post',
      accessToken,
      period: 'lifetime',
    }),
  ]);

  return { engagement, series };
}

/** Aggregate per-destination insights into workspace totals for the dashboard. */
export function sumInsights(items: Array<PostInsights | null>): PostInsights {
  const total: PostInsights = { ...EMPTY };
  const keys = Object.keys(total) as Array<keyof PostInsights>;

  for (const item of items) {
    if (!item) continue;
    for (const key of keys) {
      const value = item[key];
      if (typeof value === 'number') {
        total[key] = (total[key] ?? 0) + value;
      }
    }
  }
  return total;
}
