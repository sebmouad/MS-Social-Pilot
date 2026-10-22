import { DataTable } from '@/components/DataTable';
import { requireRootPage } from '@/server/config/access';
import { formatRootTimestamp } from '@/lib/root-time';
import { listRootPublicationAttempts } from '@/server/root/publication-attempts';
import { configCopyText } from '@/lib/config/root-config-copy';
import { RootAdminPublicationControl, RootPublicationControls } from './RootPublicationControls';
import { loadRootInterfaceCopy, type RootInterfaceText } from './interface-copy';

function stateLabel(copy: RootInterfaceText, state: string) {
  if (state === 'started') return copy.stateStarted;
  if (state === 'uncertain') return copy.stateUncertain;
  if (state === 'submitted') return copy.stateSubmitted;
  if (state === 'receipt_recorded') return copy.stateReceipt;
  if (state === 'projected') return copy.stateProjected;
  if (state === 'rejected') return copy.stateRejected;
  if (state === 'attested_absent') return copy.stateAttestedAbsent;
  return copy.stateUnknown;
}

export async function RootPublicationAttempts() {
  const actor = await requireRootPage();
  const copy = await loadRootInterfaceCopy();
  let history: Awaited<ReturnType<typeof listRootPublicationAttempts>>;
  try { history = await listRootPublicationAttempts(actor.id); }
  catch { return <section className="root-control__notice" role="alert"><h2>{copy.attemptsUnavailableTitle}</h2><p>{copy.attemptsUnavailableBody}</p></section>; }
  const columns = [
    { key: 'operation', label: copy.colOperation, render: (row: typeof history.items[number]) => <code>{row.operationId}</code> },
    { key: 'workspace', label: copy.colWorkspace, render: (row: typeof history.items[number]) => <>{row.workspaceName}<small className="root-inbox-deletions__id">{row.workspaceId}</small></> },
    { key: 'post', label: copy.colLocalPost, render: (row: typeof history.items[number]) => <><code>{row.postId}</code><small className="root-inbox-deletions__id">{configCopyText(copy.destinationRecord, { id: row.postTargetId })}</small></> },
    { key: 'destination', label: copy.colDestination, render: (row: typeof history.items[number]) => <>{row.targetName || copy.destinationRemoved}<small className="root-inbox-deletions__id">{row.targetId}</small></> },
    { key: 'platform', label: copy.colPlatform, render: (row: typeof history.items[number]) => row.provider },
    { key: 'remote', label: copy.colRemotePost, render: (row: typeof history.items[number]) => <>{row.remotePostId ? <code>{row.remotePostId}</code> : '—'}{row.remoteUrl ? <a href={row.remoteUrl} target="_blank" rel="noreferrer">{copy.openLink}</a> : null}</> },
    { key: 'state', label: copy.colState, render: (row: typeof history.items[number]) => stateLabel(copy, row.state) },
    { key: 'reason', label: copy.colSafeReason, render: (row: typeof history.items[number]) => row.reason ?? '—' },
    { key: 'updated', label: copy.colUpdated, render: (row: typeof history.items[number]) => formatRootTimestamp(row.updatedAt, history.timeZone) },
    { key: 'recovery', label: copy.colRecovery, render: (row: typeof history.items[number]) => <RootPublicationControls limits={history.limits} row={row} /> },
  ];
  return <section className="root-jobs" aria-labelledby="root-publication-attempts-title">
    <p className="root-jobs__eyebrow">{copy.attemptsEyebrow}</p><h2 id="root-publication-attempts-title">{copy.attemptsTitle}</h2>
    <p>{copy.attemptsNoteBounded}</p>
    <p>{copy.attemptsNoteSubmitted}</p>
    <DataTable rows={history.items} columns={columns} rowKey={row => row.operationId} caption={copy.attemptsCaption} emptyMessage={copy.attemptsEmpty} />
    <h3>{copy.legacyTitle}</h3><p>{copy.legacyNote}</p>
    <DataTable rows={history.legacyProcessing} columns={[
      { key: 'workspace', label: copy.colWorkspace, render: (row: typeof history.legacyProcessing[number]) => <>{row.workspaceName}<small className="root-inbox-deletions__id">{row.workspaceId}</small></> },
      { key: 'post', label: copy.colLocalPost, render: (row: typeof history.legacyProcessing[number]) => <>{row.postId ? <code>{row.postId}</code> : '—'}<small className="root-inbox-deletions__id">{configCopyText(copy.destinationRecord, { id: row.postTargetId })}</small></> },
      { key: 'destination', label: copy.colDestination, render: (row: typeof history.legacyProcessing[number]) => row.targetName || copy.destinationRemoved },
      { key: 'platform', label: copy.colPlatform, render: (row: typeof history.legacyProcessing[number]) => row.provider },
      { key: 'recovery', label: copy.colRecovery, render: (row: typeof history.legacyProcessing[number]) => <RootAdminPublicationControl limits={history.limits} row={row} /> },
    ]} rowKey={row => row.postTargetId} caption={copy.legacyCaption} emptyMessage={copy.legacyEmpty} />
    {history.legacyTruncated ? <p role="status">{copy.legacyTruncated}</p> : null}
  </section>;
}
