'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { ANALYTICS_VIEWS, INBOX_VIEW_PATHS, PRIMARY_ANALYTICS_VIEWS, VIEW_SCOPED_PARAMS } from '@/lib/analytics-views';

// Engagement views open from the Inbox sidebar, not from here.
const VIEWS = ANALYTICS_VIEWS.filter((view) => !INBOX_VIEW_PATHS[view]);

/**
 * View switcher for the analytics screen.
 *
 * Links rather than client state, so each view is a server render against the
 * data it needs — and so a particular view can be linked to or bookmarked.
 *
 * Four main views as a segmented control, the rest under "More". Views
 * do not fit across a phone. Rather than wrapping them into four
 * ragged rows that push the content below the fold, small screens get a select
 * — one tap, the full list, no horizontal hunting — and the tab strip appears
 * from `sm` up where there is room for it.
 */
export function AnalyticsTabs({ current, hidden = [] }: { current: string; hidden?: string[] }) {
  const t = useTranslations('analytics');
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  function hrefFor(view: string): string {
    const next = new URLSearchParams(params.toString());
    next.set('view', view);
    // The destination and the window carry over; one view's search, filter
    // and page number do not.
    for (const key of VIEW_SCOPED_PARAMS) next.delete(key);
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
          {VIEWS.filter((view) => !hidden.includes(view) || view === current).map((view) => (
            <option key={view} value={view}>
              {t(`view.${view}`)}
            </option>
          ))}
        </select>
      </label>

      <nav className="hidden flex-wrap items-center gap-2 sm:flex" aria-label={t('chooseView')}>
        <div className="segmented">
          {PRIMARY_ANALYTICS_VIEWS.map((view) => (
            <Link
              key={view}
              href={hrefFor(view)}
              aria-current={view === current ? 'page' : undefined}
              className={`segmented-item ${view === current ? 'segmented-item-active' : ''}`}
            >
              {t(`view.${view}`)}
            </Link>
          ))}
        </div>
        <label>
          <span className="sr-only">{t('moreViews')}</span>
          <select
            className={`input w-auto ${PRIMARY_ANALYTICS_VIEWS.includes(current as never) ? '' : 'border-brand-500 text-brand-600'}`}
            value={PRIMARY_ANALYTICS_VIEWS.includes(current as never) ? '' : current}
            onChange={(event) => event.target.value && router.push(hrefFor(event.target.value))}
          >
            <option value="">{t('moreViews')}</option>
            {VIEWS.filter((view) => !PRIMARY_ANALYTICS_VIEWS.includes(view) && (!hidden.includes(view) || view === current)).map((view) => (
              <option key={view} value={view}>
                {t(`view.${view}`)}
              </option>
            ))}
          </select>
        </label>
      </nav>
    </>
  );
}
