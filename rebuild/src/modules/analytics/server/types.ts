import type { MetricView } from '@/modules/analytics/server/aggregate';
import type { PreviousPoint } from './previous-points';
import type { AnalyticsAdAccount, AnalyticsAudienceEntry, AnalyticsTarget } from '@/modules/analytics/server/catalog';

/** Fresh original-membership channel grants that authorize Ads data, independent of any credential's channel selection. */
export type AdAccountTargetScope = { all: true } | { all: false; ids: readonly string[] };
/** Optional independent ad-account ceiling: undefined means no ceiling, [] means none. */
export type AnalyticsAdCeiling = { allowedAdAccountIds?: readonly string[]; adAccountTargetScope?: AdAccountTargetScope };
export type AnalyticsReadActor = { userId: string; workspaceId: string } & AnalyticsAdCeiling;
export type AnalyticsReadConstraints = {
  allowedChannelIds?: readonly string[];
  feature?: 'analytics/overview' | 'analytics/reports' | 'analytics/explorer' | 'analytics/demographics' | 'analytics/pins' | 'analytics/goals' | 'analytics/compare';
};
export type AnalyticsReadInput = {
  start?: string;
  end?: string;
  compare?: 'none' | 'previous' | 'year';
  filter?: '1';
  channel?: string | string[];
  adFilter?: '1';
  adAccount?: string | string[];
  search?: string;
  metric?: string;
  page?: number | string;
  pointPage?: number | string;
  rowPage?: number | string;
};
export type AnalyticsPager<T> = { items: T[]; total: number; page: number; pages: number; pageSize: number };
export type AnalyticsPeriod = {
  start: string;
  end: string;
  range: { from: Date; to: Date };
  comparison: null | { mode: 'previous' | 'year'; start: string; end: string; range: { from: Date; to: Date } };
};
export type AnalyticsComparisonValue = { previous: number | null; delta: number | null; percent: number | null; status: 'comparable' | 'missing' | 'coverage_changed' | 'not_comparable' };
export type AnalyticsSnapshot = {
  period: AnalyticsPeriod;
  options: { channels: AnalyticsTarget[]; adAccounts: AnalyticsAdAccount[]; metrics: Array<Pick<MetricView, 'key' | 'label' | 'sourceLabel'>> };
  selected: { channelIds: string[]; adAccountIds: string[] };
  audience: { entries: AnalyticsAudienceEntry[]; total: number; covered: number; selected: number };
  publishing: { published: number; scheduled: number; failed: number };
  comparisons: Record<string, AnalyticsComparisonValue>;
  /** Previous-period series per metric key, aligned by relative day index to the current range; null marks a day with no stored value. */
  previousPoints: Record<string, PreviousPoint[]>;
  query: string;
  chartPoints: number;
  searchMaxLength: number;
  exportRowLimit: number;
  allMetrics: MetricView[];
};
export type AnalyticsReadResult = Omit<AnalyticsSnapshot, 'allMetrics'> & {
  metrics: AnalyticsPager<MetricView>;
  detail: null | {
    metric: MetricView;
    points: AnalyticsPager<MetricView['points'][number]>;
    rows: AnalyticsPager<MetricView['rows'][number]>;
  };
};
