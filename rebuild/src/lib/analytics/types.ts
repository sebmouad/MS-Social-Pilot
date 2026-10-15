import type { MetricAggregation, MetricGroup, MetricUnit } from '@/platforms/metrics';

/** How a value is written. `currency` is an ISO code, or null when the account does not report one. */
export type ValueFormat = { unit: MetricUnit; style?: 'percent' | 'multiple' | 'money'; currency: string | null };

export type Change = {
  absolute: number;
  /** null when the previous period was zero, so a percentage would be meaningless. */
  percent: number | null;
  direction: 'up' | 'down' | 'flat';
  /** True when the move is an improvement, false when it is a decline, null when direction has no good or bad side. */
  favourable: boolean | null;
};

export type ChannelValues = {
  id: string;
  name: string;
  total: number | null;
  previousTotal: number | null;
  values: Array<number | null>;
};

export type SeriesTechnical = {
  /** Stored metric name. Developer detail only. */
  storedName: string;
  period: string;
  source: string | null;
  firstDay: string | null;
  lastDay: string | null;
  lastSynced: string | null;
  points: number;
};

export type OverviewSeries = {
  id: string;
  name: string;
  definition: string;
  group: MetricGroup;
  groupLabel: string;
  format: ValueFormat;
  aggregation: MetricAggregation;
  headline: boolean;
  lowerIsBetter: boolean;
  /** Value for the whole range; null when there is no data. */
  total: number | null;
  /** Distinct people cannot be added: the total is a ceiling, shown as "up to". */
  upTo: boolean;
  /** Recomputed from parts that include distinct people, so it is an estimate. */
  approximate: boolean;
  previousTotal: number | null;
  change: Change | null;
  /** One value per day of the range; null where nothing was stored. */
  values: Array<number | null>;
  /** The equal-length period before, aligned day by day with `values`. */
  previousValues: Array<number | null>;
  entityLabel: 'channel' | 'ad account';
  channels: ChannelValues[];
  coverage: number;
  available: number;
  /** For rolling-window metrics, for example "last 28 days". */
  windowLabel: string | null;
  technical: SeriesTechnical;
};

export type BreakdownView = {
  id: string;
  name: string;
  definition: string;
  rows: Array<{ label: string; value: number }>;
  coverage: number;
  available: number;
  asOf: string | null;
  technical: SeriesTechnical;
};

export type RetiredMetric = {
  id: string;
  name: string;
  definition: string;
  retiredOn: string;
  replacedByName: string | null;
  /** Customer-facing name of the module that supplied the metric. */
  source: string | null;
  storedName: string;
};

export type AnalyticsOverview = {
  days: string[];
  previousDays: string[];
  timeZone: string;
  series: OverviewSeries[];
  breakdowns: BreakdownView[];
  retired: RetiredMetric[];
};

export type TopPost = {
  id: string;
  /** Opening text of the post. */
  excerpt: string;
  channelName: string;
  publishedAt: string;
  url: string | null;
  comments: number | null;
  likes: number | null;
  /** Everything stored about reactions to the post, added together. */
  interactions: number;
};
