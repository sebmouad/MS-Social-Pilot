export type AnalyticsMetric = {
  key: string;
  label: string;
  source: 'page' | 'ads';
  kind: 'stock' | 'flow' | 'ratio' | 'breakdown';
  unit: 'count' | 'currency' | 'percent' | 'multiple';
};

const names: Record<string, string> = {
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

export function metricLabel(key: string): string {
  return names[key] ?? key.replace(/^page_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function pageMetricKind(key: string): AnalyticsMetric['kind'] {
  if (['page_follows', 'page_fans', 'page_fans_online_per_day'].includes(key)) return 'stock';
  if (/country|city|locale|gender_age|source/.test(key)) return 'breakdown';
  return 'flow';
}

export function adMetricUnit(key: string, currency?: string | null): AnalyticsMetric['unit'] {
  if (key === 'spend' || ['cpc', 'cpm', 'cpp', 'action_values'].includes(key)) return currency ? 'currency' : 'count';
  if (key === 'ctr') return 'percent';
  if (key === 'frequency') return 'multiple';
  return 'count';
}

export function aggregateValues(values: number[], kind: AnalyticsMetric['kind']): number | null {
  if (!values.length) return null;
  if (kind === 'stock' || kind === 'ratio') return values[values.length - 1] ?? null;
  return values.reduce((sum, value) => sum + value, 0);
}

export function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}
