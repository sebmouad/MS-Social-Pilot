import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';

import { SiteFrame } from '@/components/SiteFrame';
import { screenMetadata } from '@/lib/metadata';
import { listChangelog, siteIsPublic } from '@/lib/site';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('site.nav.changelog');
}

/** What changed, newest first, as root wrote it. */
export default async function ChangelogPage() {
  if (!(await siteIsPublic())) notFound();
  const [t, format, entries] = await Promise.all([getTranslations('site.changelog'), getFormatter(), listChangelog()]);
  return (
    <SiteFrame>
      <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
      {entries.length === 0 ? (
        <p className="card mt-6 p-6 text-sm text-slate-600">{t('empty')}</p>
      ) : (
        <ol className="mt-6 space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="card p-5">
              <time className="text-xs text-slate-500" dateTime={entry.publishedOn.toISOString().slice(0, 10)}>
                {format.dateTime(entry.publishedOn, { dateStyle: 'long', timeZone: 'UTC' })}
              </time>
              <h2 className="mt-1 font-semibold text-slate-900">{entry.title}</h2>
              {entry.body && <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{entry.body}</p>}
            </li>
          ))}
        </ol>
      )}
    </SiteFrame>
  );
}
