/** Shared vocabulary for stored analytics, independent of any provider SDK or schema. */
export type AnalyticsKind = 'stock' | 'flow' | 'ratio' | 'breakdown';
export type AnalyticsUnit = 'count' | 'currency' | 'percent' | 'multiple';

export type AnalyticsTarget = { id: string; name: string; type: string; providerId?: string };
export type AnalyticsAdAccount = { id: string; name: string; currency: string | null };
export type AnalyticsObservation = { date: Date; channelId: string; channelLabel: string; value: number };
export type AnalyticsMetricRow = { label: string; value: number; asOf: Date | null };

/** Provider-mapped input to the shared chart and total aggregator. */
export type AnalyticsMetricInput = {
  key: string;
  label: string;
  /** Human-readable provenance shown to customers, such as "Community" or "Advertising". */
  sourceLabel: string;
  /** Cross-platform resource domain, independent of translated provenance labels. */
  resourceKind?: 'channel' | 'ad-account';
  /** Exact resource IDs represented by this metric when the module can provide them. */
  coveredResourceIds?: string[];
  kind: AnalyticsKind;
  unit: AnalyticsUnit;
  observations: AnalyticsObservation[];
  /** Provider-owned explanation of limitations in aggregation. */
  aggregationNote?: string;
  aggregationLabel?: string;
  /** How a module says observations combine across a stored window. */
  rollup?: 'sum' | 'latest-per-channel';
  /** Ratios can use a separately weighted overall series while retaining account rows. */
  totalObservations?: Array<{ date: Date; value: number }>;
  /** Provider-supplied account rows for weighted ratios or pre-normalized breakdowns. */
  rows?: AnalyticsMetricRow[];
  available: number;
  covered?: number;
  latestAt?: Date | null;
  updatedAt?: Date | null;
  totalOverride?: number | null;
  displayTotal?: string;
};

export type AnalyticsAudienceEntry = {
  id: string;
  name: string;
  metric: string;
  metricLabel: string;
  sourceLabel: string;
  value: number;
  asOf: Date;
  fetchedAt: Date;
};

export type AnalyticsProviderRequest = {
  workspaceId: string;
  range: { from: Date; to: Date };
  selectedTargetIds: readonly string[];
  allowedTargetIds?: readonly string[];
  selectedAdAccountIds?: readonly string[];
  /** Independent ad-account ceiling: undefined is no ceiling, an empty list is no access. */
  allowedAdAccountIds?: readonly string[];
  /** Channel grants authorizing Ads data; undefined means all. When the key is absent, allowedTargetIds applies. */
  allowedAdTargetIds?: readonly string[];
};

export type AnalyticsProviderData = {
  targets: AnalyticsTarget[];
  selectedTargets: AnalyticsTarget[];
  adAccounts: AnalyticsAdAccount[];
  selectedAdAccountIds: string[];
  metrics: AnalyticsMetricInput[];
  audienceEntries: AnalyticsAudienceEntry[];
  audienceSelected: number;
};

export function genericMetricLabel(key: string): string {
  return key.replace(/[:_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function aggregateValues(values: number[], kind: AnalyticsKind): number | null {
  if (!values.length) return null;
  if (kind === 'stock' || kind === 'ratio') return values[values.length - 1] ?? null;
  return values.reduce((sum, value) => sum + value, 0);
}

export function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}
