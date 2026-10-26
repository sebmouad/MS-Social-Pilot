import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/Badge";

const shape = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

const ICONS = {
  needsReply: <><path d="M6.5 3.5 2.5 7l4 3.5" {...shape} /><path d="M2.8 7H9a4.2 4.2 0 0 1 4.2 4.2v1.3" {...shape} /></>,
  unread: <circle cx="8" cy="8" r="4.2" fill="currentColor" />,
  resolved: <><circle cx="8" cy="8" r="5.5" {...shape} /><path d="m5.5 8.2 1.7 1.7 3.4-3.6" {...shape} /></>,
  hidden: <><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4Z" {...shape} /><path d="m3 13 10-10" {...shape} /></>,
  message: <path d="M3 3.5h10v7H8.4L5.4 13v-2.5H3Z" {...shape} />,
  comment: <><path d="M3 3.5h10v7H8.4L5.4 13v-2.5H3Z" {...shape} /><path d="M5.6 6h4.8m-4.8 2h3" {...shape} /></>,
  review: <path d="M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.5l4-.6Z" {...shape} />,
  positive: <><circle cx="8" cy="8" r="5.5" {...shape} /><path d="M5.6 9.6a3.2 3.2 0 0 0 4.8 0M6 6.4h.01M10 6.4h.01" {...shape} /></>,
  neutral: <><circle cx="8" cy="8" r="5.5" {...shape} /><path d="M6 10h4M6 6.4h.01M10 6.4h.01" {...shape} /></>,
  negative: <><circle cx="8" cy="8" r="5.5" {...shape} /><path d="M5.6 10.4a3.2 3.2 0 0 1 4.8 0M6 6.4h.01M10 6.4h.01" {...shape} /></>,
} satisfies Record<string, ReactNode>;

type Tone = "ok" | "warn" | "danger" | "neutral" | "brand";
const BADGE_TONE: Record<Tone, BadgeTone> = { ok: "success", warn: "warning", danger: "danger", neutral: "neutral", brand: "brand" };

export type InboxKind = "message" | "comment" | "review";
/**
 * Kind badge tone: private messages carry the accent tint so they read apart
 * from public comments at a glance. The icon plus label still carry the
 * meaning; tone is never the only signal.
 */
const KIND_TONE: Record<InboxKind, Tone> = { message: "brand", comment: "neutral", review: "neutral" };
export const inboxKindTone = (kind: string): Tone => (KIND_TONE as Record<string, Tone>)[kind] ?? "neutral";

/** Status or kind label for an Inbox item: the shared Badge with an Inbox glyph. The icon never carries meaning alone. */
export function InboxTag({ icon, tone = "neutral", title, children }: { icon: keyof typeof ICONS; tone?: Tone; title?: string; children: ReactNode }) {
  return <span title={title}><Badge tone={BADGE_TONE[tone]} icon={<svg viewBox="0 0 16 16" width="13" height="13" focusable="false">{ICONS[icon]}</svg>}>{children}</Badge></span>;
}

/** The Inbox glyph alone, beside a visible label (the kind switch). */
export function InboxGlyph({ icon }: { icon: keyof typeof ICONS }) {
  return <svg viewBox="0 0 16 16" width="16" height="16" focusable="false" aria-hidden="true">{ICONS[icon]}</svg>;
}
