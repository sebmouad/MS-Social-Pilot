'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

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

  return (
    <section className="card p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('byPost')}</h2>

      {/* Wide table: scrolls inside its own container, never the page. */}
      <div className="overflow-x-auto">
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
                  <p className="line-clamp-2 text-slate-800">{post.message || '—'}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {post.targetName}
                    {post.publishedLabel ? ` · ${post.publishedLabel}` : ''}
                    {post.paid > 0 && ` · ${t('paid')}`}
                    {post.url && (
                      <>
                        {' · '}
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-600 hover:underline"
                        >
                          Facebook
                        </a>
                      </>
                    )}
                  </p>
                </td>
                {columns.map((column) => {
                  const value = post[column.key];
                  return (
                    <td key={column.key} className="py-2 pr-3 text-right text-slate-600">
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
