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
  const values = points.map(point => point.value).filter(Number.isFinite);
  if (!points.length) return <p className="analytics-series-note">No dated series is stored for this metric.</p>;
  const maximum = Math.max(1, ...values.map(value => Math.abs(value)));
  const zero = 48;
  const width = 100 / points.length;
  const bars = points.map((point, index) => {
    const value = Number.isFinite(point.value) ? point.value : 0;
    const height = value === 0 ? 1 : Math.max(1, Math.abs(value) / maximum * 42);
    return { x: index * width + width * .14, y: value >= 0 ? zero - height : zero, width: Math.max(.45, width * .72), height };
  });
  return <div className="analytics-series-preview">
    <svg viewBox="0 0 100 96" role="img" aria-label={`${metric.label} chart preview showing the latest ${points.length} of ${metric.points.length} stored dates. The full date and value series is available from the Metric detail selector in the sidebar.`}>
      <line x1="0" y1={zero} x2="100" y2={zero} className="analytics-series-preview__baseline" />
      {bars.map((bar, index) => <rect key={`${points[index]!.date}:${index}`} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx=".7" className="analytics-series-preview__bar" />)}
    </svg>
    <p>Latest {points.length} of {metric.points.length} stored dates shown. Open this metric in the sidebar's Metric detail selector for the full series and resource values.</p>
  </div>;
}

export default function AnalyticsMetric({ metric, comparison, chartPoints }: { metric: MetricView; comparison?: AnalyticsComparisonValue; chartPoints: number }) {
  const value = metric.displayTotal ?? (metric.total === null ? 'No aggregate value' : formatValue(metric.total, metric.unit));
  const detailLabel = metric.resourceKind === 'ad-account' ? 'ad accounts' : 'channels';

  return <article className="analytics-metric">
    <div className="analytics-metric__heading"><div><h3>{metric.label}</h3>
      <p>{metric.sourceLabel} · {metric.coverage} of {metric.available} {detailLabel} covered</p>
      <p>{metric.aggregationLabel}</p>
      {metric.aggregationNote && <p className="analytics-aggregation-note">{metric.aggregationNote}</p>}
      {metric.latestAt && <p>Latest data {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(metric.latestAt)}</p>}
      {metric.updatedAt && <p>Last synced {new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(metric.updatedAt)}</p>}
    </div><strong>{value}</strong></div>
    <SeriesPreview metric={metric} chartPoints={chartPoints} />
    {metric.coverage < metric.available && <p className="analytics-coverage">Values are available for {metric.coverage} of {metric.available} selected {detailLabel}. Missing values are unknown, not zero.</p>}
    <AnalyticsMetricComparison metric={metric} comparison={comparison} />
  </article>;
}
