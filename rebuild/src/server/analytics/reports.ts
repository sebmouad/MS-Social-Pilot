import { buildAnalytics } from './aggregate';
import type { loadAnalytics } from './data';

type AnalyticsData = Awaited<ReturnType<typeof loadAnalytics>>;

/** Builds one report view from the exact same scoped stored analytics snapshot as Analytics. */
export function buildReportOverview(data: AnalyticsData) {
  return buildAnalytics(data.pageRows, data.adRows, data.audienceRows, data.selectedTargets, data.adAccountCount, data.instagramRows, data.selectedInstagramAudience);
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
  for (const entry of view.audience.entries) rows.push(['audience', entry.metric, entry.metric.startsWith('instagram') ? 'instagram' : 'page', entry.name, entry.asOf, entry.value, 'people']);
  for (const metric of view.metrics) {
    for (const point of metric.points) rows.push(['metric', metric.label, metric.source, '', point.date, point.value, metric.unit]);
    for (const row of metric.rows) rows.push(['channel', metric.label, metric.source, row.label, row.asOf, row.value, metric.unit]);
  }
  const body = rows.slice(1, cap + 1).map(row => row.map(csvCell).join(','));
  const truncated = rows.length - 1 > cap;
  return { csv: [rows[0]!.map(csvCell).join(','), ...body, ...(truncated ? [csvCell('truncated') + ',' + csvCell('true')] : [])].join('\r\n') + '\r\n', rowCount: body.length, truncated };
}
