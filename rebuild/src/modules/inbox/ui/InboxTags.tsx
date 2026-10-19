import type { ReactNode } from "react";

const shape = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const ICONS = {
  needsReply: <><path d="M6.5 3.5 2.5 7l4 3.5" {...shape} /><path d="M2.8 7H9a4.2 4.2 0 0 1 4.2 4.2v1.3" {...shape} /></>,
  unread: <circle cx="8" cy="8" r="4.2" fill="currentColor" />,
  resolved: <><circle cx="8" cy="8" r="5.5" {...shape} /><path d="m5.5 8.2 1.7 1.7 3.4-3.6" {...shape} /></>,
  hidden: <><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z" {...shape} /><path d="m3 13 10-10" {...shape} /></>,
  message: <path d="M3 3.5h10v7H8.4L5.4 13v-2.5H3Z" {...shape} />,
  comment: <><path d="M3 3.5h10v7H8.4L5.4 13v-2.5H3Z" {...shape} /><path d="M5.6 6h4.8m-4.8 2h3" {...shape} /></>,
} satisfies Record<string, ReactNode>;

type Tone = "ok" | "warn" | "danger" | "neutral";

export function InboxTag({ icon, tone = "neutral", children }: { icon: keyof typeof ICONS; tone?: Tone; children: ReactNode }) {
  return <span className={`ui-chip ui-chip--${tone} ui-chip--compact`}>
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">{ICONS[icon]}</svg>
    <span>{children}</span>
  </span>;
}
