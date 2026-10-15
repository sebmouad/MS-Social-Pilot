import type { AnalyticsMetric } from '@/server/analytics/catalog';

/** Provider vocabulary and interpretation for stored Facebook Page and Meta Ads metrics. */
const metricNames: Record<string, string> = {
  page_follows: 'Followers', page_fans: 'Page likes',
  page_daily_follows: 'Daily follows', page_daily_follows_unique: 'New followers',
  page_daily_unfollows_unique: 'Lost followers', page_total_media_view_unique: 'People reached',
  page_impressions_unique: 'Unique impressions', page_impressions: 'Impressions',
  page_media_view: 'Media views', page_post_engagements: 'Post engagements',
  page_views_total: 'Page views', page_video_views: 'Video views',
  spend: 'Spend', impressions: 'Impressions', clicks: 'Clicks', reach: 'Reach',
  cpc: 'Cost per click', cpm: 'Cost per 1,000 impressions', cpp: 'Cost per person reached',
  ctr: 'Click-through rate', frequency: 'Frequency',
};

export function facebookMetricLabel(key: string): string | undefined {
  return metricNames[key];
}

export function facebookPageMetricKind(key: string): AnalyticsMetric['kind'] {
  if (['page_follows', 'page_fans', 'page_fans_online_per_day'].includes(key)) return 'stock';
  if (/country|city|locale|gender_age|source/.test(key)) return 'breakdown';
  return 'flow';
}

export function facebookAdMetricUnit(key: string, currency?: string | null): AnalyticsMetric['unit'] {
  if (key === 'spend' || ['cpc', 'cpm', 'cpp', 'action_values'].includes(key)) return currency ? 'currency' : 'count';
  if (key === 'ctr') return 'percent';
  if (key === 'frequency') return 'multiple';
  return 'count';
}
