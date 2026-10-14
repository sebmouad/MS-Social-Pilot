import type { PostSummary } from "@/server/data";
import styles from "./publishing.module.css";

export function PageHeading({ title, description, eyebrow = "Publishing", summary }: { title: string; description: string; eyebrow?: string; summary?: string }) {
  return <header className={styles.heading}><div><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>{summary ? <span className={styles.summary}>{summary}</span> : null}</header>;
}

export function PostMessage({ message }: { message: string }) {
  const text = message.trim();
  return <span className={styles.message}>{text || "No text included"}</span>;
}

export function PostTargets({ post }: { post: PostSummary }) {
  const names = [...new Set(post.targets.map(({ target }) => target.name))];
  return <span className={styles.targets}>{names.length ? names.join(", ") : "No destinations"}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={styles.badge} data-status={status}>{status.replaceAll("_", " ")}</span>;
}

export function formatDate(date: Date | null, timeZone: string, withTime = true) {
  if (!date) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}) }).format(date);
}
