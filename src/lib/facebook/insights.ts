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
  // Views and viewers are Meta's replacements for impressions (retired
  // 15 November 2025) and reach (retired 29 July 2026), on every version.
  // The old names were requested here in one call, and one retired name makes
  // Graph refuse the whole request — so every post read no reach at all.
  'post_media_view',
  'post_total_media_view_unique',
  'post_clicks',
] as const;

interface InsightsResponse {
  data: Array<{
    name: string;
    values: Array<{ value: number }>;
  }>;
}

interface EngagementResponse {
  reactions?: { summary?: { total_count?: number } };
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
      params: { fields: 'reactions.summary(total_count).limit(0),comments.summary(true).limit(0),shares' },
    });
    // `reactions`, not `likes`: the likes edge counts only the thumbs-up, so a
    // post with hearts and laughs read as far less engaging than it was.
    result.reactions = data.reactions?.summary?.total_count ?? data.likes?.summary?.total_count ?? null;
    result.comments = data.comments?.summary?.total_count ?? null;
    result.shares = data.shares?.count ?? 0;
  } catch (error) {
    // A deleted post yields code 100; surface that, hide everything else.
    if (error instanceof GraphError && error.kind === 'auth') throw error;
  }

  if (options.includeInsights === false) return result;

  const apply = (data: InsightsResponse) => {
    for (const metric of data.data ?? []) {
      const value = metric.values?.[0]?.value ?? null;
      switch (metric.name) {
        case 'post_media_view':
          result.impressions = value;
          break;
        case 'post_total_media_view_unique':
          result.reach = value;
          break;
        case 'post_clicks':
          result.clicks = value;
          break;
      }
    }
  };

  try {
    const { data } = await graphRequest<InsightsResponse>(`${remotePostId}/insights`, {
      accessToken,
      params: { metric: INSIGHT_METRICS.join(',') },
    });
    apply(data);
  } catch (error) {
    if (error instanceof GraphError && error.kind === 'auth') throw error;
    // One name Meta has since retired fails the whole request. Ask for each on
    // its own, so the next retirement costs one figure rather than all three.
    // Groups have no insights edge at all, and fail each of these too.
    for (const metric of INSIGHT_METRICS) {
      try {
        const { data } = await graphRequest<InsightsResponse>(`${remotePostId}/insights`, {
          accessToken,
          params: { metric },
        });
        apply(data);
      } catch (inner) {
        if (inner instanceof GraphError && inner.kind === 'auth') throw inner;
      }
    }
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

/**
 * Aggregate per-destination insights into workspace totals.
 *
 * Only the flat numeric fields are summed. Breakdown maps and the raw
 * `metrics` bag are skipped: adding two country maps together is a different
 * operation, handled by `mergeBreakdowns`.
 */
const SUMMABLE_KEYS = [
  'impressions',
  'reach',
  'engagedUsers',
  'reactions',
  'comments',
  'shares',
  'clicks',
  'impressionsOrganic',
  'impressionsPaid',
  'impressionsViral',
  'impressionsFan',
  'negativeFeedback',
  'videoViews',
  'videoViewTime',
] as const satisfies ReadonlyArray<keyof PostInsights>;

export function sumInsights(items: Array<PostInsights | null>): PostInsights {
  const total: PostInsights = { ...EMPTY };

  for (const item of items) {
    if (!item) continue;
    for (const key of SUMMABLE_KEYS) {
      const value = item[key];
      if (typeof value === 'number') {
        total[key] = ((total[key] as number | null) ?? 0) + value;
      }
    }
  }
  return total;
}

/** Add breakdown maps together, key by key. */
export function mergeBreakdowns(
  maps: Array<Record<string, number> | undefined | null>,
): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [key, value] of Object.entries(map)) {
      if (typeof value === 'number') merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}
