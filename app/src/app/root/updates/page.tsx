import { PageHeader } from '@/components/PageHeader';
import { requireRootPage } from '@/server/config/access';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { UpdatesWorkspace } from '@/modules/root/ui/UpdatesWorkspace';
import { readUpdates, runningVersion, type UpdateRow } from '@/modules/root/server/updates/store';
import { ROOT_UPDATES_COPY } from '@/lib/config/root-updates-copy';
import './updates.css';

export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  const copy = await runtimeConfig('root.updatesCopy').catch(() => ROOT_UPDATES_COPY);
  return { title: copy.metadataTitle };
}

export default async function RootUpdatesPage() {
  await requireRootPage();
  const [stored, automatic, branch, repository, origin, secret, running, items] = await Promise.all([
    runtimeConfig('root.updatesCopy').catch(() => ROOT_UPDATES_COPY),
    runtimeConfig('updates.automatic') as Promise<boolean>,
    runtimeConfig('updates.branch') as Promise<string>,
    runtimeConfig('updates.repository') as Promise<string>,
    (runtimeConfig('app.publicOrigin') as Promise<string>).catch(() => ''),
    runtimeSecret('updates.githubWebhookSecret').catch(() => null),
    runningVersion(),
    readUpdates().catch(() => [] as UpdateRow[]),
  ]);
  // Wording saved before a release lacks that release's new labels.
  const copy = { ...ROOT_UPDATES_COPY, ...stored };
  const now = Date.now();
  // Nothing has picked up a request for two minutes although the updater looks every 30 seconds: it is not running.
  const stalled = !items.some(row => row.status === 'running') && items.some(row => row.status === 'requested' && now - new Date(row.createdAt).getTime() > 120_000);
  const iso = (date: Date | null) => date ? new Date(date).toISOString() : null;
  return <RootFrame active="/root/updates">
    <PageHeader module="root" title={copy.title} description={<>{copy.intro}</>} />
    <UpdatesWorkspace copy={copy} running={running} automatic={automatic} connected={Boolean(secret)} branch={branch} repository={repository} url={`${origin || ''}/api/updates/github`} stalled={stalled} now={now}
      items={items.map(({ log, createdAt, startedAt, finishedAt, ...item }) => ({ ...item, hasLog: Boolean(log), createdAt: iso(createdAt)!, startedAt: iso(startedAt), finishedAt: iso(finishedAt) }))} />
  </RootFrame>;
}
