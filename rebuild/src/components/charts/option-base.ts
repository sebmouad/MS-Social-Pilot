import type { ChartOption } from "./ChartShell";
import { css, type ChartEnv } from "./theme";

/** Themed defaults shared by every chart. Colors are read from the active theme, never hardcoded. */
export function baseOption({ theme, reducedMotion }: ChartEnv): ChartOption {
  return {
    color: theme.palette.length ? theme.palette : undefined,
    backgroundColor: "transparent",
    animation: !reducedMotion,
    textStyle: { color: css(theme.text) },
    aria: { enabled: false },
  };
}

export function tooltipStyle({ theme }: ChartEnv) {
  return {
    backgroundColor: css(theme.surface),
    borderColor: css(theme.line),
    textStyle: { color: css(theme.ink) },
  };
}

export function legendStyle({ theme }: ChartEnv) {
  return { top: 0, type: "scroll", textStyle: { color: css(theme.text) }, pageIconColor: css(theme.text), pageTextStyle: { color: css(theme.text) } };
}

export function axisStyle({ theme }: ChartEnv, kind: "category" | "value") {
  return {
    axisLine: { show: kind === "category", lineStyle: { color: css(theme.line) } },
    axisTick: { show: false },
    axisLabel: { color: css(theme.text) },
    splitLine: { show: kind === "value", lineStyle: { color: css(theme.grid) } },
  };
}
