import { MetricCard } from '@/components/MetricCard';
import { TimeSeriesChart, DonutChart, BarChart } from '@/components/charts';
import { IconChartLine } from '@tabler/icons-react';
import type { MetricView } from '@/modules/analytics/server/aggregate';
import type { AnalyticsComparisonValue } from '@/modules/analytics/server/types';

function formatValue(value: number, unit: string) {
  const amount = new Intl.NumberFormat('en', { maximumFractionDigits: unit === 'currency' ? 2 : 1 }).format(value);
  return unit === 'percent' ? `${amount}%` : unit === 'multiple' ? `${amount}×` : amount;
}

function currencyValue(metric: MetricView, value: number) {
  const currency = metric.displayTotal?.match(/\b[A-Z]{3}\b/)?.[0];
  return currency ? `${formatValue(value, metric.unit)} ${currency}` : `${formatValue(value, metric.unit)} in the current metric's currency`;
}

export function AnalyticsMetricComparison({ metric, comparison }: { metric: MetricView; comparison?: AnalyticsComparisonValue }) {
  if (!comparison) return null;
  if (comparison.status === 'missing') return <p className="analytics-metric__comparison">Previous period data is missing.</p>;
  if (comparison.status === 'coverage_changed') return <p className="analytics-metric__comparison">This metric cannot be compared because resource coverage changed.</p>;
  if (comparison.status !== 'comparable' || comparison.previous === null || comparison.delta === null) {
    return <p className="analytics-metric__comparison">This metric is not comparable with the selected previous period.</p>;
  }

  const ratio = metric.kind === 'ratio' && metric.unit === 'percent';
  const previous = metric.unit === 'currency' ? currencyValue(metric, comparison.previous) : formatValue(comparison.previous, metric.unit);
  const delta = metric.unit === 'currency' ? currencyValue(metric, Math.abs(comparison.delta)) : formatValue(Math.abs(comparison.delta), metric.unit);
  const sign = comparison.delta < 0 ? '−' : comparison.delta > 0 ? '+' : '';
  const change = ratio ? `${sign}${formatValue(Math.abs(comparison.delta), 'count')} percentage points` : `${sign}${delta}`;
  const relative = !ratio && comparison.percent !== null ? ` (${comparison.percent > 0 ? '+' : ''}${formatValue(comparison.percent, 'percent')} relative)` : '';

  return <p className="analytics-metric__comparison">Previous period: {previous}. Change: {change}{relative}.</p>;
}

function SeriesPreview({ metric, chartPoints }: { metric: MetricView; chartPoints: number }) {
  const points = metric.points.slice(-chartPoints);
  if (metric.kind === 'breakdown' && metric.rows.length) return <DonutChart label={metric.label} slices={metric.rows.map(row => ({ name: row.label, value: row.value }))} />;
  if (!points.length && metric.rows.length) return <BarChart label={metric.label} orientation="horizontal" categories={metric.rows.map(row => row.label)} series={[{ id: metric.key, name: metric.label, values: metric.rows.map(row => row.value) }]} />;
  if (!points.length) return <p className="analytics-series-note">No dated series is stored for this metric.</p>;
  return <div className="analytics-series-preview">
    <TimeSeriesChart label={metric.label} format={metric.unit === 'percent' ? { style: 'percent' } : undefined} series={[{ id: metric.key, name: metric.label,
      points: points.map(point => ({ t: point.date, v: Number.isFinite(point.value) ? (metric.unit === 'percent' ? point.value / 100 : point.value) : null })) }]} />
    <p>Latest {points.length} of {metric.points.length} stored dates shown. Open this metric in the sidebar's Metric detail selector for the full series and resource values.</p>
  </div>;
}

export default function AnalyticsMetric({ metric, comparison, chartPoints }: { metric: MetricView; comparison?: AnalyticsComparisonValue; chartPoints: number }) {
  const value = metric.displayTotal ?? (metric.total === null ? 'No aggregate value' : formatValue(metric.total, metric.unit));
  const detailLabel = metric.resourceKind === 'ad-account' ? 'ad accounts' : 'channels';

  return <article className="analytics-metric">
    <MetricCard module="analytics" icon={<IconChartLine />} label={metric.label} value={value}
      unavailable={metric.total === null ? 'No aggregate value' : undefined}
      sparkline={metric.points.slice(-chartPoints).map(point => Number.isFinite(point.value) ? point.value : null)} />
    <div className="analytics-metric__heading"><div>
      <p>{metric.sourceLabel} · {metric.coverage} of {metric.available} {detailLabel} covered</p>
      <p>{metric.aggregationLabel}</p>
      {metric.aggregationNote && <p className="analytics-aggregation-note">{metric.aggregationNote}</p>}
      {metric.latestAt && <p>Latest data {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(metric.latestAt)}</p>}
      {metric.updatedAt && <p>Last synced {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(metric.updatedAt)}</p>}
    </div></div>
    <SeriesPreview metric={metric} chartPoints={chartPoints} />
    {metric.coverage < metric.available && <p className="analytics-coverage">Values are available for {metric.coverage} of {metric.available} selected {detailLabel}. Missing values are unknown, not zero.</p>}
    <AnalyticsMetricComparison metric={metric} comparison={comparison} />
  </article>;
}
