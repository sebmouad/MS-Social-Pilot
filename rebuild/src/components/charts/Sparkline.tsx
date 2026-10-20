"use client";
import { ChartShell, type ChartBaseProps, type ChartModel } from "./ChartShell";
import { numberFormatter, type NumberFormat } from "./format";
import { getMessages } from "./messages";
import { baseOption, tooltipStyle } from "./option-base";
import { colorAt } from "./theme";

export type SparklineProps = ChartBaseProps & {
  values: Array<number | null>;
  /** One label per value (for example formatted dates); used by the tooltip and table. */
  labels?: string[];
  format?: NumberFormat;
  area?: boolean;
  /** Palette slot (0-based). */
  color?: number;
};

export function buildSparklineModel(props: SparklineProps): ChartModel {
  const { values, format, area = false } = props;
  const locale = props.locale ?? "en";
  const messages = getMessages(locale);
  const fmt = numberFormatter(locale, format);
  const names = values.map((_, position) => props.labels?.[position] ?? String(position + 1));

  return {
    table: { columns: [messages.category, messages.value], rows: values.map((value, position) => [names[position]!, fmt(value)]) },
    empty: values.every(value => value === null || value === undefined),
    focusCount: values.length,
    signature: JSON.stringify([locale, format, area]),
    option: env => {
      const color = colorAt(env.theme, props.color ?? 0);
      return {
        ...baseOption(env),
        grid: { left: 2, right: 2, top: 4, bottom: 4 },
        tooltip: { ...tooltipStyle(env), trigger: "axis", confine: true, valueFormatter: (v: unknown) => fmt(typeof v === "number" ? v : null) },
        xAxis: { type: "category", show: false, boundaryGap: false, data: names },
        yAxis: { type: "value", show: false, scale: true },
        series: [{
          type: "line", data: values, symbol: "none", showSymbol: values.length <= 1, connectNulls: false, smooth: false,
          lineStyle: { width: 1.5, color }, itemStyle: { color }, areaStyle: area ? { color, opacity: 0.16 } : undefined,
        }],
      };
    },
  };
}

export function Sparkline({ height = 40, ...props }: SparklineProps) {
  return <ChartShell {...props} height={height} model={buildSparklineModel(props)} />;
}
