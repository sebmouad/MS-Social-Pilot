"use client";
import { ChartShell, type ChartBaseProps, type ChartModel } from "./ChartShell";
import { numberFormatter, type NumberFormat } from "./format";
import { getMessages } from "./messages";
import { baseOption, legendStyle, tooltipStyle } from "./option-base";
import { groupOther } from "./series-fit";
import { colorAt, css } from "./theme";

export type DonutSlice = { id?: string; name: string; value: number | null; color?: number };

export type DonutChartProps = ChartBaseProps & {
  slices: DonutSlice[];
  format?: NumberFormat;
  /** Caption under the center total. Defaults to "Total". */
  totalLabel?: string;
  nameLabel?: string;
};

export function buildDonutModel(props: DonutChartProps): ChartModel {
  const { format } = props;
  const locale = props.locale ?? "en";
  const messages = getMessages(locale);
  // More slices than palette colors: the smallest are grouped as "Other" so no two slices share a color.
  const slices = groupOther(props.slices, (_rest, total) => ({ name: messages.other, value: total }));
  const fmt = numberFormatter(locale, format);
  const percent = numberFormatter(locale, { style: "percent" });
  // Unknown or non-positive slices are not drawn; they stay in the table as unknown.
  const drawn = slices.filter(slice => typeof slice.value === "number" && slice.value > 0);
  const total = drawn.reduce((sum, slice) => sum + slice.value!, 0);
  const totalLabel = props.totalLabel ?? messages.total;

  return {
    table: {
      columns: [props.nameLabel ?? messages.category, messages.value, messages.share],
      rows: slices.map(slice => [slice.name, fmt(slice.value), typeof slice.value === "number" && total > 0 ? percent(slice.value / total) : null]),
    },
    empty: drawn.length === 0,
    focusCount: drawn.length,
    signature: JSON.stringify([locale, format, totalLabel]),
    option: env => ({
      ...baseOption(env),
      legend: { ...legendStyle(env), top: undefined, bottom: 0, formatter: (name: string) => {
        const slice = drawn.find(item => item.name === name);
        return slice && total > 0 ? `${name}  ${percent(slice.value! / total)}` : name;
      } },
      tooltip: { ...tooltipStyle(env), trigger: "item", valueFormatter: (v: unknown) => fmt(typeof v === "number" ? v : null) },
      graphic: [{
        type: "text", left: "center", top: "middle", silent: true,
        style: { text: `${fmt(total)}\n${totalLabel}`, textAlign: "center", fill: css(env.theme.ink), fontSize: 14, fontWeight: 600, lineHeight: 20 },
      }],
      series: [{
        type: "pie", radius: ["55%", "75%"], center: ["50%", "50%"], avoidLabelOverlap: true,
        label: { show: false }, labelLine: { show: false }, itemStyle: { borderColor: css(env.theme.surface), borderWidth: 2 },
        data: drawn.map((slice, position) => ({ id: slice.id, name: slice.name, value: slice.value, itemStyle: { color: colorAt(env.theme, slice.color ?? position) } })),
      }],
    }),
  };
}

export function DonutChart(props: DonutChartProps) {
  return <ChartShell {...props} model={buildDonutModel(props)} />;
}
