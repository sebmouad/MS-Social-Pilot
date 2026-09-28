'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

const VIEWS = [
  'analysis',
  'compare',
  'overview',
  'posts',
  'interactions',
  'audience',
  'videos',
  'comments',
  'reviews',
  'inbox',
  'external',
  'instagram',
] as const;

/**
 * View switcher for the analytics screen.
 *
 * Links rather than client state, so each view is a server render against the
 * data it needs — and so a particular view can be linked to or bookmarked.
 *
 * Eleven views do not fit across a phone. Rather than wrapping them into four
 * ragged rows that push the content below the fold, small screens get a select
 * — one tap, the full list, no horizontal hunting — and the tab strip appears
 * from `sm` up where there is room for it.
 */
export function AnalyticsTabs({ current }: { current: string }) {
  const t = useTranslations('analytics');
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  function hrefFor(view: string): string {
    const next = new URLSearchParams(params.toString());
    next.set('view', view);
    return `${pathname}?${next.toString()}`;
  }

  return (
    <>
      <label className="block sm:hidden">
        <span className="sr-only">{t('chooseView')}</span>
        <select
          className="input"
          value={current}
          onChange={(event) => router.push(hrefFor(event.target.value))}
        >
          {VIEWS.map((view) => (
            <option key={view} value={view}>
              {t(`view.${view}`)}
            </option>
          ))}
        </select>
      </label>

      <nav className="scroll-x hidden border-b border-slate-200 pb-2 sm:block" aria-label={t('chooseView')}>
        <div className="flex gap-1">
          {VIEWS.map((view) => (
            <Link
              key={view}
              href={hrefFor(view)}
              aria-current={view === current ? 'page' : undefined}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                view === current ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t(`view.${view}`)}
            </Link>
          ))}
        </div>
      </nav>
    </>
  );
}
