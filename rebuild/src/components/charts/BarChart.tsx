"use client";
import { ChartShell, type ChartBaseProps, type ChartModel } from "./ChartShell";
import { numberFormatter, type NumberFormat } from "./format";
import { getMessages } from "./messages";
import { axisStyle, BAR_RADIUS, baseOption, legendStyle, tooltipStyle } from "./option-base";
import { colorAt } from "./theme";

export type BarSeries = { id: string; name: string; values: Array<number | null>; color?: number };

export type BarChartProps = ChartBaseProps & {
  categories: string[];
  series: BarSeries[];
  orientation?: "vertical" | "horizontal";
  stacked?: boolean;
  format?: NumberFormat;
  /** Header of the first table column. */
  categoryLabel?: string;
};

export function buildBarModel(props: BarChartProps): ChartModel {
  const { categories, series, orientation = "vertical", stacked = false, format } = props;
  const locale = props.locale ?? "en";
  const messages = getMessages(locale);
  const fmt = numberFormatter(locale, format);
  const axisFmt = numberFormatter(locale, { ...format, compact: true });
  const horizontal = orientation === "horizontal";

  return {
    table: {
      columns: [props.categoryLabel ?? messages.category, ...series.map(item => item.name)],
      rows: categories.map((category, position) => [category, ...series.map(item => fmt(item.values[position]))]),
    },
    empty: categories.length === 0 || series.every(item => item.values.every(value => value === null || value === undefined)),
    focusCount: categories.length,
    signature: JSON.stringify([locale, format, orientation]),
    option: env => {
      const category = { type: "category", data: categories, inverse: horizontal, ...axisStyle(env, "category") };
      const value = { type: "value", ...axisStyle(env, "value"), axisLabel: { ...axisStyle(env, "value").axisLabel, formatter: (v: number) => axisFmt(v) } };
      return {
        ...baseOption(env),
        grid: { left: 8, right: 16, top: series.length > 1 ? 40 : 16, bottom: 8, containLabel: true },
        legend: series.length > 1 ? legendStyle(env) : { show: false },
        tooltip: { ...tooltipStyle(env), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => fmt(typeof v === "number" ? v : null) },
        xAxis: horizontal ? value : category,
        yAxis: horizontal ? category : value,
        series: series.map((item, position) => ({
          type: "bar", id: item.id, name: item.name, data: item.values, stack: stacked ? "total" : undefined, barMaxWidth: 26,
          itemStyle: { color: colorAt(env.theme, item.color ?? position), borderRadius: stacked ? 0 : horizontal ? [0, BAR_RADIUS, BAR_RADIUS, 0] : [BAR_RADIUS, BAR_RADIUS, 0, 0] }, emphasis: { focus: "series" },
        })),
      };
    },
  };
}

export function BarChart(props: BarChartProps) {
  return <ChartShell {...props} model={buildBarModel(props)} />;
}
