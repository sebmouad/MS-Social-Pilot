'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

const VIEWS = ['overview', 'posts', 'interactions', 'audience'] as const;

/**
 * View switcher for the analytics screen.
 *
 * Links rather than client state, so each view is a server render against the
 * data it needs — and so a particular view can be linked to or bookmarked.
 */
export function AnalyticsTabs({ current }: { current: string }) {
  const t = useTranslations('analytics');
  const pathname = usePathname();
  const params = useSearchParams();

  function hrefFor(view: string): string {
    const next = new URLSearchParams(params.toString());
    next.set('view', view);
    return `${pathname}?${next.toString()}`;
  }

  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200 pb-3">
      {VIEWS.map((view) => (
        <Link
          key={view}
          href={hrefFor(view)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            view === current ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {t(`view.${view}`)}
        </Link>
      ))}
    </nav>
  );
}
