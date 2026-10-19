import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { runtimeConfig } from '@/server/config/store';
import type { MetricView } from '@/modules/analytics/server/aggregate';
import { readAnalyticsSnapshot } from '../../server/read';
import { authorize, type Actor } from '../../server/access';
import { demographicDimensionsSchema, type DemographicDimension } from '../config';
import type { DemographicGroup, DemographicMetric, DemographicRow } from '../contracts';

const tokens = (metric: Pick<MetricView, 'label' | 'key'>) => new Set(`${metric.label} ${metric.key}`.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));

/** First configured dimension whose term appears as a whole word in the metric's label or key. */
export function dimensionOf(metric: Pick<MetricView, 'label' | 'key'>, dimensions: readonly DemographicDimension[]): DemographicDimension | null {
  const words = tokens(metric);
  return dimensions.find(dimension => dimension.terms.some(term => words.has(term))) ?? null;
}
function rowsWithShare(rows: Array<{ label: string; value: number }>, unit: string, cap: number): { rows: DemographicRow[]; hiddenRows: number } {
  const sorted = rows.filter(row => Number.isFinite(row.value)).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const sum = unit === 'count' ? sorted.reduce((total, row) => total + row.value, 0) : 0;
  return { rows: sorted.slice(0, cap).map(row => ({ label: row.label, value: row.value, share: sum > 0 ? (row.value / sum) * 100 : null })), hiddenRows: Math.max(0, sorted.length - cap) };
}
function toMetric(metric: MetricView, cap: number): DemographicMetric {
  const { rows, hiddenRows } = rowsWithShare(metric.rows, metric.unit, cap);
  return { key: metric.key, label: metric.label, sourceLabel: metric.sourceLabel, unit: metric.unit, coverage: metric.coverage, available: metric.available, latestAt: metric.latestAt, aggregationLabel: metric.aggregationLabel, ...(metric.aggregationNote ? { aggregationNote: metric.aggregationNote } : {}), rows, hiddenRows };
}
export async function readDemographics(actor: Actor, input: unknown = {}) {
  await authorize(actor, 'analytics/demographics', 'read');
  const [rawDimensions, rawCap] = await Promise.all([runtimeConfig('analytics.demographics.dimensions'), runtimeConfig('analytics.demographics.maxRowsPerMetric')]);
  const dimensions = demographicDimensionsSchema.safeParse(rawDimensions);
  const cap = z.number().int().min(1).max(500).safeParse(rawCap);
  if (!dimensions.success || !cap.success) throw new OperationError('unavailable', 'Audience breakdowns are temporarily unavailable.');
  const snapshot = await readAnalyticsSnapshot(actor, input ?? {}, { feature: 'analytics/demographics', allowedChannelIds: actor.allowedChannelIds });
  const breakdowns = snapshot.allMetrics.filter(metric => metric.kind === 'breakdown' && metric.resourceKind === 'channel');
  const grouped = new Map<string, MetricView[]>(); const other: MetricView[] = [];
  for (const metric of breakdowns) {
    const dimension = dimensionOf(metric, dimensions.data);
    if (!dimension) { other.push(metric); continue; }
    grouped.set(dimension.id, [...(grouped.get(dimension.id) ?? []), metric]);
  }
  // A shared category dimension does not prove compatible measures or disjoint
  // populations. The neutral metric contract cannot justify cross-metric sums.
  const groups: DemographicGroup[] = dimensions.data.flatMap(dimension => {
    const metrics = grouped.get(dimension.id);
    return metrics?.length ? [{ id: dimension.id, label: dimension.label, metrics: metrics.map(metric => toMetric(metric, cap.data)), combined: null }] : [];
  });
  const result = {
    ok: true as const, period: snapshot.period, selected: snapshot.selected, options: snapshot.options,
    audience: { total: snapshot.audience.total, covered: snapshot.audience.covered, selected: snapshot.audience.selected, entries: snapshot.audience.entries.map(entry => ({ id: entry.id, name: entry.name, value: entry.value, asOf: entry.asOf })), note: 'Audience adds the latest valid figure for each covered channel. It is not a count of unique people across networks.' },
    groups, other: other.map(metric => toMetric(metric, cap.data)),
    empty: groups.length === 0 && other.length === 0,
  };
  const itemCount = result.audience.entries.length + result.groups.length + result.other.length + result.options.channels.length + result.options.adAccounts.length + result.options.metrics.length + result.groups.reduce((total, group) => total + group.metrics.length + (group.combined?.rows.length ?? 0) + group.metrics.reduce((rows, metric) => rows + metric.rows.length, 0), 0) + result.other.reduce((total, metric) => total + metric.rows.length, 0);
  const hiddenRows = [...result.groups.flatMap(group => group.metrics.map(metric => metric.hiddenRows)), ...result.groups.map(group => group.combined?.hiddenRows ?? 0), ...result.other.map(metric => metric.hiddenRows)].reduce((sum, count) => sum + count, 0);
  if (actor.maxResultItems !== undefined && (!Number.isSafeInteger(actor.maxResultItems) || actor.maxResultItems < 1 || itemCount > actor.maxResultItems || hiddenRows > 0)) {
    throw new OperationError('invalid_request', 'This audience breakdown is larger than the current MCP result limit. Narrow the selected channels or date range.');
  }
  return result;
}
