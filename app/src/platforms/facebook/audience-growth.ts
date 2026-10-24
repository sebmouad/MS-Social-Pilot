import type { AnalyticsAudienceGrowthIdentity } from '@/modules/analytics/server/catalog';

/**
 * Stored Graph metric protocol identities, including retired Page-like measures.
 * Keep the exact metric key/period as the series key: these describe the meaning,
 * not permission to combine different metrics or count the same observations twice.
 * Unknown future metrics must be mapped explicitly rather than guessed as follows.
 */
export function facebookAudienceGrowthIdentity(metric: string): AnalyticsAudienceGrowthIdentity | undefined {
  switch (metric) {
    case 'page_fan_adds':
    case 'page_fan_adds_unique':
      return { kind: 'likes', direction: 'gained' };
    case 'page_fan_removes':
    case 'page_fan_removes_unique':
      return { kind: 'likes', direction: 'lost' };
    case 'page_daily_follows':
    case 'page_daily_follows_unique':
      return { kind: 'followers', direction: 'gained' };
    case 'page_daily_unfollows_unique':
      return { kind: 'followers', direction: 'lost' };
    default:
      return undefined;
  }
}
