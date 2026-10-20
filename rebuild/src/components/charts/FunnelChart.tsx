"use client";
import { ChartShell, type ChartBaseProps, type ChartModel } from "./ChartShell";
import { numberFormatter, type NumberFormat } from "./format";
import { getMessages } from "./messages";
import { baseOption, tooltipStyle } from "./option-base";
import { colorAt, css } from "./theme";

export type FunnelStage = { id?: string; name: string; value: number | null };

export type FunnelChartProps = ChartBaseProps & {
  /** In funnel order, widest first (for example impressions → clicks → results). */
  stages: FunnelStage[];
  format?: NumberFormat;
};

export function buildFunnelModel(props: FunnelChartProps): ChartModel {
  const { stages, format } = props;
  const locale = props.locale ?? "en";
  const messages = getMessages(locale);
  const fmt = numberFormatter(locale, format);
  const percent = numberFormatter(locale, { style: "percent" });
  const drawn = stages.filter(stage => typeof stage.value === "number" && stage.value >= 0);
  const first = stages[0]?.value;
  // Conversion needs a known, non-zero denominator; otherwise it is unknown, not zero.
  const ratio = (value: number | null | undefined, base: number | null | undefined) =>
    typeof value === "number" && typeof base === "number" && base > 0 ? percent(value / base) : null;

  return {
    table: {
      columns: [messages.stage, messages.value, messages.ofPrevious, messages.ofFirst],
      rows: stages.map((stage, position) => [stage.name, fmt(stage.value), position === 0 ? null : ratio(stage.value, stages[position - 1]!.value), position === 0 ? null : ratio(stage.value, first)]),
    },
    empty: drawn.length === 0,
    focusCount: drawn.length,
    signature: JSON.stringify([locale, format]),
    option: env => ({
      ...baseOption(env),
      tooltip: { ...tooltipStyle(env), trigger: "item", valueFormatter: (v: unknown) => fmt(typeof v === "number" ? v : null) },
      series: [{
        type: "funnel", sort: "none", gap: 3, left: "8%", right: "8%", top: 8, bottom: 8, minSize: "12%",
        itemStyle: { borderColor: css(env.theme.surface), borderWidth: 1 },
        label: { show: true, position: "inside", color: css(env.theme.surface), formatter: (param: { name: string; value: number }) => `${param.name}: ${fmt(param.value)}` },
        data: drawn.map((stage, position) => ({ id: stage.id, name: stage.name, value: stage.value, itemStyle: { color: colorAt(env.theme, position) } })),
      }],
    }),
  };
}

export function FunnelChart(props: FunnelChartProps) {
  return <ChartShell {...props} model={buildFunnelModel(props)} />;
}
