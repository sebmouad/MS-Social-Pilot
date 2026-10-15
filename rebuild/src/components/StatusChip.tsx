import type { ReactNode } from "react";

type Tone = "ok" | "warn" | "danger" | "neutral";
const shape = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/**
 * Post lifecycle statuses. Meaning is carried by the label and a distinct shape,
 * never by colour alone; the tone only reinforces it.
 */
const STATUSES: Record<string, { label: string; tone: Tone; icon: ReactNode }> = {
  draft: { label: "Draft", tone: "neutral", icon: <circle cx="8" cy="8" r="5.5" strokeDasharray="2.6 2.4" {...shape} /> },
  pending_approval: { label: "Pending approval", tone: "warn", icon: <><circle cx="8" cy="8" r="5.5" {...shape} /><path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" /></> },
  rejected: { label: "Rejected", tone: "danger", icon: <><rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2" {...shape} /><path d="m5.8 5.8 4.4 4.4m0-4.4-4.4 4.4" {...shape} /></> },
  scheduled: { label: "Scheduled", tone: "warn", icon: <><circle cx="8" cy="8" r="5.5" {...shape} /><path d="M8 5v3.2l2.1 1.3" {...shape} /></> },
  publishing: { label: "Publishing", tone: "neutral", icon: <><circle cx="8" cy="8" r="5.5" {...shape} /><path d="M8 10.6V5.6m-2.2 2.1L8 5.5l2.2 2.2" {...shape} /></> },
  published: { label: "Published", tone: "ok", icon: <><circle cx="8" cy="8" r="5.5" {...shape} /><path d="m5.5 8.2 1.7 1.7 3.4-3.6" {...shape} /></> },
  partially_failed: { label: "Partly failed", tone: "danger", icon: <><path d="M8 2.4 14 13H2Z" {...shape} /><path d="M8 2.4 8 13H2Z" fill="currentColor" /></> },
  failed: { label: "Failed", tone: "danger", icon: <><path d="M8 2.4 14 13H2Z" {...shape} /><path d="M8 6.4v3m0 1.8v.1" {...shape} /></> },
  cancelled: { label: "Cancelled", tone: "neutral", icon: <><circle cx="8" cy="8" r="5.5" {...shape} /><path d="m4.1 11.9 7.8-7.8" {...shape} /></> },
};

export function statusLabel(status: string) {
  return STATUSES[status]?.label ?? status.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase());
}

export function StatusChip({ status, compact = false }: { status: string; compact?: boolean }) {
  const known = STATUSES[status];
  const label = statusLabel(status);
  return <span className={`ui-chip ui-chip--${known?.tone ?? "neutral"}${compact ? " ui-chip--compact" : ""}`} data-status={status}>
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">{known?.icon ?? <circle cx="8" cy="8" r="5.5" {...shape} />}</svg>
    <span>{label}</span>
  </span>;
}
