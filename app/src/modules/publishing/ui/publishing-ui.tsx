import { kitCopy } from './kit/copy';
import type { PostSummary } from "@/server/data";
import type { ReactNode } from "react";
import styles from "./publishing.module.css";
import { ModuleHeader } from "./kit/kit";
import { postContentSummary } from '@/modules/publishing/content-summary';

/** Page header for every Publishing route: the shared PageHeader with the Publishing icon chip. */
export function PageHeading({ title, description, eyebrow = "Publishing", summary, href, actions }: { title: string; description: string; eyebrow?: string; summary?: string; href?: string; actions?: ReactNode }) {
  return <ModuleHeader module="publishing" href={href} eyebrow={eyebrow} title={title} description={description} summary={summary} actions={actions} />;
}

export function PublishingPagination({ path, page, pages, locale = 'en', copy = kitCopy[locale] }: { path: string; page: number; pages: number; locale?: 'en' | 'fr'; copy?: typeof kitCopy.en }) {
  if (pages <= 1) return null;
  return <nav className={styles.postPagination} aria-label={copy.pagesLabel}>
    {page > 1 ? <a className="ui-button ui-button--secondary" href={`${path}?page=${page - 1}`}>{copy.previousPage}</a> : <span />}
    <span aria-current="page">{copy.pageOf(page,pages)}</span>
    {page < pages ? <a className="ui-button ui-button--secondary" href={`${path}?page=${page + 1}`}>{copy.nextPage}</a> : <span />}
  </nav>;
}

export function PostMessage({ message, media, link }: { message: string; media?: unknown; link?: string | null }) {
  return <span className={styles.message}>{postContentSummary(message, media, link)}</span>;
}

export function PostTargets({ post, copy = kitCopy.en }: { post: PostSummary; copy?: typeof kitCopy.en }) {
  const names = [...new Set(post.targets.map(({ target }) => target.name))];
  return <span className={styles.targets}>{names.length ? names.join(", ") : copy.noDestinations}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={styles.badge} data-status={status}>{status.replaceAll("_", " ")}</span>;
}

export function formatDate(date: Date | null, timeZone: string, withTime = true, locale?: 'en' | 'fr', copy = kitCopy[locale ?? 'en']) {
  if (!date) return copy.notScheduled;
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", ...(withTime ? { timeStyle: "short" as const } : {}) }).format(date);
}
