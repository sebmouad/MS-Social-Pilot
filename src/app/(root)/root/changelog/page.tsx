import { getTranslations } from 'next-intl/server';

import { ChangelogClient } from '@/components/ChangelogClient';
import { requireRoot } from '@/lib/auth';
import { screenMetadata } from '@/lib/metadata';
import { listChangelog, siteIsPublic } from '@/lib/site';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('root.changelog.title');
}

/** Root writes the public changelog. */
export default async function RootChangelogPage() {
  await requireRoot();
  const [t, entries, isPublic] = await Promise.all([getTranslations('root.changelog'), listChangelog(), siteIsPublic()]);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-600">{isPublic ? t('subtitle') : t('siteOff')}</p>
      </header>
      <ChangelogClient
        entries={entries.map((entry) => ({ id: entry.id, publishedOn: entry.publishedOn.toISOString().slice(0, 10), title: entry.title, body: entry.body }))}
      />
    </div>
  );
}
