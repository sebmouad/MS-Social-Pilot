'use client';
import { recordsCopyDefaults, type RecordsCopy } from '../../records-copy';
import { useMemo, useState } from 'react';
import { IconChartBar, IconExternalLink } from '@tabler/icons-react';
import { Avatar } from '@/components/Avatar';
import { PostThumb } from '@/components/PostThumb';
import type { PostThumbnail } from '@/components/post-thumbnail';
import { DataTable } from '@/components/DataTable';
import '../analytics.css';

export type PostsTableRow = {
  key: string; text: string; url: string | null; channelName: string;
  /** Internal post page for destinations made in this workspace; absent when there is no mapping. */
  postHref?: string;
  /** Image, video poster or stored picture to show beside the post; null shows a quiet placeholder. */
  thumbnail?: PostThumbnail | null;
  publishedAt: string | null; measuredAt: string | null;
  /** Stored measure values by key; null is unknown, never zero. */
  measures: Record<string, number | null>;
  /** Server-formatted labels in the workspace zone (see `@/server/instant-labels`). */
  labels?: { publishedAt?: string; measuredAt?: string };
};
export type PostsTableMeasure = { key: string; label: string };

const DEFAULT_COLUMNS = 3; // Initial metric columns before the viewer chooses; a presentation default, not a data limit.
/** Default columns lead with how many people saw a post, then how they reacted; other measures follow in their stored order. */
const PREFERRED = ['post_media_view', 'reach', 'impressions', 'post_total_media_view_unique', 'reactions', 'comments', 'shares'];
const preference = (key: string) => { const index = PREFERRED.indexOf(key); return index === -1 ? PREFERRED.length : index; };

/**
 * Post explorer table: channel avatar beside each post, two metric columns the viewer picks from the
 * stored measures, and a bar under the first metric scaled to the largest known value on the page.
 * Per-post history is not stored, so no trend line is drawn.
 */
export function PostsTable({ rows, measures: allMeasures, locale, emptyAction, copy = recordsCopyDefaults, sortKey, sortDirection }: {
  copy?: RecordsCopy; rows: PostsTableRow[]; measures: PostsTableMeasure[]; locale: 'en' | 'fr'; emptyAction?: React.ReactNode;
  sortKey?: string; sortDirection?: 'asc' | 'desc';
}) {
  const t = (key: keyof RecordsCopy) => copy[key][locale];
  const unavailable = t("Not available");
  // A measure with no stored value on this page is not offered: it would only add a column of dashes.
  const measures = useMemo(() => allMeasures.filter(measure => rows.some(row => typeof row.measures[measure.key] === 'number')), [allMeasures, rows]);
  // null = the default columns (views first, then reactions); once the viewer chooses, their list wins.
  const [picked, setPicked] = useState<string[] | null>(null);
  const shownKeys = (picked ?? [...measures].sort((a, b) => preference(a.key) - preference(b.key)).slice(0, DEFAULT_COLUMNS).map(measure => measure.key)).filter(key => measures.some(measure => measure.key === key));
  const toggle = (key: string) => setPicked(() => { const current = new Set(shownKeys); if (current.has(key)) current.delete(key); else current.add(key); return measures.filter(measure => current.has(measure.key)).map(measure => measure.key); });
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const when = (value: string | null, label?: string) => value ? <time dateTime={value}>{label ?? ''}</time> : unavailable;
  const chosen = measures.filter(measure => shownKeys.includes(measure.key));
  const peak = (key: string) => Math.max(0, ...rows.map(row => row.measures[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
  const activeSortColumn = sortKey ? (sortKey === 'publishedAt' ? 'publishedAt' : `m:${sortKey}`) : undefined;
  const handleSort = (columnKey: string) => {
    const nextSort = columnKey.startsWith('m:') ? columnKey.slice(2) : columnKey;
    const nextDirection = sortKey === nextSort ? (sortDirection === 'asc' ? 'desc' : 'asc') : 'desc';
    const url = new URL(window.location.href);
    url.searchParams.set('sort', nextSort);
    url.searchParams.set('direction', nextDirection);
    url.searchParams.delete('page');
    window.location.assign(`${url.pathname}?${url.searchParams.toString()}`);
  };

  return <div className="analytics-posts">
    {measures.length > 0 && <details className="analytics-posts__columns">
      <summary>{t("Columns")} · {chosen.length}/{measures.length}</summary>
      <fieldset>
        <legend className="ui-visually-hidden">{t("Columns")}</legend>
        {measures.map(measure => <label key={measure.key} className="analytics-posts__column-option">
          <input type="checkbox" checked={shownKeys.includes(measure.key)} onChange={() => toggle(measure.key)} />
          <span>{measure.label}</span>
        </label>)}
      </fieldset>
    </details>}
    <DataTable caption={t("Published posts")} rows={rows} rowKey={row => row.key} density="compact"
      emptyIcon={<IconChartBar />} emptyMessage={t("No published posts for this selection and period.")} emptyAction={emptyAction}
      sort={activeSortColumn ? { key: activeSortColumn, direction: sortDirection === 'asc' ? 'ascending' : 'descending', onChange: handleSort } : undefined}
      columns={[
        { key: 'post', label: t("Post"), hideCardLabel: true, render: row => <span className="analytics-posts__post">
          <span data-module="analytics" className="analytics-posts__media"><PostThumb thumb={row.thumbnail ?? null} size="sm" /></span>
          <span className="analytics-posts__text">
            {row.url ? <a href={row.url} rel="noreferrer" target="_blank">{row.text || unavailable}<IconExternalLink size={14} aria-hidden="true" /></a> : <span>{row.text || unavailable}</span>}
            <small className="analytics-posts__channel"><Avatar name={row.channelName} size="sm" decorative />{row.channelName}</small>
            {row.postHref ? <small className="analytics-posts__internal"><a href={row.postHref}>{t("Open in Posts")}</a></small> : null}
          </span>
        </span> },
        { key: 'publishedAt', label: t("Published"), sortable: Boolean(activeSortColumn), render: row => when(row.publishedAt, row.labels?.publishedAt) },
        ...chosen.map((measure, index) => ({ key: `m:${measure.key}`, label: measure.label, align: 'end' as const, sortable: Boolean(activeSortColumn), render: (row: PostsTableRow) => {
          const value = row.measures[measure.key];
          if (value === null || value === undefined) return <span title={unavailable}>—</span>;
          const top = peak(measure.key);
          return <span className="analytics-posts__value">{number.format(value)}
            {index === 0 && top > 0 && <span className="analytics-posts__bar" aria-hidden="true"><span style={{ width: `${Math.max(2, Math.round((Math.max(0, value) / top) * 100))}%` }} /></span>}
          </span>;
        } })),
        { key: 'measuredAt', label: t("Measured"), render: row => when(row.measuredAt, row.labels?.measuredAt) },
      ]} />
  </div>;
}
