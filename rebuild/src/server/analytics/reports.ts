import { buildAnalytics } from './aggregate';
import type { loadAnalytics } from './data';

type AnalyticsData = Awaited<ReturnType<typeof loadAnalytics>>;

/** Builds one report view from the exact same scoped stored analytics snapshot as Analytics. */
export function buildReportOverview(data: AnalyticsData) {
  return buildAnalytics(data.metrics, data.audienceEntries, data.audienceSelected);
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
  // Keep spreadsheet applications from interpreting provider-controlled text as formulas.
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@\-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** A stable long-form CSV; truncation is explicit and the row ceiling is shared by all callers. */
export function reportOverviewCsv(view: ReturnType<typeof buildReportOverview>, limit: number) {
  const cap = Math.max(0, Math.floor(limit));
  const rows: unknown[][] = [['record_type', 'metric', 'source', 'channel', 'date', 'value', 'unit']];
  for (const entry of view.audience.entries) rows.push(['audience', entry.metric, entry.sourceLabel, entry.name, entry.asOf, entry.value, 'people']);
  for (const metric of view.metrics) {
    for (const point of metric.points) rows.push(['metric', metric.label, metric.sourceLabel, '', point.date, point.value, metric.unit]);
    for (const row of metric.rows) rows.push(['channel', metric.label, metric.sourceLabel, row.label, row.asOf, row.value, metric.unit]);
  }
  const body = rows.slice(1, cap + 1).map(row => row.map(csvCell).join(','));
  const truncated = rows.length - 1 > cap;
  return { csv: [rows[0]!.map(csvCell).join(','), ...body, ...(truncated ? [csvCell('truncated') + ',' + csvCell('true')] : [])].join('\r\n') + '\r\n', rowCount: body.length, truncated };
}

/** Exports the full filtered snapshot, regardless of the visible metric/detail page. */
export function analyticsSnapshotCsv(snapshot: Awaited<ReturnType<typeof import('@/modules/analytics/server/read').readAnalyticsSnapshot>>, limit: number) {
  const header = ['record_type', 'metric_key', 'metric', 'source', 'resource', 'date', 'value', 'unit', 'coverage', 'available', 'aggregation', 'period_start', 'period_end', 'comparison_start', 'comparison_end', 'comparison_status', 'previous', 'delta', 'percent_change'];
  const rows: unknown[][] = [];
  const period = snapshot.period;
  const dates = [period.start, period.end, period.comparison?.start, period.comparison?.end];
  for (const entry of snapshot.audience.entries) rows.push(['audience', entry.metric, entry.metricLabel, entry.sourceLabel, entry.name, entry.asOf, entry.value, 'people', snapshot.audience.covered, snapshot.audience.selected, 'Latest value per channel at period end', ...dates]);
  for (const metric of snapshot.allMetrics) {
    const comparison = snapshot.comparisons[metric.key];
    rows.push(['summary', metric.key, metric.label, metric.sourceLabel, '', metric.latestAt, metric.displayTotal ?? metric.total, metric.unit, metric.coverage, metric.available, [metric.aggregationLabel, metric.aggregationNote].filter(Boolean).join('. '), ...dates, comparison?.status, comparison?.previous, comparison?.delta, comparison?.percent]);
    for (const point of metric.points) rows.push(['point', metric.key, metric.label, metric.sourceLabel, '', point.date, point.value, metric.unit, metric.coverage, metric.available, [metric.aggregationLabel, metric.aggregationNote].filter(Boolean).join('. '), ...dates]);
    for (const row of metric.rows) rows.push(['resource_or_category', metric.key, metric.label, metric.sourceLabel, row.label, row.asOf, row.value, metric.unit, metric.coverage, metric.available, [metric.aggregationLabel, metric.aggregationNote].filter(Boolean).join('. '), ...dates]);
  }
  const cap = Math.max(0, Math.floor(limit));
  const selected = rows.slice(0, cap);
  const truncated = rows.length > cap;
  return { csv: [header, ...selected, ...(truncated ? [['truncated', 'true']] : [])].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', rowCount: selected.length, truncated };
}
