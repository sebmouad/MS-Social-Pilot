import { localizeAnalyticsError } from '@/modules/analytics/server/error-copy';
import { analyticsError } from '@/modules/analytics/server/error-copy';
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
  const history = (metric.breakdownHistory ?? []).map(snapshot => {
    const total = snapshot.rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
    const complete = snapshot.rows.every(row => row.value !== null);
    return { ...snapshot, rows: snapshot.rows.map(row => ({ ...row,
      share: metric.unit === 'count' && complete && total > 0 && row.value !== null ? row.value / total * 100 : null })) };
  });
  const times = history.map(item => item.asOf.getTime());
  return { history, historyCoverage: { covered: new Set(history.filter(item => item.rows.some(row => row.value !== null)).map(item => item.resourceId)).size, selected: metric.available,
    oldestAsOf: times.length ? new Date(Math.min(...times)) : null, newestAsOf: times.length ? new Date(Math.max(...times)) : null }, key: metric.key, label: metric.label, sourceLabel: metric.sourceLabel, unit: metric.unit, coverage: metric.coverage, available: metric.available, latestAt: metric.latestAt, aggregationLabel: metric.aggregationLabel, ...(metric.aggregationNote ? { aggregationNote: metric.aggregationNote } : {}), rows, hiddenRows };
}
export async function readDemographics(actor: Actor, input: unknown = {}) {
  try {
  await authorize(actor, 'analytics/demographics', 'read');
  const [rawDimensions, rawCap] = await Promise.all([runtimeConfig('analytics.demographics.dimensions'), runtimeConfig('analytics.demographics.maxRowsPerMetric')]);
  const dimensions = demographicDimensionsSchema.safeParse(rawDimensions);
  const cap = z.number().int().min(1).max(500).safeParse(rawCap);
  if (!dimensions.success || !cap.success) throw await analyticsError('unavailable', "Audience breakdowns are temporarily unavailable.");
  const parsed = z.object({ format: z.enum(['json', 'csv']).optional() }).passthrough().safeParse(input ?? {});
  if (!parsed.success) throw await analyticsError('invalid_request', "Choose a valid demographics format.");
  const { format, ...filters } = parsed.data;
  const snapshot = await readAnalyticsSnapshot(actor, filters, { feature: 'analytics/demographics', allowedChannelIds: actor.allowedChannelIds });
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
  const metrics = [...groups.flatMap(group => group.metrics), ...result.other];
  const countItems = () => metrics.reduce((sum, metric) => sum + metric.history.reduce((count, item) => count + 1 + item.rows.length, 0), 0);
  const historyLimit = Number(snapshot.exportRowLimit);
  const historyTotalItems = countItems();
  if (historyTotalItems > 0 && (!Number.isSafeInteger(historyLimit) || historyLimit < 1)) throw await analyticsError('unavailable', "Audience history settings are unavailable.");
  // Real Pages hold years of daily snapshots, so full history routinely exceeds the row limit. Drop the
  // oldest snapshots first (each metric always keeps its latest) and mark the cut explicitly, following
  // the compare/reports truncation precedent; only genuinely undisplayable history still refuses.
  let historyTruncated = false;
  let droppedSnapshots = 0;
  for (let historyItems = historyTotalItems; historyItems > historyLimit;) {
    const victim = metrics.filter(metric => metric.history.length > 1)
      .sort((a, b) => b.history.length - a.history.length || a.history[0]!.asOf.getTime() - b.history[0]!.asOf.getTime())[0];
    if (!victim) throw await analyticsError('invalid_request', "Audience history exceeds the report row limit. Narrow the channels or date range.");
    historyItems -= 1 + victim.history[0]!.rows.length;
    victim.history.shift();
    droppedSnapshots += 1;
    const times = victim.history.map(item => item.asOf.getTime());
    victim.historyCoverage = { ...victim.historyCoverage, covered: new Set(victim.history.filter(item => item.rows.some(row => row.value !== null)).map(item => item.resourceId)).size,
      oldestAsOf: times.length ? new Date(Math.min(...times)) : null };
    historyTruncated = true;
  }
  const historyShownItems = countItems();
  const historyShownSnapshots = metrics.reduce((sum, metric) => sum + metric.history.length, 0);
  const itemCount = historyShownItems + result.audience.entries.length + result.groups.length + result.other.length + result.options.channels.length + result.options.adAccounts.length + result.options.metrics.length + result.groups.reduce((total, group) => total + group.metrics.length + (group.combined?.rows.length ?? 0) + group.metrics.reduce((rows, metric) => rows + metric.rows.length, 0), 0) + result.other.reduce((total, metric) => total + metric.rows.length, 0);
  const hiddenRows = [...result.groups.flatMap(group => group.metrics.map(metric => metric.history.length ? 0 : metric.hiddenRows)), ...result.groups.map(group => group.combined?.hiddenRows ?? 0), ...result.other.map(metric => metric.history.length ? 0 : metric.hiddenRows)].reduce((sum, count) => sum + count, 0);
  if (actor.maxResultItems !== undefined && (!Number.isSafeInteger(actor.maxResultItems) || actor.maxResultItems < 1 || itemCount > actor.maxResultItems || hiddenRows > 0)) {
    throw await analyticsError('invalid_request', "This audience breakdown is larger than the current MCP result limit. Narrow the selected channels or date range.");
  }
  return { ...result, historyTruncated, historyShownItems, historyTotalItems, historyShownSnapshots, historyTotalSnapshots: historyShownSnapshots + droppedSnapshots, csv: format === 'csv' ? demographicsCsv(metrics, historyTruncated) : null };

  } catch (error) { throw await localizeAnalyticsError(error); }
}

/** Quote every cell and neutralize spreadsheet formulas, including category names. A trimmed export ends with an explicit marker row. */
export function demographicsCsv(metrics: DemographicMetric[], truncated = false) {
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? 'Not available' : String(value);
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  const rows: unknown[][] = [['Metric', 'Source', 'Unit', 'Channel ID', 'Channel', 'As of (UTC)', 'Fetched at (UTC)', 'Covered channels', 'Selected channels', 'Category', 'Value', 'Share (%)']];
  for (const metric of metrics) for (const item of metric.history) for (const row of item.rows) rows.push([
    metric.key, metric.sourceLabel, metric.unit, item.resourceId, item.resourceLabel, item.asOf.toISOString(), item.fetchedAt.toISOString(),
    metric.historyCoverage.covered, metric.historyCoverage.selected, row.label, row.value, row.share,
  ]);
  if (truncated) rows.push(['truncated', 'true', '', '', '', '', '', '', '', '', '', '']);
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
