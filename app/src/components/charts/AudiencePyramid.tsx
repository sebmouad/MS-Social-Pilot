"use client";
import { ChartShell, type ChartBaseProps, type ChartModel } from "./ChartShell";
import { numberFormatter, type NumberFormat } from "./format";
import { getMessages } from "./messages";
import { axisStyle, baseOption, legendStyle, tooltipStyle } from "./option-base";
import { colorAt } from "./theme";

export type PyramidSide = { name: string; values: Array<number | null> };

export type AudiencePyramidProps = ChartBaseProps & {
  /** Age groups, youngest first (drawn bottom to top). */
  groups: string[];
  /** Drawn to the left of the axis. */
  left: PyramidSide;
  /** Drawn to the right of the axis. */
  right: PyramidSide;
  format?: NumberFormat;
  groupLabel?: string;
};

export function buildPyramidModel(props: AudiencePyramidProps): ChartModel {
  const { groups, left, right, format } = props;
  const locale = props.locale ?? "en";
  const messages = getMessages(locale);
  const fmt = numberFormatter(locale, format);
  const axisFmt = numberFormatter(locale, { ...format, compact: true });
  const magnitudes = [...left.values, ...right.values].filter((value): value is number => typeof value === "number");
  const limit = magnitudes.length ? Math.max(...magnitudes.map(Math.abs)) : 0;
  const abs = (value: unknown) => fmt(typeof value === "number" ? Math.abs(value) : null);

  return {
    table: {
      columns: [props.groupLabel ?? messages.category, left.name, right.name],
      rows: groups.map((group, position) => [group, fmt(left.values[position]), fmt(right.values[position])]),
    },
    empty: groups.length === 0 || magnitudes.length === 0,
    focusCount: groups.length,
    signature: JSON.stringify([locale, format]),
    option: env => ({
      ...baseOption(env),
      grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
      legend: legendStyle(env),
      tooltip: { ...tooltipStyle(env), trigger: "axis", axisPointer: { type: "shadow" }, valueFormatter: abs },
      xAxis: { type: "value", min: -limit, max: limit, ...axisStyle(env, "value"), axisLabel: { ...axisStyle(env, "value").axisLabel, formatter: (value: number) => axisFmt(Math.abs(value)) } },
      yAxis: { type: "category", data: groups, ...axisStyle(env, "category"), axisLine: { show: false } },
      series: [
        { type: "bar", name: left.name, stack: "audience", barMaxWidth: 24, data: left.values.map(value => typeof value === "number" ? -Math.abs(value) : null), itemStyle: { color: colorAt(env.theme, 0) } },
        { type: "bar", name: right.name, stack: "audience", barMaxWidth: 24, data: right.values.map(value => typeof value === "number" ? Math.abs(value) : null), itemStyle: { color: colorAt(env.theme, 1) } },
      ],
    }),
  };
}

export function AudiencePyramid(props: AudiencePyramidProps) {
  return <ChartShell {...props} model={buildPyramidModel(props)} />;
}
