import { DataTable } from '@/components/DataTable';
import { requireRootPage } from '@/server/config/access';
import { formatRootTimestamp } from '@/lib/root-time';
import { listRootInboxDeletions } from './inbox-deletions';
import { RootInboxDeletionControls } from './RootInboxDeletionControls';

function stateLabel(state: string) {
  if (state === 'started') return 'Started';
  if (state === 'uncertain') return 'Outcome unconfirmed';
  if (state === 'remote_confirmed') return 'Remote deletion confirmed';
  if (state === 'completed') return 'Completed';
  if (state === 'rejected') return 'Rejected';
  return 'Unknown state';
}

export async function RootInboxDeletions() {
  const actor = await requireRootPage();
  let history: Awaited<ReturnType<typeof listRootInboxDeletions>>;
  try { history = await listRootInboxDeletions(actor.id); }
  catch { return <section className="root-control__notice" role="alert"><h2>Inbox recovery unavailable</h2><p>Deletion history could not be loaded. Reload this section or check database availability.</p></section>; }
  const columns = [
    { key: 'operation', label: 'Operation', render: (row: typeof history.items[number]) => <code>{row.operationId}</code> },
    { key: 'workspace', label: 'Workspace', render: (row: typeof history.items[number]) => <>{row.workspaceName}<small className="root-inbox-deletions__id">{row.workspaceId}</small></> },
    { key: 'channel', label: 'Channel', render: (row: typeof history.items[number]) => <>{row.targetName || 'Channel removed'}<small className="root-inbox-deletions__id">{row.targetId}</small></> },
    { key: 'provider', label: 'Platform', render: (row: typeof history.items[number]) => row.provider },
    { key: 'remote', label: 'Remote comment ID', render: (row: typeof history.items[number]) => <code>{row.remoteObjectId}</code> },
    { key: 'item', label: 'Inbox item', render: (row: typeof history.items[number]) => <code>{row.localItemId}</code> },
    { key: 'state', label: 'State', render: (row: typeof history.items[number]) => stateLabel(row.state) },
    { key: 'started', label: 'Started', render: (row: typeof history.items[number]) => formatRootTimestamp(row.createdAt, history.timeZone) },
    { key: 'updated', label: 'Updated', render: (row: typeof history.items[number]) => formatRootTimestamp(row.updatedAt, history.timeZone) },
    { key: 'action', label: 'Recovery', render: (row: typeof history.items[number]) => <RootInboxDeletionControls limits={history.limits} row={row} /> },
  ];
  return <section className="root-jobs" aria-labelledby="root-inbox-recovery-title">
    <p className="root-jobs__eyebrow">Inbox operations</p><h2 id="root-inbox-recovery-title">Comment deletion recovery</h2>
    <p>For an unconfirmed outcome, check the actual platform before recording an operator confirmation. This records your attestation; it does not contact the platform or remove local Inbox rows.</p>
    <p>History is limited to the most recently updated operations. Remote comment IDs appear only to help verify the platform result; provider errors and message content are not shown.</p>
    <DataTable rows={history.items} columns={columns} rowKey={row => row.operationId} caption="Recent Inbox comment deletions" emptyMessage="No comment deletion operations are recorded." />
  </section>;
}
