'use client';
import { recordsCopyDefaults, type RecordsCopy } from '../../records-copy';
import { useMemo, useState } from 'react';
import { IconChartBar, IconExternalLink } from '@tabler/icons-react';
import { Avatar } from '@/components/Avatar';
import { DataTable } from '@/components/DataTable';
import { Select } from '@/components/Select';
import '../analytics.css';

export type PostsTableRow = {
  key: string; text: string; url: string | null; channelName: string;
  publishedAt: string | null; measuredAt: string | null;
  /** Stored measure values by key; null is unknown, never zero. */
  measures: Record<string, number | null>;
};
export type PostsTableMeasure = { key: string; label: string };

const NONE = '__none__';

/**
 * Post explorer table: channel avatar beside each post, two metric columns the viewer picks from the
 * stored measures, and a bar under the first metric scaled to the largest known value on the page.
 * Per-post history is not stored, so no trend line is drawn.
 */
export function PostsTable({ rows, measures: allMeasures, locale, emptyAction, copy = recordsCopyDefaults }: {
  copy?: RecordsCopy; rows: PostsTableRow[]; measures: PostsTableMeasure[]; locale: 'en' | 'fr'; emptyAction?: React.ReactNode;
}) {
  const fr = locale === 'fr';
  const t = (key: keyof RecordsCopy) => copy[key][locale];
  const unavailable = t("Not available");
  // A measure with no stored value on this page is not offered: it would only add a column of dashes.
  const measures = useMemo(() => allMeasures.filter(measure => rows.some(row => typeof row.measures[measure.key] === 'number')), [allMeasures, rows]);
  const [picked, setPicked] = useState<{ first?: string; second?: string }>({});
  const offered = (key: string | undefined, fallback: string) => key !== undefined && (key === NONE || measures.some(measure => measure.key === key)) ? key : fallback;
  const first = offered(picked.first, measures[0]?.key ?? NONE);
  const second = offered(picked.second, measures[1]?.key ?? NONE);
  const setFirst = (key: string) => setPicked(current => ({ ...current, first: key }));
  const setSecond = (key: string) => setPicked(current => ({ ...current, second: key }));
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  // Viewer's own timezone; the server render may differ from the browser, so the <time> text may update on hydration.
  const date = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }), [locale]);
  const when = (value: string | null) => value ? <time dateTime={value} suppressHydrationWarning>{date.format(new Date(value))}</time> : unavailable;
  const options = measures.map(measure => ({ value: measure.key, label: measure.label }));
  const chosen = [first, second].filter((key, index, all) => key !== NONE && all.indexOf(key) === index).map(key => measures.find(measure => measure.key === key)).filter((measure): measure is PostsTableMeasure => Boolean(measure));
  const peak = (key: string) => Math.max(0, ...rows.map(row => row.measures[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));

  return <div className="analytics-posts">
    {measures.length > 0 && <div className="analytics-posts__controls">
      <label className="ui-field">{t("First metric")}
        <Select aria-label={t("First metric")} value={first} onChange={setFirst} options={options} searchable={options.length > 8} />
      </label>
      <label className="ui-field">{t("Second metric")}
        <Select aria-label={t("Second metric")} value={second} onChange={setSecond} options={[{ value: NONE, label: t("None") }, ...options]} searchable={options.length > 8} />
      </label>
    </div>}
    <DataTable caption={t("Published posts")} rows={rows} rowKey={row => row.key} density="compact"
      emptyIcon={<IconChartBar />} emptyMessage={t("No published posts for this selection and period.")} emptyAction={emptyAction}
      columns={[
        { key: 'post', label: t("Post"), hideCardLabel: true, render: row => <span className="analytics-posts__post">
          <Avatar name={row.channelName} size="sm" decorative />
          <span className="analytics-posts__text">
            {row.url ? <a href={row.url} rel="noreferrer" target="_blank">{row.text || unavailable}<IconExternalLink size={14} aria-hidden="true" /></a> : <span>{row.text || unavailable}</span>}
            <small>{row.channelName}</small>
          </span>
        </span> },
        { key: 'publishedAt', label: t("Published"), render: row => when(row.publishedAt) },
        ...chosen.map((measure, index) => ({ key: `m:${measure.key}`, label: measure.label, align: 'end' as const, render: (row: PostsTableRow) => {
          const value = row.measures[measure.key];
          if (value === null || value === undefined) return <span title={unavailable}>—</span>;
          const top = peak(measure.key);
          return <span className="analytics-posts__value">{number.format(value)}
            {index === 0 && top > 0 && <span className="analytics-posts__bar" aria-hidden="true"><span style={{ width: `${Math.max(2, Math.round((Math.max(0, value) / top) * 100))}%` }} /></span>}
          </span>;
        } })),
        { key: 'measuredAt', label: t("Measured"), render: row => when(row.measuredAt) },
      ]} />
  </div>;
}
