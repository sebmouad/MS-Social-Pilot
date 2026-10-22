'use client';
import { useState } from 'react';
import { InfoTip, type InfoBlock } from '@/components';
import { TimeSeriesChart } from '@/components/charts';
import { NotesTimeSeriesChart } from '@/modules/calendar-extras/ui/NotesTimeSeriesChart';
import type { ChartAnnotations } from '@/modules/calendar-extras/server/chart-notes';
import './insights.css';

export type ChartMetric = {
  key: string;
  label: string;
  unit: string;
  points: Array<{ date: string; value: number | null }>;
  /** Previous period already aligned to the current dates by the read service; a missing day stays a gap. */
  previous?: Array<{ date: string; value: number | null }>;
  info: InfoBlock[];
  partial: boolean;
  exploreHref?: string;
};

const scaled = (value: number | null, unit: string) => value !== null && Number.isFinite(value) ? (unit === 'percent' ? value / 100 : value) : null;

/**
 * Main chart of the Overview: tabs inside the card pick the metric, the line is drawn over time and the previous
 * period is dashed. "Show data" (every chart has it) reveals the table. On phones the chart scrolls sideways inside
 * the card rather than shrinking.
 */
export function MainChartCard({ title, metrics, locale, labels, annotations }: {
  title: string;
  metrics: ChartMetric[];
  locale: 'en' | 'fr';
  /** Chart notes from the calendar extras, drawn as marks on the line when present. */
  annotations?: ChartAnnotations | null;
  labels: { switcher: string; chartLabel: string; empty: string; scrollHint: string; previous: string; openExplore: string; info: string };
}) {
  const [active, setActive] = useState(metrics[0]?.key ?? '');
  const metric = metrics.find(item => item.key === active) ?? metrics[0];
  if (!metric) return null;
  const series = [{
    id: metric.key, name: metric.label,
    points: metric.points.map(point => ({ t: point.date, v: scaled(point.value, metric.unit) })),
    ...(metric.previous?.length ? { comparison: metric.previous.map(point => ({ t: point.date, v: scaled(point.value, metric.unit) })) } : {}),
  }];
  return <section className="insights-card" aria-labelledby="insights-chart-title">
    <div className="insights-card__head">
      <h2 id="insights-chart-title" className="insights-card__title">{title}<InfoTip name={metric.label} blocks={[{ text: labels.info }, ...metric.info]} warning={metric.partial} /></h2>
      {metric.exploreHref && <a className="insights-card__link" href={metric.exploreHref}>{labels.openExplore}</a>}
    </div>
    {metrics.length > 1 && <ul className="insights-switch" aria-label={labels.switcher}>
      {metrics.map(item => <li key={item.key}><button type="button" aria-pressed={item.key === metric.key} onClick={() => setActive(item.key)}>{item.label}</button></li>)}
    </ul>}
    {metric.points.length
      ? <div className="insights-chartscroll" tabIndex={0} role="group" aria-label={labels.chartLabel.replace('{metric}', metric.label)}>
        {annotations
          ? <NotesTimeSeriesChart locale={locale} label={labels.chartLabel.replace('{metric}', metric.label)} comparisonLabel={labels.previous} format={metric.unit === 'percent' ? { style: 'percent' } : undefined} series={series} height={300} notes={annotations.notes} noteColors={annotations.noteColors} copy={annotations.copy} />
          : <TimeSeriesChart locale={locale} label={labels.chartLabel.replace('{metric}', metric.label)} comparisonLabel={labels.previous} format={metric.unit === 'percent' ? { style: 'percent' } : undefined} series={series} height={300} />}
      </div>
      : <p className="small-note">{labels.empty}</p>}
    <p className="insights-scrollhint">{labels.scrollHint}</p>
  </section>;
}
