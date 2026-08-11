import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import type { Page } from '@/lib/paging';

/**
 * Previous / next, and how much there is.
 *
 * A server component with plain links rather than buttons, so a page is a URL:
 * it can be bookmarked, opened in a new tab, and comes back where it was after
 * a refresh. Nothing here needs to run in the browser.
 */
export async function Pagination({
  page,
  href,
}: {
  page: Page;
  /** Builds the URL for a page number, carrying whatever filters are on screen. */
  href: (page: number) => string;
}) {
  const t = await getTranslations('common');

  // One page of results needs no controls, but the count is still worth saying
  // — it is the difference between "these are your posts" and "these are some".
  if (page.pages <= 1) {
    return page.total > 0 ? (
      <p className="text-xs text-slate-500">{t('countOf', { count: page.total })}</p>
    ) : null;
  }

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4"
      aria-label={t('pagination')}
    >
      <p className="text-xs text-slate-500">
        {t('showingRange', { from: page.from, to: page.to, total: page.total })}
      </p>

      <div className="flex items-center gap-2">
        {page.hasPrevious ? (
          <Link href={href(page.number - 1)} className="btn-secondary" rel="prev">
            {t('previous')}
          </Link>
        ) : (
          <span className="btn-secondary pointer-events-none opacity-40" aria-disabled="true">
            {t('previous')}
          </span>
        )}

        <span className="text-xs text-slate-500">
          {t('pageOf', { page: page.number, pages: page.pages })}
        </span>

        {page.hasNext ? (
          <Link href={href(page.number + 1)} className="btn-secondary" rel="next">
            {t('next')}
          </Link>
        ) : (
          <span className="btn-secondary pointer-events-none opacity-40" aria-disabled="true">
            {t('next')}
          </span>
        )}
      </div>
    </nav>
  );
}
