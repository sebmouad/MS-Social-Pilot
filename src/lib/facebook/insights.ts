import type { PostInsights } from '../json';

const EMPTY: PostInsights = {
  impressions: null,
  reach: null,
  engagedUsers: null,
  reactions: null,
  comments: null,
  shares: null,
  clicks: null,
};

/**
 * Everything Graph will give us about one post: every catalogue metric plus
 * the engagement counters that live on the post object.
 *
 * A metric Meta has removed does not cost the rest of the request — the
 * fetcher isolates bad names by bisection.
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
