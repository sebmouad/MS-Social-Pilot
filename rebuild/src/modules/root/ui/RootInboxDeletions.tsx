import { DataTable } from '@/components/DataTable';
import { requireRootPage } from '@/server/config/access';
import { formatRootTimestamp } from '@/lib/root-time';
import { listRootInboxDeletions } from '@/server/root/inbox-deletions';
import { RootInboxDeletionControls } from './RootInboxDeletionControls';
import { loadRootInterfaceCopy, type RootInterfaceText } from './interface-copy';

function stateLabel(copy: RootInterfaceText, state: string) {
  if (state === 'started') return copy.stateStarted;
  if (state === 'uncertain') return copy.stateUncertain;
  if (state === 'remote_confirmed') return copy.stateRemoteConfirmed;
  if (state === 'completed') return copy.stateCompleted;
  if (state === 'rejected') return copy.stateRejectedGeneric;
  return copy.stateUnknown;
}

export async function RootInboxDeletions() {
  const actor = await requireRootPage();
  const copy = await loadRootInterfaceCopy();
  let history: Awaited<ReturnType<typeof listRootInboxDeletions>>;
  try { history = await listRootInboxDeletions(actor.id); }
  catch { return <section className="root-control__notice" role="alert"><h2>{copy.inboxUnavailableTitle}</h2><p>{copy.inboxUnavailableBody}</p></section>; }
  const columns = [
    { key: 'operation', label: copy.colOperation, render: (row: typeof history.items[number]) => <code>{row.operationId}</code> },
    { key: 'workspace', label: copy.colWorkspace, render: (row: typeof history.items[number]) => <>{row.workspaceName}<small className="root-inbox-deletions__id">{row.workspaceId}</small></> },
    { key: 'channel', label: copy.colChannel, render: (row: typeof history.items[number]) => <>{row.targetName || copy.recoveryChannelRemoved}<small className="root-inbox-deletions__id">{row.targetId}</small></> },
    { key: 'provider', label: copy.colPlatform, render: (row: typeof history.items[number]) => row.provider },
    { key: 'remote', label: copy.colRemoteCommentId, render: (row: typeof history.items[number]) => <code>{row.remoteObjectId}</code> },
    { key: 'item', label: copy.colInboxItem, render: (row: typeof history.items[number]) => <code>{row.localItemId}</code> },
    { key: 'state', label: copy.colState, render: (row: typeof history.items[number]) => stateLabel(copy, row.state) },
    { key: 'started', label: copy.colStarted, render: (row: typeof history.items[number]) => formatRootTimestamp(row.createdAt, history.timeZone) },
    { key: 'updated', label: copy.colUpdated, render: (row: typeof history.items[number]) => formatRootTimestamp(row.updatedAt, history.timeZone) },
    { key: 'action', label: copy.colRecovery, render: (row: typeof history.items[number]) => <RootInboxDeletionControls limits={history.limits} row={row} /> },
  ];
  return <section className="root-jobs" aria-labelledby="root-inbox-recovery-title">
    <p className="root-jobs__eyebrow">{copy.inboxEyebrow}</p><h2 id="root-inbox-recovery-title">{copy.inboxTitle}</h2>
    <p>{copy.inboxNoteAttestation}</p>
    <p>{copy.inboxNoteBounded}</p>
    <DataTable rows={history.items} columns={columns} rowKey={row => row.operationId} caption={copy.inboxCaption} emptyMessage={copy.inboxEmpty} />
  </section>;
}
