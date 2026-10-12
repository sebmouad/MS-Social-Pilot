import Link from 'next/link';
import { getFormatter, getTranslations } from 'next-intl/server';

import { ResolveErrorButton } from '@/components/ResolveErrorButton';
import { requireRoot } from '@/lib/auth';
import { currentRelease, ERROR_RETENTION_DAYS } from '@/lib/error-tracking';
import { screenMetadata } from '@/lib/metadata';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.errors.title');
}

const SOURCES = ['server', 'worker', 'browser'] as const;

/**
 * Errors from the server, the worker and people's browsers, grouped by kind
 * (NEXT_PHASES G16). Stored in this database only, scrubbed of tokens,
 * secrets and email addresses. Root only.
 */
export default async function RootErrorsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  await requireRoot();
  const t = await getTranslations('root.errors');
  const format = await getFormatter();
  const showResolved = (await searchParams).show === 'all';
  const now = new Date();

  const errors = await prisma.errorEvent.findMany({
    where: showResolved ? {} : { resolvedAt: null },
    orderBy: { lastSeenAt: 'desc' },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('subtitle', { days: ERROR_RETENTION_DAYS, release: currentRelease() })}</p>
        </div>
        <div className="segmented" role="group" aria-label={t('filter')}>
          <Link href="/root/errors" aria-current={showResolved ? undefined : 'page'} className={`segmented-item ${showResolved ? '' : 'segmented-item-active'}`}>
            {t('open')}
          </Link>
          <Link href="/root/errors?show=all" aria-current={showResolved ? 'page' : undefined} className={`segmented-item ${showResolved ? 'segmented-item-active' : ''}`}>
            {t('all')}
          </Link>
        </div>
      </header>

      {errors.length === 0 ? (
        <section className="card p-6 text-center text-sm text-slate-600">
          <p className="font-medium text-slate-900">{t('emptyTitle')}</p>
          <p className="mt-1">{t('emptyHint')}</p>
        </section>
      ) : (
        <ul className="space-y-3">
          {errors.map((error) => (
            <li key={error.id} className="card space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="badge bg-slate-100 text-slate-700">{t(`source.${error.source as (typeof SOURCES)[number]}`)}</span>
                {error.location && <span className="break-all font-mono text-slate-600">{error.location}</span>}
                <span className="ms-auto text-slate-500">
                  {t('seen', { count: error.count, when: format.relativeTime(error.lastSeenAt, now) })}
                </span>
              </div>
              <p className="break-words text-sm font-medium text-slate-900">
                {error.name}: {error.message}
              </p>
              {error.stack && (
                <details>
                  <summary className="cursor-pointer text-xs text-slate-600">{t('stack')}</summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-[11px] text-slate-700">{error.stack}</pre>
                </details>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  {t('meta', { release: error.release, first: format.dateTime(error.firstSeenAt, { dateStyle: 'medium', timeStyle: 'short' }) })}
                </span>
                {error.resolvedAt ? <span>{t('resolvedAt', { when: format.relativeTime(error.resolvedAt, now) })}</span> : <ResolveErrorButton id={error.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
