import { workspaceCopyDefaults, workspaceText, type WorkspaceCopy } from '../workspace-copy';
import { aggregateValues, type AnalyticsAudienceEntry, type AnalyticsKind, type AnalyticsMetricInput } from './catalog';

export type MetricView = {
  key: string;
  label: string;
  sourceLabel: string;
  resourceKind: 'channel' | 'ad-account';
  aggregationLabel: string;
  aggregationNote?: string;
  unit: AnalyticsMetricInput['unit'];
  kind: AnalyticsKind;
  total: number | null;
  displayTotal?: string;
  latestAt: Date | null;
  updatedAt?: Date | null;
  coverage: number;
  available: number;
  coveredResourceIds?: string[];
  points: Array<{ date: string; label: string; value: number }>;
  breakdownHistory?: AnalyticsMetricInput['breakdownHistory'];
  rows: Array<{ label: string; value: number; asOf: Date | null }>;
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);
const formatDay = (value: string) => new Date(`${value}T12:00:00.000Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

function metricView(input: AnalyticsMetricInput, copy: WorkspaceCopy, locale: 'en' | 'fr'): MetricView {
  const t = workspaceText(copy, locale);
  const byDay = new Map<string, number>();
  const byChannel = new Map<string, { label: string; values: Array<{ date: Date; value: number }> }>();
  for (const observation of input.observations) {
    const day = isoDay(observation.date);
    byDay.set(day, (byDay.get(day) ?? 0) + observation.value);
    const channel = byChannel.get(observation.channelId) ?? { label: observation.channelLabel, values: [] };
    channel.values.push({ date: observation.date, value: observation.value });
    byChannel.set(observation.channelId, channel);
  }
  const points = [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, label: formatDay(date), value }));
  const observedResourceIds = [...new Set(input.observations.map(observation => observation.channelId).filter(id => id !== 'total'))].sort();
  const coveredResourceIds = input.coveredResourceIds ?? (observedResourceIds.length ? observedResourceIds : undefined);
  const generatedRows = [...byChannel.values()].map(channel => {
    channel.values.sort((a, b) => a.date.getTime() - b.date.getTime());
    const value = input.kind === 'stock' || input.rollup === 'latest-per-channel'
      ? channel.values.at(-1)!.value
      : input.kind === 'ratio'
        ? channel.values.at(-1)!.value
        : channel.values.reduce((sum, item) => sum + item.value, 0);
    return { label: channel.label, value, asOf: channel.values.at(-1)!.date };
  });
  const totalValues = (input.totalObservations ?? input.observations).slice().sort((a, b) => a.date.getTime() - b.date.getTime()).map(item => item.value);
  const rows = input.rows ?? generatedRows;
  const latestAt = input.latestAt !== undefined ? input.latestAt : input.observations.length
    ? new Date(Math.max(...input.observations.map(item => item.date.getTime())))
    : input.rows?.flatMap(row => row.asOf ? [row.asOf.getTime()] : []).length
      ? new Date(Math.max(...input.rows.flatMap(row => row.asOf ? [row.asOf.getTime()] : [])))
      : null;
  return {
    key: input.key,
    label: input.label,
    sourceLabel: input.sourceLabel,
    resourceKind: input.resourceKind ?? 'channel',
    aggregationLabel: input.aggregationLabel ?? (input.kind === 'breakdown' ? t("Latest category values")
      : input.kind === 'stock' || input.rollup === 'latest-per-channel' ? t("Latest value per resource")
        : input.kind === 'ratio' ? t("Calculated for the selected period") : t("Total over the selected period")),
    aggregationNote: input.aggregationNote,
    unit: input.unit,
    kind: input.kind,
    total: input.totalOverride !== undefined ? input.totalOverride : input.kind === 'breakdown' ? null : input.kind === 'stock' || input.rollup === 'latest-per-channel'
      ? generatedRows.reduce((sum, row) => sum + row.value, 0)
      : aggregateValues(totalValues, input.kind),
    ...(input.displayTotal ? { displayTotal: input.displayTotal } : {}),
    latestAt,
    updatedAt: input.updatedAt,
    coverage: input.covered ?? (input.kind === 'breakdown' ? rows.length : byChannel.size),
    available: input.available,
    ...(coveredResourceIds ? { coveredResourceIds: [...coveredResourceIds] } : {}),
    points,
    ...(input.breakdownHistory ? { breakdownHistory: input.breakdownHistory } : {}),
    rows: rows.slice().sort((a, b) => b.value - a.value),
  };
}

/** Generic aggregation over normalized inputs. It has no provider/schema knowledge. */
export function buildAnalytics(metrics: AnalyticsMetricInput[], audienceEntries: AnalyticsAudienceEntry[], audienceSelected: number, copy: WorkspaceCopy = workspaceCopyDefaults, locale: 'en' | 'fr' = 'en') {
  const audience = {
    entries: audienceEntries,
    total: audienceEntries.reduce((sum, row) => sum + row.value, 0),
    covered: audienceEntries.length,
    selected: audienceSelected,
  };
  return {
    audience,
    metrics: metrics.map(metric => metricView(metric, copy, locale)).sort((a, b) => a.sourceLabel === b.sourceLabel ? a.label.localeCompare(b.label) : a.sourceLabel.localeCompare(b.sourceLabel)),
  };
}
