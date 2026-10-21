import { overviewCopyDefaults, overviewText, type OverviewCopy } from '../overview-copy';
import { MetricCard, type MetricDelta } from '@/components/MetricCard';
import { TimeSeriesChart, DonutChart, BarChart } from '@/components/charts';
import { IconChartLine } from '@tabler/icons-react';
import { previousSeries, type DatedValues } from './series';
import type { MetricView } from '@/modules/analytics/server/aggregate';
import type { AnalyticsComparisonValue } from '@/modules/analytics/server/types';

function formatValue(value: number, unit: string, locale: string = 'en') {
  const amount = new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 'currency' ? 2 : 1 }).format(value);
  return unit === 'percent' ? `${amount}%` : unit === 'multiple' ? `${amount}×` : amount;
}

function currencyValue(metric: MetricView, value: number, copy: OverviewCopy, locale: string) {
  const t = overviewText(copy);
  const currency = metric.displayTotal?.match(/\b[A-Z]{3}\b/)?.[0];
  return currency ? `${formatValue(value, metric.unit, locale)} ${currency}` : t("{value} in the current metric's currency", { value: formatValue(value, metric.unit, locale) });
}

export function AnalyticsMetricComparison({ metric, comparison, copy = overviewCopyDefaults.en, locale = 'en' }: { locale?: 'en' | 'fr'; copy?: OverviewCopy; metric: MetricView; comparison?: AnalyticsComparisonValue }) {
  const t = overviewText(copy);
  if (!comparison) return null;
  if (comparison.status === 'missing') return <p className="analytics-metric__comparison">{t("Previous period data is missing.")}</p>;
  if (comparison.status === 'coverage_changed') return <p className="analytics-metric__comparison">{t("This metric cannot be compared because resource coverage changed.")}</p>;
  if (comparison.status !== 'comparable' || comparison.previous === null || comparison.delta === null) {
    return <p className="analytics-metric__comparison">{t("This metric is not comparable with the selected previous period.")}</p>;
  }

  const ratio = metric.kind === 'ratio' && metric.unit === 'percent';
  const previous = metric.unit === 'currency' ? currencyValue(metric, comparison.previous, copy, locale) : formatValue(comparison.previous, metric.unit, locale);
  const delta = metric.unit === 'currency' ? currencyValue(metric, Math.abs(comparison.delta), copy, locale) : formatValue(Math.abs(comparison.delta), metric.unit, locale);
  const sign = comparison.delta < 0 ? '−' : comparison.delta > 0 ? '+' : '';
  const change = ratio ? t("{value} percentage points", { value: `${sign}${formatValue(Math.abs(comparison.delta), 'count', locale)}` }) : `${sign}${delta}`;
  const relative = !ratio && comparison.percent !== null ? t(" ({value} relative)", { value: `${comparison.percent > 0 ? '+' : ''}${formatValue(comparison.percent, 'percent', locale)}` }) : '';

  return <p className="analytics-metric__comparison">{t("Previous period: {previous}. Change: {change}{relative}.", { previous, change, relative })}</p>;
}

function SeriesPreview({ metric, chartPoints, previousPoints, locale, copy }: { copy: OverviewCopy; metric: MetricView; chartPoints: number; previousPoints?: DatedValues; locale: 'en' | 'fr' }) {
  const t = overviewText(copy);
  const points = metric.points.slice(-chartPoints);
  const comparison = previousSeries(points, previousPoints, metric.unit);
  if (metric.kind === 'breakdown' && metric.rows.length) return <DonutChart label={metric.label} slices={metric.rows.map(row => ({ name: row.label, value: row.value }))} />;
  if (!points.length && metric.rows.length) return <BarChart label={metric.label} orientation="horizontal" categories={metric.rows.map(row => row.label)} series={[{ id: metric.key, name: metric.label, values: metric.rows.map(row => row.value) }]} />;
  if (!points.length) return <p className="analytics-series-note">{t("No dated series is stored for this metric.")}</p>;
  return <div className="analytics-series-preview">
    <TimeSeriesChart locale={locale} label={metric.label} format={metric.unit === 'percent' ? { style: 'percent' } : undefined} series={[{ id: metric.key, name: metric.label,
      points: points.map(point => ({ t: point.date, v: Number.isFinite(point.value) ? (metric.unit === 'percent' ? point.value / 100 : point.value) : null })), ...(comparison ? { comparison } : {}) }]} />
    <p>{t("Latest {shown} of {total} stored dates shown. Open this metric in the sidebar's Metric detail selector for the full series and resource values.", { shown: points.length, total: metric.points.length })}</p>
  </div>;
}

/** Headline change for the KPI card: percent for amounts, points for ratios; absent when the metric is not comparable. */
export function metricDelta(metric: MetricView, comparison: AnalyticsComparisonValue | undefined, locale: 'en' | 'fr', copy: OverviewCopy = overviewCopyDefaults[locale]): MetricDelta | undefined {
  const t = overviewText(copy);
  if (!comparison || comparison.status !== 'comparable' || comparison.delta === null) return undefined;
  const ratio = metric.kind === 'ratio' && metric.unit === 'percent';
  const amount = ratio ? comparison.delta : comparison.percent;
  if (amount === null) return undefined;
  const direction = amount > 0 ? 'up' : amount < 0 ? 'down' : 'flat';
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(amount);
  return { label: ratio ? t("{value} pts", { value: number }) : `${number}%`, direction, comparedTo: t("vs previous period") };
}

export default function AnalyticsMetric({ metric, comparison, chartPoints, previousPoints, locale = 'en', copy = overviewCopyDefaults[locale] }: { copy?: OverviewCopy; metric: MetricView; comparison?: AnalyticsComparisonValue; chartPoints: number; previousPoints?: DatedValues; locale?: 'en' | 'fr' }) {
  const t = overviewText(copy);
  const value = metric.displayTotal ?? (metric.total === null ? t("No aggregate value") : formatValue(metric.total, metric.unit, locale));
  const detailLabel = metric.resourceKind === 'ad-account' ? t("ad accounts") : t("channels");

  return <article className="analytics-metric">
    <MetricCard module="analytics" icon={<IconChartLine />} label={metric.label} value={value}
      unavailable={metric.total === null ? t("No aggregate value") : undefined} delta={metricDelta(metric, comparison, locale, copy)}
      sparkline={metric.points.slice(-chartPoints).map(point => Number.isFinite(point.value) ? point.value : null)} />
    <div className="analytics-metric__heading"><div>
      <p>{t("{source} · {covered} of {available} {resources} covered", { source: metric.sourceLabel, covered: metric.coverage, available: metric.available, resources: detailLabel })}</p>
      <p>{metric.aggregationLabel}</p>
      {metric.aggregationNote && <p className="analytics-aggregation-note">{metric.aggregationNote}</p>}
      {metric.latestAt && <p>{t("Latest data {date}", { date: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(metric.latestAt) })}</p>}
      {metric.updatedAt && <p>{t("Last synced {date}", { date: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(metric.updatedAt) })}</p>}
    </div></div>
    <div className="analytics-chart"><SeriesPreview copy={copy} metric={metric} chartPoints={chartPoints} previousPoints={previousPoints} locale={locale} /></div>
    {metric.coverage < metric.available && <p className="analytics-coverage">{t("Values are available for {covered} of {available} selected {resources}. Missing values are unknown, not zero.", { covered: metric.coverage, available: metric.available, resources: detailLabel })}</p>}
    <AnalyticsMetricComparison locale={locale} copy={copy} metric={metric} comparison={comparison} />
  </article>;
}
