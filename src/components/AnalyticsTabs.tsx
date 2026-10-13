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
 * Four main views, then the rest below a divider. Views
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
    // The destination and the window carry over; one view's search, filter
    // and page number do not.
    for (const key of VIEW_SCOPED_PARAMS) next.delete(key);
    // The report is the last view of this section: its own screen, same Page
    // and window.
    if (view === 'report') {
      next.delete('view');
      return `/reports?${next.toString()}`;
    }
    next.delete('sections');
    next.set('view', view);
    return `${pathname === '/reports' ? '/analytics' : pathname}?${next.toString()}`;
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
          <option value="report">{t('view.report')}</option>
        </select>
      </label>

      <nav className="hidden space-y-1 sm:block" aria-label={t('chooseView')}>
        <ul className="space-y-0.5">
          {PRIMARY_ANALYTICS_VIEWS.map((view) => (
            <li key={view}>
              <Link
                href={hrefFor(view)}
                aria-current={view === current ? 'page' : undefined}
                className={`block rounded-lg px-3 py-2 text-sm font-semibold ${
                  view === current ? 'bg-brand-50 text-brand-700' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {t(`view.${view}`)}
              </Link>
            </li>
          ))}
        </ul>
        <ul className="space-y-0.5 border-t border-slate-200 pt-1">
          {VIEWS.filter((view) => !PRIMARY_ANALYTICS_VIEWS.includes(view) && (!hidden.includes(view) || view === current)).map((view) => (
            <li key={view}>
              <Link
                href={hrefFor(view)}
                aria-current={view === current ? 'page' : undefined}
                className={`block rounded-lg px-3 py-2 text-sm font-semibold ${
                  view === current ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {t(`view.${view}`)}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href={hrefFor('report')}
              aria-current={current === 'report' ? 'page' : undefined}
              className={`block rounded-lg px-3 py-2 text-sm font-semibold ${
                current === 'report' ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {t('view.report')}
            </Link>
          </li>
        </ul>
      </nav>
    </>
  );
}
