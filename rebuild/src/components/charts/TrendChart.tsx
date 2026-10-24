"use client";
import { BarChart } from "./BarChart";
import { TimeSeriesChart, type TimeSeries } from "./TimeSeriesChart";
import type { ChartBaseProps } from "./ChartShell";
import type { NumberFormat } from "./format";

export type TrendChartProps = ChartBaseProps & {
  series: TimeSeries[];
  format?: NumberFormat;
  stacked?: boolean;
};

/** A one-day "trend" is a comparison, not a line: distinct day count decides bars vs lines. */
export function trendMode(series: readonly TimeSeries[]): 'bar' | 'line' {
  return new Set(series.flatMap(item => item.points.map(point => String(point.t)))).size > 1 ? 'line' : 'bar';
}

/**
 * Daily trend that stays honest with sparse data: multiple days draw lines, a single stored day draws
 * grouped bars instead of a lone dot. Times must already be date keys (`YYYY-MM-DD`).
 */
export function TrendChart({ series, format, stacked, ...props }: TrendChartProps) {
  if (trendMode(series) === 'line') return <TimeSeriesChart {...props} format={format} stacked={stacked} series={series} />;
  const categories = [...new Set(series.flatMap(item => item.points.map(point => String(point.t))))].sort();
  return <BarChart {...props} format={format} categories={categories}
    series={series.map((item, position) => ({ id: item.id, name: item.name, color: item.color ?? position,
      values: categories.map(date => item.points.find(point => String(point.t) === date)?.v ?? null) }))} />;
}
