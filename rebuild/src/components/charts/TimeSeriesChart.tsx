"use client";
import { ChartShell, type ChartBaseProps, type ChartModel } from "./ChartShell";
import { dateFormatters, numberFormatter, toTime, type ChartTime, type Granularity, type NumberFormat } from "./format";
import { getMessages } from "./messages";
import { axisStyle, baseOption, legendStyle, tooltipStyle } from "./option-base";
import { fillTimes, SERIES_DASHES, SERIES_SYMBOLS } from "./series-fit";
import { colorAt, css } from "./theme";

export type TimeSeriesPoint = { t: ChartTime; v: number | null };
export type TimeSeries = {
  id: string;
  name: string;
  points: TimeSeriesPoint[];
  /** Previous period, drawn dashed. Point `i` is plotted at the date of primary point `i`. */
  comparison?: TimeSeriesPoint[];
  /** Palette slot (0-based). Defaults to the series position. */
  color?: number;
  /** Fill under this series. */
  area?: boolean;
};

export type TimeSeriesChartProps = ChartBaseProps & {
  series: TimeSeries[];
  stacked?: boolean;
  format?: NumberFormat;
  granularity?: Granularity;
  /** IANA zone for date text. Defaults to UTC so server and client agree. */
  timeZone?: string;
  /** Let the value axis start near the data instead of zero (for stock-like series). */
  scale?: boolean;
  comparisonLabel?: string;
};

export function buildTimeSeriesModel(props: TimeSeriesChartProps): ChartModel {
  const { series, stacked = false, format, granularity = "day", timeZone, scale = false } = props;
  const locale = props.locale ?? "en";
  const messages = getMessages(locale);
  const comparisonLabel = props.comparisonLabel ?? messages.previousPeriod;
  const fmt = numberFormatter(locale, format);
  const axisFmt = numberFormatter(locale, { ...format, compact: true });
  const dates = dateFormatters(locale, granularity, timeZone);

  // Every step of the granularity between the first and last point, so a gap in the data is drawn as a gap and
  // never compressed. Ticks and labels stay in the display time zone.
  const known = [...new Set(series.flatMap(item => item.points.map(point => toTime(point.t))).filter(Number.isFinite))].sort((a, b) => a - b);
  const times = fillTimes(known, granularity);
  const index = new Map(times.map((time, position) => [time, position]));
  const align = (points: TimeSeriesPoint[]) => {
    const data: Array<number | null> = times.map(() => null);
    for (const point of points) {
      const position = index.get(toTime(point.t));
      if (position !== undefined) data[position] = point.v;
    }
    return data;
  };
  // The comparison is aligned by date offset (t − period length), not by array position: a previous day without a
  // value stays a gap. Dates that already fall in the primary range are used as they are.
  const alignComparison = (points: TimeSeriesPoint[]) => {
    const stamps = points.map(point => toTime(point.t));
    const shift = stamps.some(stamp => index.has(stamp)) || !stamps.length || !times.length ? 0 : times[0]! - Math.min(...stamps);
    const data: Array<number | null> = times.map(() => null);
    points.forEach((point, position) => {
      const slot = index.get(stamps[position]! + shift);
      if (slot !== undefined) data[slot] = point.v;
    });
    return data;
  };
  // More than two series: marker shape and line pattern differ per series, so color is never the only cue.
  const distinct = series.length > 2;

  const columns = [messages.date, ...series.map(item => item.name), ...series.filter(item => item.comparison).map(item => `${item.name} · ${comparisonLabel}`)];
  const aligned = series.map(item => align(item.points));
  const alignedComparison = series.filter(item => item.comparison).map(item => alignComparison(item.comparison!));
  const rows = times.map((time, position) => [dates.full(time), ...aligned.map(data => fmt(data[position])), ...alignedComparison.map(data => fmt(data[position]))]);
  const hasComparison = alignedComparison.length > 0;

  return {
    table: { columns, rows },
    empty: times.length === 0 || aligned.every(data => data.every(value => value === null)),
    focusCount: times.length,
    signature: JSON.stringify([locale, format, granularity, timeZone, comparisonLabel]),
    option: env => {
      const { theme } = env;
      const lines = series.flatMap((item, position) => {
        const color = colorAt(theme, item.color ?? position);
        const filled = stacked || (item.area ?? series.length === 1);
        const primary = {
          type: "line", id: item.id, name: item.name, data: aligned[position],
          showSymbol: distinct || times.length <= 12, symbol: distinct ? SERIES_SYMBOLS[position % SERIES_SYMBOLS.length] : "circle", symbolSize: 7, connectNulls: false, smooth: false,
          lineStyle: { width: 2.5, color, cap: "round", type: distinct ? SERIES_DASHES[position % SERIES_DASHES.length] : "solid" }, itemStyle: { color, borderColor: css(theme.surface), borderWidth: 2 },
          stack: stacked ? "total" : undefined,
          areaStyle: filled ? { color, opacity: 0.16 } : undefined,
          emphasis: { focus: "series" },
        };
        if (!item.comparison) return [primary];
        return [primary, {
          type: "line", id: `${item.id}:comparison`, name: `${item.name} · ${comparisonLabel}`, data: alignComparison(item.comparison),
          showSymbol: false, connectNulls: false, smooth: false,
          lineStyle: { width: 1.5, type: "dashed", opacity: 0.7, color }, itemStyle: { color, opacity: 0.7 },
          emphasis: { focus: "series" },
        }];
      });
      return {
        ...baseOption(env),
        grid: { left: 8, right: 16, top: series.length > 1 || hasComparison ? 40 : 16, bottom: 8, containLabel: true },
        legend: series.length > 1 || hasComparison ? legendStyle(env) : { show: false },
        tooltip: { ...tooltipStyle(env), trigger: "axis", valueFormatter: (value: unknown) => fmt(typeof value === "number" ? value : null) },
        xAxis: { type: "category", boundaryGap: false, data: times.map(dates.full), ...axisStyle(env, "category"), axisLabel: { ...axisStyle(env, "category").axisLabel, hideOverlap: true, formatter: (_: string, position: number) => dates.axis(times[position]!) } },
        yAxis: { type: "value", scale, ...axisStyle(env, "value"), axisLabel: { ...axisStyle(env, "value").axisLabel, formatter: (value: number) => axisFmt(value) } },
        series: lines,
      };
    },
  };
}

export function TimeSeriesChart(props: TimeSeriesChartProps) {
  return <ChartShell {...props} model={buildTimeSeriesModel(props)} />;
}
