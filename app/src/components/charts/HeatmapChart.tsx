"use client";
import { ChartShell, type ChartBaseProps, type ChartModel } from "./ChartShell";
import { defaultWeekStart, escapeHtml, hourLabels, numberFormatter, weekdayNames, type NumberFormat } from "./format";
import { getMessages } from "./messages";
import { baseOption, tooltipStyle } from "./option-base";
import { css } from "./theme";

/** `day` 0 = Sunday … 6 = Saturday; `hour` 0–23. Absent cells are unknown. */
export type HeatmapCell = { day: number; hour: number; value: number | null };

export type HeatmapChartProps = ChartBaseProps & {
  cells: HeatmapCell[];
  format?: NumberFormat;
  /** Name of the measured value, shown in the tooltip. */
  valueLabel?: string;
  /** First row: 0 = Sunday … 6 = Saturday. Defaults to the locale's week start. */
  weekStart?: number;
};

export function buildHeatmapModel(props: HeatmapChartProps): ChartModel {
  const { cells, format } = props;
  const locale = props.locale ?? "en";
  const messages = getMessages(locale);
  const fmt = numberFormatter(locale, format);
  const start = props.weekStart ?? defaultWeekStart(locale);
  const days = weekdayNames(locale);
  const hours = hourLabels(locale);
  const order = Array.from({ length: 7 }, (_, row) => (start + row) % 7);
  const rowOf = new Map(order.map((day, row) => [day, row]));
  const valueLabel = props.valueLabel ?? messages.value;

  const known = cells.filter(cell => typeof cell.value === "number" && Number.isFinite(cell.value) && rowOf.has(cell.day) && cell.hour >= 0 && cell.hour <= 23);
  const grid = new Map(known.map(cell => [`${cell.day}:${cell.hour}`, cell.value as number]));
  const values = known.map(cell => cell.value as number);

  return {
    table: {
      columns: [messages.day, ...hours],
      rows: order.map(day => [days[day]!, ...hours.map((_, hour) => fmt(grid.get(`${day}:${hour}`) ?? null))]),
    },
    empty: known.length === 0,
    focusCount: known.length,
    signature: JSON.stringify([locale, format, start, valueLabel]),
    option: env => {
      const { theme } = env;
      const low = css(theme.surface);
      const high = css(theme.accent);
      return {
        ...baseOption(env),
        grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
        tooltip: {
          ...tooltipStyle(env), trigger: "item",
          formatter: (param: { value: [number, number, number] }) => `${escapeHtml(days[order[param.value[1]]!]!)} ${escapeHtml(hours[param.value[0]]!)}<br/>${escapeHtml(valueLabel)}: ${escapeHtml(fmt(param.value[2]))}`,
        },
        xAxis: { type: "category", data: hours, splitArea: { show: false }, axisTick: { show: false }, axisLine: { lineStyle: { color: css(theme.line) } }, axisLabel: { color: css(theme.text), hideOverlap: true } },
        yAxis: { type: "category", data: order.map(day => days[day]), inverse: true, axisTick: { show: false }, axisLine: { lineStyle: { color: css(theme.line) } }, axisLabel: { color: css(theme.text) } },
        visualMap: {
          type: "continuous", min: Math.min(...values), max: Math.max(...values), calculable: false, orient: "horizontal", left: "center", bottom: 0,
          inRange: low && high ? { color: [low, high] } : undefined, textStyle: { color: css(theme.text) },
          formatter: (value: number) => fmt(value),
        },
        series: [{
          type: "heatmap", label: { show: false },
          itemStyle: { borderColor: css(theme.surface), borderWidth: 2 },
          emphasis: { itemStyle: { borderColor: css(theme.ink) } },
          data: known.map(cell => [cell.hour, rowOf.get(cell.day)!, cell.value]),
        }],
      };
    },
  };
}

export function HeatmapChart(props: HeatmapChartProps) {
  return <ChartShell {...props} model={buildHeatmapModel(props)} />;
}
