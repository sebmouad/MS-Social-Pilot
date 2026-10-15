import type { ReactNode } from "react";
import type { PostSummary } from "@/server/data";
import { ChannelChip } from "@/components/ChannelChip";
import styles from "./publishing.module.css";

export function PageHeading({ title, description, eyebrow = "Publishing", summary, action }: { title: string; description: string; eyebrow?: string; summary?: string; action?: ReactNode }) {
  return <header className={styles.heading}><div><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{summary || action ? <div className={styles.headingSide}>{summary ? <span className={styles.summary}>{summary}</span> : null}{action}</div> : null}</header>;
}

/** The one primary way to start a post, shown on Posts, Calendar and Queue. */
export function NewPostLink({ label = "New post" }: { label?: string }) {
  return <a className="ui-button ui-button--primary" href="/publishing/compose"><span aria-hidden="true">+</span><span>{label}</span></a>;
}

export function PublishingPagination({ path, page, pages, query = "" }: { path: string; page: number; pages: number; query?: string }) {
  if (pages <= 1) return null;
  const link = (target: number) => { const params = new URLSearchParams(query); params.set("page", String(target)); return `${path}?${params}`; };
  return <nav className={styles.postPagination} aria-label="Post pages">
    {page > 1 ? <a className="ui-button ui-button--secondary" href={link(page - 1)}>Previous page</a> : <span />}
    <span>Page {page} of {pages}</span>
    {page < pages ? <a className="ui-button ui-button--secondary" href={link(page + 1)}>Next page</a> : <span />}
  </nav>;
}

export function PostMessage({ message }: { message: string }) {
  const text = message.trim();
  return <span className={styles.message}>{text || "No text included"}</span>;
}

export function PostTargets({ post }: { post: PostSummary }) {
  const names = [...new Set(post.targets.map(({ target }) => target.name))];
  return <span className={styles.targets}>{names.length ? names.join(", ") : "No destinations"}</span>;
}

type Tone = "neutral" | "success" | "warning" | "danger";
const STATUS: Record<string, { label: string; tone: Tone; shape: "circle" | "half" | "clock" | "check" | "cross" | "warn" | "ban" | "sync" }> = {
  draft: { label: "Draft", tone: "neutral", shape: "circle" },
  pending_approval: { label: "Needs approval", tone: "warning", shape: "half" },
  rejected: { label: "Rejected", tone: "danger", shape: "ban" },
  scheduled: { label: "Scheduled", tone: "warning", shape: "clock" },
  publishing: { label: "Publishing", tone: "neutral", shape: "sync" },
  published: { label: "Published", tone: "success", shape: "check" },
  partially_failed: { label: "Partly failed", tone: "danger", shape: "warn" },
  failed: { label: "Failed", tone: "danger", shape: "cross" },
  cancelled: { label: "Cancelled", tone: "neutral", shape: "ban" },
};

function Shape({ shape }: { shape: (typeof STATUS)[string]["shape"] }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    {shape === "circle" && <circle cx="8" cy="8" r="5.5" {...common} />}
    {shape === "half" && <><circle cx="8" cy="8" r="5.5" {...common} /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" /></>}
    {shape === "clock" && <><circle cx="8" cy="8" r="5.5" {...common} /><path d="M8 5v3.2l2 1.3" {...common} /></>}
    {shape === "check" && <path d="m3.5 8.5 3 3 6-7" {...common} />}
    {shape === "cross" && <path d="m4 4 8 8m0-8-8 8" {...common} />}
    {shape === "warn" && <><path d="M8 2.5 14 13H2z" {...common} /><path d="M8 6.5v3" {...common} /></>}
    {shape === "ban" && <><circle cx="8" cy="8" r="5.5" {...common} /><path d="m4.2 11.8 7.6-7.6" {...common} /></>}
    {shape === "sync" && <path d="M3 8a5 5 0 0 1 8.7-3.3L13 6M13 8a5 5 0 0 1-8.7 3.3L3 10M13 3v3h-3M3 13v-3h3" {...common} />}
  </svg>;
}

/** Status as text plus a distinct shape; colour only reinforces it. */
export function StatusChip({ status }: { status: string }) {
  const known = STATUS[status] ?? { label: status.replaceAll("_", " "), tone: "neutral" as Tone, shape: "circle" as const };
  return <span className="ui-status" data-tone={known.tone} data-status={status}><Shape shape={known.shape} /><span>{known.label}</span></span>;
}

/** Kept for screens that still show the old name. */
export function StatusBadge({ status }: { status: string }) { return <StatusChip status={status} />; }

export function PlatformChannels({ post, labels }: { post: PostSummary; labels: Record<string, { name: string; mark: { text: string; color: string } }> }) {
  if (!post.targets.length) return <span className={styles.targets}>No channels chosen</span>;
  const seen = new Set<string>();
  return <ul className={styles.channelList} aria-label="Channels">
    {post.targets.filter(({ target }) => !seen.has(target.id) && seen.add(target.id)).map(({ target }) => {
      const label = target.socialAccount?.provider ? labels[target.socialAccount.provider] : undefined;
      return <li key={target.id}><ChannelChip name={target.name} platform={label?.name} mark={label?.mark} /></li>;
    })}
  </ul>;
}

export function formatDate(date: Date | null, timeZone: string, withTime = true) {
  if (!date) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, { timeZone, year: "numeric", month: "short", day: "numeric", ...(withTime ? { hour: "numeric" as const, minute: "2-digit" as const, timeZoneName: "short" as const } : {}) }).format(date);
}
