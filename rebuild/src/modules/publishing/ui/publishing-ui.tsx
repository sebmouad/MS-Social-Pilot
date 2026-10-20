import type { PostSummary } from "@/server/data";
import type { ReactNode } from "react";
import styles from "./publishing.module.css";
import { ModuleHeader } from "./kit/kit";
import { postContentSummary } from '@/modules/publishing/content-summary';

/** Page header for every Publishing route: the shared PageHeader with the Publishing icon chip. */
export function PageHeading({ title, description, eyebrow = "Publishing", summary, href, actions }: { title: string; description: string; eyebrow?: string; summary?: string; href?: string; actions?: ReactNode }) {
  return <ModuleHeader module="publishing" href={href} eyebrow={eyebrow} title={title} description={description} summary={summary} actions={actions} />;
}

export function PublishingPagination({ path, page, pages, locale = 'en' }: { path: string; page: number; pages: number; locale?: 'en' | 'fr' }) {
  if (pages <= 1) return null;
  const fr = locale === 'fr';
  return <nav className={styles.postPagination} aria-label={fr ? "Pages de publications" : "Post pages"}>
    {page > 1 ? <a className="ui-button ui-button--secondary" href={`${path}?page=${page - 1}`}>{fr ? 'Page précédente' : 'Previous page'}</a> : <span />}
    <span>{fr ? `Page ${page} sur ${pages}` : `Page ${page} of ${pages}`}</span>
    {page < pages ? <a className="ui-button ui-button--secondary" href={`${path}?page=${page + 1}`}>{fr ? 'Page suivante' : 'Next page'}</a> : <span />}
  </nav>;
}

export function PostMessage({ message, media, link }: { message: string; media?: unknown; link?: string | null }) {
  return <span className={styles.message}>{postContentSummary(message, media, link)}</span>;
}

export function PostTargets({ post }: { post: PostSummary }) {
  const names = [...new Set(post.targets.map(({ target }) => target.name))];
  return <span className={styles.targets}>{names.length ? names.join(", ") : "No destinations"}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={styles.badge} data-status={status}>{status.replaceAll("_", " ")}</span>;
}

export function formatDate(date: Date | null, timeZone: string, withTime = true, locale?: 'en' | 'fr') {
  if (!date) return locale === 'fr' ? "Non programmée" : "Not scheduled";
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}) }).format(date);
}
