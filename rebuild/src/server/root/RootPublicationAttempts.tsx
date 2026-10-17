import { DataTable } from '@/components/DataTable';
import { requireRootPage } from '@/server/config/access';
import { formatRootTimestamp } from '@/lib/root-time';
import { listRootPublicationAttempts } from './publication-attempts';
import { RootLegacyPublicationControl, RootPublicationControls } from './RootPublicationControls';

const stateLabel: Record<string, string> = { started: 'Started', uncertain: 'Outcome unconfirmed', receipt_recorded: 'Receipt saved; local record pending', projected: 'Recorded locally', rejected: 'Provider rejected', attested_absent: 'Externally checked absent' };

export async function RootPublicationAttempts() {
  const actor = await requireRootPage();
  let history: Awaited<ReturnType<typeof listRootPublicationAttempts>>;
  try { history = await listRootPublicationAttempts(actor.id); }
  catch { return <section className="root-control__notice" role="alert"><h2>Publication recovery unavailable</h2><p>Attempt history could not be loaded. Reload this section or check database availability.</p></section>; }
  const columns = [
    { key: 'operation', label: 'Operation', render: (row: typeof history.items[number]) => <code>{row.operationId}</code> },
    { key: 'workspace', label: 'Workspace', render: (row: typeof history.items[number]) => <>{row.workspaceName}<small className="root-inbox-deletions__id">{row.workspaceId}</small></> },
    { key: 'post', label: 'Local post', render: (row: typeof history.items[number]) => <><code>{row.postId}</code><small className="root-inbox-deletions__id">Destination record {row.postTargetId}</small></> },
    { key: 'destination', label: 'Destination', render: (row: typeof history.items[number]) => <>{row.targetName || 'Destination removed'}<small className="root-inbox-deletions__id">{row.targetId}</small></> },
    { key: 'platform', label: 'Platform', render: (row: typeof history.items[number]) => row.provider },
    { key: 'remote', label: 'Remote post', render: (row: typeof history.items[number]) => <>{row.remotePostId ? <code>{row.remotePostId}</code> : '—'}{row.remoteUrl ? <a href={row.remoteUrl} target="_blank" rel="noreferrer">Open link</a> : null}</> },
    { key: 'state', label: 'State', render: (row: typeof history.items[number]) => stateLabel[row.state] ?? 'Unknown state' },
    { key: 'reason', label: 'Safe reason', render: (row: typeof history.items[number]) => row.reason ?? '—' },
    { key: 'updated', label: 'Updated', render: (row: typeof history.items[number]) => formatRootTimestamp(row.updatedAt, history.timeZone) },
    { key: 'recovery', label: 'Recovery', render: (row: typeof history.items[number]) => <RootPublicationControls row={row} /> },
  ];
  return <section className="root-jobs" aria-labelledby="root-publication-attempts-title">
    <p className="root-jobs__eyebrow">Publishing operations</p><h2 id="root-publication-attempts-title">Publication attempt recovery</h2>
    <p>History is bounded and contains no post content, credentials, or raw provider errors. For an unconfirmed attempt, check the destination directly before recording an outcome. This is a human external check, not automated verification. A delayed request may still complete after you record that it is absent.</p>
    <p>Recording an outcome does not contact the platform. A saved receipt can be projected into the local post record without sending another publication request.</p>
    <DataTable rows={history.items} columns={columns} rowKey={row => row.operationId} caption="Recent publication attempts" emptyMessage="No publication attempts are recorded." />
    <h3>Older processing destinations</h3><p>These records predate the recovery journal. Check the destination externally before adopting one.</p>
    <DataTable rows={history.legacyProcessing} columns={[
      { key: 'workspace', label: 'Workspace', render: (row: typeof history.legacyProcessing[number]) => <>{row.workspaceName}<small className="root-inbox-deletions__id">{row.workspaceId}</small></> },
      { key: 'post', label: 'Local post', render: (row: typeof history.legacyProcessing[number]) => <><code>{row.postId}</code><small className="root-inbox-deletions__id">Destination record {row.postTargetId}</small></> },
      { key: 'destination', label: 'Destination', render: (row: typeof history.legacyProcessing[number]) => row.targetName || 'Destination removed' },
      { key: 'platform', label: 'Platform', render: (row: typeof history.legacyProcessing[number]) => row.provider },
      { key: 'recovery', label: 'Recovery', render: (row: typeof history.legacyProcessing[number]) => <RootLegacyPublicationControl row={row} /> },
    ]} rowKey={row => row.postTargetId} caption="Legacy processing destinations" emptyMessage="No older processing destinations need adoption." />
    {history.legacyTruncated ? <p role="status">More older processing destinations exist than this history limit. Increase the Publishing recovery history limit to inspect them.</p> : null}
  </section>;
}
