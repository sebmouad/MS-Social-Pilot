export type DemographicRow = { label: string; value: number; /** Percent of this breakdown's own rows; null when the unit is not a count. */ share: number | null };
export type DemographicMetric = {
  key: string; label: string; sourceLabel: string; unit: string; coverage: number; available: number;
  history: Array<{ resourceId: string; resourceLabel: string; asOf: Date; fetchedAt: Date; rows: Array<{ label: string; value: number | null; share: number | null }> }>;
  historyCoverage: { covered: number; selected: number; oldestAsOf: Date | null; newestAsOf: Date | null };
  latestAt: Date | null; aggregationLabel: string; aggregationNote?: string; rows: DemographicRow[]; hiddenRows: number;
};
export type DemographicGroup = {
  id: string; label: string; metrics: DemographicMetric[];
  /** Category counts added across sources. Not deduplicated people; null when sources cannot be added. */
  combined: null | { rows: DemographicRow[]; hiddenRows: number; coverage: number | null; sources: number; oldestAsOf: Date | null; newestAsOf: Date | null; note: string };
};
