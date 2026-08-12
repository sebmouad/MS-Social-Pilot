'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { VIZ, seriesColor } from '@/lib/viz';
import { ExternalLink } from './ExternalLink';

export interface PostRow {
  postTargetId: string;
  message: string;
  targetName: string;
  publishedLabel: string | null;
  url: string | null;
  impressions: number;
  reach: number;
  engagedUsers: number;
  reactions: number;
  comments: number;
  shares: number;
  clicks: number;
  negativeFeedback: number;
  videoViews: number;
  organic: number;
  paid: number;
  engagementRate: number | null;
}

type SortKey =
  | 'publishedLabel'
  | 'impressions'
  | 'reach'
  | 'engagedUsers'
  | 'reactions'
  | 'comments'
  | 'shares'
  | 'clicks'
  | 'engagementRate';

/**
 * Impressions and interaction per post.
 *
 * One row per post *per destination*: the same post can perform very
 * differently on two Pages, and averaging that away hides the useful signal.
 */
export function PostAnalyticsTable({ posts }: { posts: PostRow[] }) {
  const t = useTranslations('analytics');
  const [sort, setSort] = useState<SortKey>('impressions');
  const [descending, setDescending] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...posts];
    copy.sort((a, b) => {
      const left = a[sort];
      const right = b[sort];

      if (typeof left === 'number' && typeof right === 'number') {
        return descending ? right - left : left - right;
      }
      // Nulls last, whichever direction: a post with no value is not "best".
      const leftText = left ?? '';
      const rightText = right ?? '';
      return descending
        ? String(rightText).localeCompare(String(leftText))
        : String(leftText).localeCompare(String(rightText));
    });
    return copy;
  }, [posts, sort, descending]);

  function toggle(key: SortKey) {
    if (key === sort) {
      setDescending((value) => !value);
    } else {
      setSort(key);
      setDescending(true);
    }
  }

  const columns: Array<{ key: SortKey; label: string; numeric: boolean }> = [
    { key: 'impressions', label: t('impressions'), numeric: true },
    { key: 'reach', label: t('reach'), numeric: true },
    { key: 'engagedUsers', label: t('engaged'), numeric: true },
    { key: 'engagementRate', label: t('engagementRate'), numeric: true },
    { key: 'reactions', label: t('reactions'), numeric: true },
    { key: 'comments', label: t('comments'), numeric: true },
    { key: 'shares', label: t('shares'), numeric: true },
    { key: 'clicks', label: t('clicks'), numeric: true },
  ];

  if (posts.length === 0) {
    return <div className="card p-8 text-center text-sm text-slate-600">{t('noPosts')}</div>;
  }

  const biggestReach = Math.max(...posts.map((post) => post.reach), 1);

  return (
    <section className="card-viz">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{t('byPost')}</h2>

        {/* A ten-column table has no sortable headers on a phone, so the sort
            moves into a control the card layout can use too. */}
        <label className="sm:hidden">
          <span className="sr-only">{t('sortBy')}</span>
          <select
            className="input"
            value={sort}
            onChange={(event) => toggle(event.target.value as SortKey)}
          >
            {columns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Phones get cards. A horizontally scrolling ten-column table on a
          320px screen is technically readable and practically not: the post
          text scrolls out of view exactly when the numbers come into it. */}
      <ul className="mt-3 space-y-3 sm:hidden">
        {sorted.map((post) => (
          <li key={post.postTargetId} className="rounded-lg border border-slate-200 p-3">
            <Link
              href={`/analytics/post/${post.postTargetId}`}
              className="line-clamp-3 [overflow-wrap:anywhere] text-sm text-slate-800"
            >
              {post.message || '—'}
            </Link>

            <p className="mt-1 text-xs text-slate-500">
              {post.targetName}
              {post.publishedLabel ? ` · ${post.publishedLabel}` : ''}
              {post.paid > 0 && ` · ${t('paid')}`}
            </p>

            {/* Reach against the best-performing post in the range: the one
                comparison a single row cannot make on its own. */}
            <span
              className="mt-2 block h-1.5 w-full overflow-hidden rounded-sm"
              style={{ background: VIZ.grid }}
              aria-hidden
            >
              <span
                className="block h-full"
                style={{
                  width: `${Math.max(2, (post.reach / biggestReach) * 100)}%`,
                  background: seriesColor(0),
                  borderTopRightRadius: 4,
                  borderBottomRightRadius: 4,
                }}
              />
            </span>

            <dl className="mt-2 grid grid-cols-3 gap-2">
              {columns.slice(0, 6).map((column) => {
                const value = post[column.key];
                return (
                  <div key={column.key}>
                    {/* One line each, so the values below them share a
                        baseline instead of stepping down the card. */}
                    <dt
                      className="truncate text-[10px] uppercase tracking-wide text-slate-500"
                      title={column.label}
                    >
                      {column.label}
                    </dt>
                    <dd className="nums text-sm font-medium text-slate-900">
                      {value === null
                        ? '—'
                        : column.key === 'engagementRate'
                          ? `${value}%`
                          : Number(value).toLocaleString()}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </li>
        ))}
      </ul>

      {/* Wide table: scrolls inside its own container, never the page. */}
      <div className="scroll-x mt-3 hidden sm:block">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-2 pr-3 font-medium">{t('post')}</th>
              {columns.map((column) => (
                <th key={column.key} className="py-2 pr-3 text-right font-medium">
                  <button
                    type="button"
                    className={`hover:text-slate-800 ${sort === column.key ? 'text-brand-700' : ''}`}
                    onClick={() => toggle(column.key)}
                  >
                    {column.label}
                    {sort === column.key && (descending ? ' ↓' : ' ↑')}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((post) => (
              <tr key={post.postTargetId} className="border-b border-slate-100 last:border-0">
                <td className="max-w-xs py-2 pr-3">
                  {/* The table shows seven numbers; the drill-down shows the
                      rest of the catalogue Graph returned for this post. */}
                  <Link
                    href={`/analytics/post/${post.postTargetId}`}
                    className="line-clamp-2 text-slate-800 hover:text-brand-700 hover:underline"
                  >
                    {post.message || '—'}
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {post.targetName}
                    {post.publishedLabel ? ` · ${post.publishedLabel}` : ''}
                    {post.paid > 0 && ` · ${t('paid')}`}
                    {post.url && (
                      <>
                        {' · '}
                        <ExternalLink href={post.url} className="text-brand-600 hover:underline">
                          Facebook
                        </ExternalLink>
                      </>
                    )}
                  </p>
                </td>
                {columns.map((column) => {
                  const value = post[column.key];
                  return (
                    <td key={column.key} className="nums py-2 pr-3 text-right text-slate-600">
                      {value === null
                        ? '—'
                        : column.key === 'engagementRate'
                          ? `${value}%`
                          : Number(value).toLocaleString()}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-slate-500">{t('byPostHint')}</p>
    </section>
  );
}
