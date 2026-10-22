import { DataTable } from '@/components/DataTable';
import { requireRootPage } from '@/server/config/access';
import { formatRootTimestamp } from '@/lib/root-time';
import { listRootPostDeletions } from '@/server/root/post-deletions';
import { RootPostDeletionControls } from './RootPostDeletionControls';
import { loadRootInterfaceCopy, type RootInterfaceText } from './interface-copy';

function stateLabel(copy: RootInterfaceText, state: string) {
  if (state === 'started') return copy.stateStarted;
  if (state === 'uncertain') return copy.stateUncertain;
  if (state === 'remote_confirmed') return copy.stateRemoteConfirmed;
  if (state === 'completed') return copy.stateCompleted;
  if (state === 'rejected') return copy.stateNotDeleted;
  return copy.stateUnknown;
}

export async function RootPostDeletions() {
  const actor = await requireRootPage();
  const copy = await loadRootInterfaceCopy();
  let history: Awaited<ReturnType<typeof listRootPostDeletions>>;
  try { history = await listRootPostDeletions(actor.id); }
  catch { return <section className="root-control__notice" role="alert"><h2>{copy.postUnavailableTitle}</h2><p>{copy.postUnavailableBody}</p></section>; }
  const columns = [
    { key: 'operation', label: copy.colOperation, render: (row: typeof history.items[number]) => <code>{row.operationId}</code> },
    { key: 'workspace', label: copy.colWorkspace, render: (row: typeof history.items[number]) => <>{row.workspaceName}<small className="root-inbox-deletions__id">{row.workspaceId}</small></> },
    { key: 'channel', label: copy.colChannel, render: (row: typeof history.items[number]) => <>{row.targetName || copy.recoveryChannelRemoved}<small className="root-inbox-deletions__id">{row.targetId}</small></> },
    { key: 'provider', label: copy.colPlatform, render: (row: typeof history.items[number]) => row.provider },
    { key: 'remote', label: copy.colRemotePostId, render: (row: typeof history.items[number]) => <code>{row.remotePostId}</code> },
    { key: 'posts', label: copy.colLocalPostIds, render: (row: typeof history.items[number]) => <div>{row.localPostIds.map(id => <code key={id}>{id}</code>)}</div> },
    { key: 'state', label: copy.colState, render: (row: typeof history.items[number]) => stateLabel(copy, row.state) },
    { key: 'started', label: copy.colStarted, render: (row: typeof history.items[number]) => formatRootTimestamp(row.createdAt, history.timeZone) },
    { key: 'updated', label: copy.colUpdated, render: (row: typeof history.items[number]) => formatRootTimestamp(row.updatedAt, history.timeZone) },
    { key: 'action', label: copy.colRecovery, render: (row: typeof history.items[number]) => <RootPostDeletionControls limits={history.limits} row={row} /> },
  ];
  return <section className="root-jobs" aria-labelledby="root-post-recovery-title">
    <p className="root-jobs__eyebrow">{copy.attemptsEyebrow}</p><h2 id="root-post-recovery-title">{copy.postTitle}</h2>
    <p>{copy.postNoteAttestation}</p>
    <p>{copy.postNoteBounded}</p>
    <DataTable rows={history.items} columns={columns} rowKey={row => row.operationId} caption={copy.postCaption} emptyMessage={copy.postEmpty} />
  </section>;
}
