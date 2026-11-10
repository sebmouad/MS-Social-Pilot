import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import { requireRootPage } from '@/server/config/access';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { RootFrame } from '@/modules/root/ui/RootFrame';
import { UpdateNowButton } from '@/modules/root/ui/UpdateNowButton';
import { readUpdates, runningVersion, type UpdateRow } from '@/modules/root/server/updates/store';
import { ROOT_UPDATES_COPY, updatesCopyText } from '@/lib/config/root-updates-copy';
import '../plans/root-ops.css';

export const dynamic = 'force-dynamic';
export async function generateMetadata() {
  const copy = await runtimeConfig('root.updatesCopy').catch(() => ROOT_UPDATES_COPY);
  return { title: copy.metadataTitle };
}

const TONE: Record<UpdateRow['status'], 'neutral' | 'brand' | 'success' | 'danger'> = { requested: 'neutral', running: 'brand', succeeded: 'success', failed: 'danger', superseded: 'neutral' };

export default async function RootUpdatesPage() {
  await requireRootPage();
  const [copy, automatic, branch, repository, origin, secret, running, items] = await Promise.all([
    runtimeConfig('root.updatesCopy').catch(() => ROOT_UPDATES_COPY),
    runtimeConfig('updates.automatic') as Promise<boolean>,
    runtimeConfig('updates.branch') as Promise<string>,
    runtimeConfig('updates.repository') as Promise<string>,
    (runtimeConfig('app.publicOrigin') as Promise<string>).catch(() => ''),
    runtimeSecret('updates.githubWebhookSecret').catch(() => null),
    runningVersion(),
    readUpdates().catch(() => [] as UpdateRow[]),
  ]);
  const values = { branch, repository, url: `${origin || ''}/api/updates/github` };
  // Nothing has picked up a request for two minutes although the updater looks every 30 seconds: it is not running.
  const stalled = !items.some(row => row.status === 'running') && items.some(row => row.status === 'requested' && Date.now() - new Date(row.createdAt).getTime() > 120_000);
  const text = { ...ROOT_UPDATES_COPY, ...copy };
  const when = (date: Date | null) => date ? new Date(date).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';
  return <RootFrame active="/root/updates"><div className="root-ops">
    <PageHeader module="root" title={copy.title} description={<>{copy.intro}</>} actions={<UpdateNowButton label={copy.updateNow} requested={copy.requested} failure={copy.failure} />} />
    {stalled ? <section className="root-control__notice" role="status" aria-label={text.stalledTitle}>
      <h2>{text.stalledTitle}</h2>
      <p>{text.stalled}</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}><code>{updatesCopyText(text.stalledCommand, values)}</code></pre>
    </section> : null}
    <section className="root-control__notice" aria-label={copy.running}>
      <h2>{copy.running}</h2>
      <p><code>{running ?? copy.runningUnknown}</code></p>
      <p className="small-note">{updatesCopyText(copy.updateNowHelp, values)}</p>
    </section>
    <section className="root-control__notice" aria-label={copy.automatic}>
      <h2>{copy.automatic} <Badge tone={automatic ? 'success' : 'neutral'}>{automatic ? 'On' : 'Off'}</Badge></h2>
      <p>{updatesCopyText(automatic ? copy.automaticOn : copy.automaticOff, values)}</p>
      <h2>{copy.webhookTitle}</h2>
      <p>{updatesCopyText(secret ? copy.webhookReady : copy.webhookMissing, values)}</p>
    </section>
    <section className="panel" aria-label={copy.history}>
      <DataTable caption={copy.history} rows={items} rowKey={row => row.id} emptyMessage={copy.empty} columns={[
        { key: 'when', label: copy.colWhen, render: row => when(row.createdAt) },
        { key: 'from', label: copy.colFrom, render: row => row.source === 'github' ? copy.fromGithub : copy.fromRoot },
        { key: 'version', label: copy.colVersion, render: row => <><code>{(row.deployedCommit ?? row.commit)?.slice(0, 7) ?? updatesCopyText(copy.latest, { branch: row.branch })}</code>{row.summary ? <><br /><span className="small-note">{row.summary}</span></> : null}</> },
        { key: 'status', label: copy.colStatus, render: row => <><Badge tone={TONE[row.status]}>{copy[`status_${row.status}`]}</Badge>{row.finishedAt ? <><br /><span className="small-note">{when(row.finishedAt)}</span></> : null}</> },
        { key: 'log', label: copy.colLog, render: row => row.log ? <details><summary>{copy.showLog}</summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>{row.log}</pre></details> : null },
      ]} />
    </section>
  </div></RootFrame>;
}
