'use client';

import { EmptyState } from '@/components/EmptyState';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

import { VIZ, seriesColor } from '@/lib/viz';
import { ExternalLink } from './ExternalLink';
import { FeedAvatar } from './FeedPost';

export interface PostRow {
  postTargetId: string;
  message: string;
  targetName: string;
  targetPictureUrl?: string | null;
  imageUrl?: string | null;
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
  /** Published through this app, or found on the Page. */
  source?: 'app' | 'page';
  /** Where the row opens; the post's own analytics by default. */
  href?: string;
}

type Source = 'all' | 'app' | 'page';
const PAGE_SIZES = [10, 25, 50] as const;

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
  const locale = useLocale();
  const [sort, setSort] = useState<SortKey>('impressions');
  const [descending, setDescending] = useState(true);
  const [source, setSource] = useState<Source>('all');
  const [size, setSize] = useState<(typeof PAGE_SIZES)[number]>(25);
  const [page, setPage] = useState(0);

  const counts = {
    all: posts.length,
    app: posts.filter((post) => (post.source ?? 'app') === 'app').length,
    page: posts.filter((post) => post.source === 'page').length,
  };
  const filtered = useMemo(
    () => (source === 'all' ? posts : posts.filter((post) => (post.source ?? 'app') === source)),
    [posts, source],
  );

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const left = a[sort];
      const right = b[sort];

      // Nulls last, whichever direction: a post with no rate is not "best",
      // and not "worst" either. Compared as text they sorted as "" — first
      // when ascending, and in among the numbers by string order otherwise.
      if (left === null || right === null) {
        return left === right ? 0 : left === null ? 1 : -1;
      }
      if (typeof left === 'number' && typeof right === 'number') {
        return descending ? right - left : left - right;
      }
      return descending
        ? String(right).localeCompare(String(left), locale)
        : String(left).localeCompare(String(right), locale);
    });
    return copy;
  }, [filtered, sort, descending, locale]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pages - 1);
  const visible = sorted.slice(current * size, current * size + size);
  const hrefOf = (post: PostRow) => post.href ?? `/analytics/post/${post.postTargetId}`;

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
    { key: 'engagementRate', label: t('engagementRate'), numeric: true },
    { key: 'reactions', label: t('reactions'), numeric: true },
    { key: 'comments', label: t('comments'), numeric: true },
    { key: 'shares', label: t('shares'), numeric: true },
    { key: 'clicks', label: t('clicks'), numeric: true },
  ];

  if (posts.length === 0) {
    return <EmptyState title={t('noPosts')} />;
  }

  const biggestReach = Math.max(...posts.map((post) => post.reach), 1);

  return (
    <section className="card-viz">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{t('byPost')}</h2>

        {/* Which posts: the ones this app published, the ones made on Facebook
            itself, or both. Only offered when there are both kinds. */}
        {counts.page > 0 && counts.app > 0 && (
          <div className="segmented" role="radiogroup" aria-label={t('sourceFilter')}>
            {(['all', 'app', 'page'] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={source === value}
                className={`segmented-item ${source === value ? 'segmented-item-active' : ''}`}
                onClick={() => {
                  setSource(value);
                  setPage(0);
                }}
              >
                {t(`source_${value}`)} <span className="nums text-xs opacity-70">{counts[value]}</span>
              </button>
            ))}
          </div>
        )}

        {/* A ten-column table has no sortable headers on a phone, so the sort
            moves into a control the card layout can use too. */}
        <div className="flex items-center gap-1.5 sm:hidden">
          <label>
            <span className="sr-only">{t('sortBy')}</span>
            <select
              className="input"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as SortKey);
                setDescending(true);
              }}
            >
              {columns.map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
            </select>
          </label>
          {/* Re-picking the selected option fires no change event, so the
              direction needs a control of its own. */}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setDescending((value) => !value)}
            aria-label={descending ? t('sortDescending') : t('sortAscending')}
            title={descending ? t('sortDescending') : t('sortAscending')}
          >
            <span aria-hidden>{descending ? '↓' : '↑'}</span>
          </button>
        </div>
      </div>

      {/* Phones get cards. A horizontally scrolling ten-column table on a
          320px screen is technically readable and practically not: the post
          text scrolls out of view exactly when the numbers come into it. */}
      <ul className="mt-3 space-y-3 sm:hidden">
        {visible.map((post) => (
          <li key={post.postTargetId} className="rounded-lg border border-slate-200 p-3">
            {/* The post as the feed draws it, then its numbers. */}
            <div className="flex items-center gap-2">
              <FeedAvatar name={post.targetName} pictureUrl={post.targetPictureUrl ?? null} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900">{post.targetName}</p>
                <p className="truncate text-xs text-slate-600">
                  {post.publishedLabel ?? ''}
                  {post.paid > 0 && ` · ${t('paid')}`}
                </p>
              </div>
            </div>
            <Link
              href={hrefOf(post)}
              className="mt-2 line-clamp-3 [overflow-wrap:anywhere] text-sm text-slate-900"
            >
              {post.message || '—'}
            </Link>
            {post.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.imageUrl} alt="" loading="lazy" className="-mx-3 mt-2 max-h-48 w-[calc(100%+1.5rem)] max-w-none object-cover" />
            )}

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
                      className="truncate text-[11px] font-semibold text-slate-600"
                      title={column.label}
                    >
                      {column.label}
                    </dt>
                    <dd className="nums text-sm font-medium text-slate-900">
                      {value === null
                        ? '—'
                        : column.key === 'engagementRate'
                          ? `${value}%`
                          : Number(value).toLocaleString(locale)}
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
        <table className="data-table w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-start text-[13px] font-semibold text-slate-600">
              <th scope="col" className="py-2 pe-3 font-medium">
                {t('post')}
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="py-2 pe-3 text-end font-medium"
                  aria-sort={
                    sort === column.key ? (descending ? 'descending' : 'ascending') : undefined
                  }
                >
                  <button
                    type="button"
                    className={`hover:text-slate-800 ${sort === column.key ? 'text-brand-700' : ''}`}
                    onClick={() => toggle(column.key)}
                  >
                    {column.label}
                    {sort === column.key && <span aria-hidden>{descending ? ' ↓' : ' ↑'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((post) => (
              <tr key={post.postTargetId} className="border-b border-slate-100 last:border-0">
                <td className="max-w-sm py-2 pe-3">
                  <div className="flex items-start gap-2.5">
                  {post.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={post.imageUrl} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-md object-cover" />
                  ) : (
                    <FeedAvatar name={post.targetName} pictureUrl={post.targetPictureUrl ?? null} size="sm" />
                  )}
                  <div className="min-w-0">
                  {/* The table shows seven numbers; the drill-down shows the
                      rest of the catalogue Graph returned for this post. */}
                  <Link
                    href={hrefOf(post)}
                    className="line-clamp-2 text-slate-800 hover:text-brand-700 hover:underline"
                  >
                    {post.message || '—'}
                  </Link>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {post.targetName}
                    {post.publishedLabel ? ` · ${post.publishedLabel}` : ''}
                    {post.source === 'page' && ` · ${t('source_page')}`}
                    {post.paid > 0 && ` · ${t('paid')}`}
                    {post.url && (
                      <>
                        {' · '}
                        <ExternalLink href={post.url} className="text-brand-600 hover:underline">
                          {t('viewOnFacebook')}
                        </ExternalLink>
                      </>
                    )}
                  </p>
                  </div>
                  </div>
                </td>
                {columns.map((column) => {
                  const value = post[column.key];
                  return (
                    <td key={column.key} className="nums py-2 pe-3 text-end text-slate-600">
                      {value === null
                        ? '—'
                        : column.key === 'engagementRate'
                          ? `${value}%`
                          : Number(value).toLocaleString(locale)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <label className="flex items-center gap-2 text-xs text-slate-600">
          {t('rowsPerPage')}
          <select
            className="input w-auto py-1 text-sm"
            value={size}
            onChange={(event) => {
              setSize(Number(event.target.value) as (typeof PAGE_SIZES)[number]);
              setPage(0);
            }}
          >
            {PAGE_SIZES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <span className="nums text-xs text-slate-600">
            {t('rowsShowing', {
              from: sorted.length ? current * size + 1 : 0,
              to: Math.min(sorted.length, current * size + size),
              total: sorted.length,
            })}
          </span>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40"
            aria-label={t('previousRows')}
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40"
            aria-label={t('nextRows')}
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            ›
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">{t('byPostHint')}</p>
    </section>
  );
}
