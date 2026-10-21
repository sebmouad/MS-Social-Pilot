import { DataTable } from '@/components/DataTable';
import { requireRootPage } from '@/server/config/access';
import { formatRootTimestamp } from '@/lib/root-time';
import { listRootPostDeletions } from './post-deletions';
import { RootPostDeletionControls } from './RootPostDeletionControls';

function stateLabel(state: string) {
  if (state === 'started') return 'Started';
  if (state === 'uncertain') return 'Outcome unconfirmed';
  if (state === 'remote_confirmed') return 'Remote deletion confirmed';
  if (state === 'completed') return 'Completed';
  if (state === 'rejected') return 'Not deleted';
  return 'Unknown state';
}

export async function RootPostDeletions() {
  const actor = await requireRootPage();
  let history: Awaited<ReturnType<typeof listRootPostDeletions>>;
  try { history = await listRootPostDeletions(actor.id); }
  catch { return <section className="root-control__notice" role="alert"><h2>Publishing recovery unavailable</h2><p>Post deletion history could not be loaded. Reload this section or check database availability.</p></section>; }
  const columns = [
    { key: 'operation', label: 'Operation', render: (row: typeof history.items[number]) => <code>{row.operationId}</code> },
    { key: 'workspace', label: 'Workspace', render: (row: typeof history.items[number]) => <>{row.workspaceName}<small className="root-inbox-deletions__id">{row.workspaceId}</small></> },
    { key: 'channel', label: 'Channel', render: (row: typeof history.items[number]) => <>{row.targetName || 'Channel removed'}<small className="root-inbox-deletions__id">{row.targetId}</small></> },
    { key: 'provider', label: 'Platform', render: (row: typeof history.items[number]) => row.provider },
    { key: 'remote', label: 'Remote post ID', render: (row: typeof history.items[number]) => <code>{row.remotePostId}</code> },
    { key: 'posts', label: 'Local post IDs', render: (row: typeof history.items[number]) => <div>{row.localPostIds.map(id => <code key={id}>{id}</code>)}</div> },
    { key: 'state', label: 'State', render: (row: typeof history.items[number]) => stateLabel(row.state) },
    { key: 'started', label: 'Started', render: (row: typeof history.items[number]) => formatRootTimestamp(row.createdAt, history.timeZone) },
    { key: 'updated', label: 'Updated', render: (row: typeof history.items[number]) => formatRootTimestamp(row.updatedAt, history.timeZone) },
    { key: 'action', label: 'Recovery', render: (row: typeof history.items[number]) => <RootPostDeletionControls limits={history.limits} row={row} /> },
  ];
  return <section className="root-jobs" aria-labelledby="root-post-recovery-title">
    <p className="root-jobs__eyebrow">Publishing operations</p><h2 id="root-post-recovery-title">Post deletion recovery</h2>
    <p>For an unconfirmed request, inspect the actual platform before recording an outcome. This is a human attestation, not a provider check. A delayed request may still take effect after you record “not deleted,” so check again before any new attempt.</p>
    <p>Recording an outcome does not contact the platform or remove local post history. Workspace members can finish local cleanup after deletion is confirmed. History is bounded to recent operations; post content, credentials, and provider errors are excluded.</p>
    <DataTable rows={history.items} columns={columns} rowKey={row => row.operationId} caption="Recent post deletions" emptyMessage="No post deletion operations are recorded." />
  </section>;
}
