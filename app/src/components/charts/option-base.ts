import type { ChartOption } from "./ChartShell";
import { css, type ChartEnv } from "./theme";

/** Themed defaults shared by every chart. Colors are read from the active theme, never hardcoded. */
export function baseOption({ theme, reducedMotion }: ChartEnv): ChartOption {
  return {
    color: theme.palette.length ? theme.palette : undefined,
    backgroundColor: "transparent",
    animation: !reducedMotion,
    animationDuration: 500,
    animationEasing: "cubicOut",
    textStyle: { color: css(theme.text), fontSize: 12 },
    aria: { enabled: false },
  };
}

/** Floating card: theme surface, soft border and lift, readable ink, aligned numbers. */
export function tooltipStyle({ theme }: ChartEnv) {
  return {
    backgroundColor: css(theme.surface),
    borderColor: css(theme.line),
    borderWidth: 1,
    padding: [8, 12],
    extraCssText: `border-radius:12px;box-shadow:0 10px 30px -12px color-mix(in srgb, ${theme.ink || "currentColor"} 40%, transparent);font-variant-numeric:tabular-nums;`,
    textStyle: { color: css(theme.ink), fontSize: 12 },
    axisPointer: { lineStyle: { color: css(theme.line), type: "dashed" }, crossStyle: { color: css(theme.line) }, shadowStyle: { color: css(theme.grid), opacity: 0.5 } },
  };
}

/** Round swatches, compact spacing; scrolls instead of wrapping. */
export function legendStyle({ theme }: ChartEnv) {
  return {
    top: 0, type: "scroll", icon: "circle", itemWidth: 8, itemHeight: 8, itemGap: 16,
    textStyle: { color: css(theme.text), fontSize: 12 }, pageIconColor: css(theme.text), pageTextStyle: { color: css(theme.text) },
  };
}

/** Quiet dashed gridlines on the value axis; a solid baseline on the category axis; small labels. */
export function axisStyle({ theme }: ChartEnv, kind: "category" | "value") {
  return {
    axisLine: { show: kind === "category", lineStyle: { color: css(theme.line) } },
    axisTick: { show: false },
    axisLabel: { color: css(theme.text), fontSize: 11, margin: 10 },
    splitLine: { show: kind === "value", lineStyle: { color: css(theme.grid), type: "dashed" } },
  };
}

/** Shared mark shapes so bars and lines look related across screens. */
export const BAR_RADIUS = 6;
