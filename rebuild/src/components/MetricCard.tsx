import { IconArrowDownRight, IconArrowUpRight, IconMinus } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Sparkline } from "./charts/Sparkline";

export type MetricDelta = {
  /** Formatted change, for example "+12.4%". Always show text; color only reinforces it. */
  label: string;
  direction: "up" | "down" | "flat";
  /** Which direction is good news. Default "up"; use "down" for cost or response time. */
  good?: "up" | "down";
  /** What the change is compared with, for example "vs previous 28 days". */
  comparedTo?: string;
};

type MetricCardProps = {
  label: string;
  value: ReactNode;
  /** Module id for the icon chip color. */
  module?: string;
  icon?: ReactNode;
  delta?: MetricDelta;
  /** Coverage / period / source line. Keep ambiguous totals honest. */
  hint?: ReactNode;
  /** Optional link or action shown at the bottom of the card, e.g. the way to the owning screen. */
  footer?: ReactNode;
  /** ⓘ (an InfoTip) that carries the caveats so the number leads. */
  info?: ReactNode;
  /** Trend values; null marks unknown (not zero). */
  sparkline?: Array<number | null>;
  sparklineLabel?: string;
  /** Unavailable data shows a dash with this explanation. */
  unavailable?: string;
  loading?: boolean;
  loadingLabel?: string;
};

function tone(delta: MetricDelta) {
  if (delta.direction === "flat") return "flat";
  return delta.direction === (delta.good ?? "up") ? "good" : "bad";
}

/** KPI tile: module-colored icon chip, label, value, colored delta and optional sparkline. */
export function MetricCard({ label, value, module, icon, delta, hint, info, sparkline, sparklineLabel, unavailable, footer, loading = false, loadingLabel = "Loading…" }: MetricCardProps) {
  const DeltaIcon = delta?.direction === "up" ? IconArrowUpRight : delta?.direction === "down" ? IconArrowDownRight : IconMinus;
  return <article className="ui-metric" data-module={module} aria-busy={loading || undefined}>
    <div className="ui-metric__top">
      <span className="ui-metric__heading"><h3 className="ui-metric__label">{label}</h3>{info}</span>
      {icon && <span className="ui-mod-chip ui-metric__chip" aria-hidden="true">{icon}</span>}
    </div>
    {loading
      ? <><span className="ui-skeleton ui-metric__skeleton" aria-hidden="true" /><span className="ui-visually-hidden" role="status">{loadingLabel}</span></>
      : unavailable
        ? <p className="ui-metric__value is-unavailable" title={unavailable}><span aria-hidden="true">—</span><span className="ui-visually-hidden">{unavailable}</span></p>
        : <p className="ui-metric__value">{value}</p>}
    {!loading && delta && <p className={`ui-metric__delta is-${tone(delta)}`}>
      <DeltaIcon size={15} stroke={2} aria-hidden="true" />
      <strong>{delta.label}</strong>
      {delta.comparedTo && <span>{delta.comparedTo}</span>}
    </p>}
    {!loading && hint && <p className="ui-metric__hint">{hint}</p>}
    {!loading && sparkline && sparkline.length > 1 && <div className="ui-metric__spark"><Sparkline values={sparkline} label={sparklineLabel ?? label} height={44} table={false} area /></div>}
    {footer && <div className="ui-metric__footer">{footer}</div>}
  </article>;
}
