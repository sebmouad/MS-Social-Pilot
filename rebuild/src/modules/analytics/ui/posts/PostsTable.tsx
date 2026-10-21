'use client';
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
export function PostsTable({ rows, measures, locale, emptyAction }: {
  rows: PostsTableRow[]; measures: PostsTableMeasure[]; locale: 'en' | 'fr'; emptyAction?: React.ReactNode;
}) {
  const fr = locale === 'fr';
  const t = (en: string, french: string) => fr ? french : en;
  const unavailable = t('Not available', 'Non disponible');
  const [first, setFirst] = useState(measures[0]?.key ?? NONE);
  const [second, setSecond] = useState(measures[1]?.key ?? NONE);
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const date = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }), [locale]);
  const when = (value: string | null) => value ? `${date.format(new Date(value))} UTC` : unavailable;
  const options = measures.map(measure => ({ value: measure.key, label: measure.label }));
  const chosen = [first, second].filter((key, index, all) => key !== NONE && all.indexOf(key) === index).map(key => measures.find(measure => measure.key === key)).filter((measure): measure is PostsTableMeasure => Boolean(measure));
  const peak = (key: string) => Math.max(0, ...rows.map(row => row.measures[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));

  return <div className="analytics-posts">
    {measures.length > 0 && <div className="analytics-posts__controls">
      <label className="ui-field">{t('First metric', 'Première mesure')}
        <Select aria-label={t('First metric', 'Première mesure')} value={first} onChange={setFirst} options={options} searchable={options.length > 8} />
      </label>
      <label className="ui-field">{t('Second metric', 'Deuxième mesure')}
        <Select aria-label={t('Second metric', 'Deuxième mesure')} value={second} onChange={setSecond} options={[{ value: NONE, label: t('None', 'Aucune') }, ...options]} searchable={options.length > 8} />
      </label>
    </div>}
    <DataTable caption={t('Published posts', 'Publications publiées')} rows={rows} rowKey={row => row.key} density="compact"
      emptyIcon={<IconChartBar />} emptyMessage={t('No published posts for this selection and period.', 'Aucune publication pour cette sélection et cette période.')} emptyAction={emptyAction}
      columns={[
        { key: 'post', label: t('Post', 'Publication'), hideCardLabel: true, render: row => <span className="analytics-posts__post">
          <Avatar name={row.channelName} size="sm" decorative />
          <span className="analytics-posts__text">
            {row.url ? <a href={row.url} rel="noreferrer" target="_blank">{row.text || unavailable}<IconExternalLink size={14} aria-hidden="true" /></a> : <span>{row.text || unavailable}</span>}
            <small>{row.channelName}</small>
          </span>
        </span> },
        { key: 'publishedAt', label: t('Published', 'Publié'), render: row => when(row.publishedAt) },
        ...chosen.map((measure, index) => ({ key: `m:${measure.key}`, label: measure.label, align: 'end' as const, render: (row: PostsTableRow) => {
          const value = row.measures[measure.key];
          if (value === null || value === undefined) return <span title={unavailable}>—</span>;
          const top = peak(measure.key);
          return <span className="analytics-posts__value">{number.format(value)}
            {index === 0 && top > 0 && <span className="analytics-posts__bar" aria-hidden="true"><span style={{ width: `${Math.max(2, Math.round((Math.max(0, value) / top) * 100))}%` }} /></span>}
          </span>;
        } })),
        { key: 'measuredAt', label: t('Measured', 'Mesuré'), render: row => when(row.measuredAt) },
      ]} />
  </div>;
}
