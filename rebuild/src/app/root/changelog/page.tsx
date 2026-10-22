import { headers } from 'next/headers';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { ROOT_CHANGELOG_COPY, rootChangelogCopySchema } from '@/modules/history/root-copy';
import { listRootChangelog } from '@/modules/history/server/changelog';
import { ChangelogManager } from '@/modules/history/ui/ChangelogManager';
import styles from '@/modules/history/ui/history.module.css';
import { requireRootPage } from '@/server/config/access';
import { configOrDefault } from '@/server/config/config-or-default';
import { RootFrame } from '@/server/root/RootFrame';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export async function generateMetadata() { return { title: 'Changelog · Root' }; }

export default async function RootChangelogPage() {
  const actor = await requireRootPage();
  const locale = /^\s*fr\b/i.test((await headers()).get('accept-language') ?? '') ? 'fr' : 'en';
  const copy = (await configOrDefault('root.changelogCopy', rootChangelogCopySchema).catch(() => ROOT_CHANGELOG_COPY))[locale];
  const [list, siteOn] = await Promise.all([
    listRootChangelog(actor.id).then(data => data.items).catch(() => null),
    configOrDefault('public.siteEnabled', z.boolean()).catch(() => false),
  ]);
  return <RootFrame active="/root/changelog"><div className={styles.root}>
    <PageHeader module="root" title={copy.title} description={copy.description} />
    <p className={styles.notice} data-tone={siteOn ? undefined : 'warning'}>{siteOn ? copy.siteOn : copy.siteOff}</p>
    {list === null
      ? <EmptyState tone="error" title={copy.loadFailure} />
      : <ChangelogManager copy={copy} locale={locale} entries={list} today={new Date().toISOString().slice(0, 10)} />}
  </div></RootFrame>;
}
