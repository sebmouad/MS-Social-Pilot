'use client';
import { useRootActionFeedback } from '@/server/root/RootActionFeedback';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { ModalDialog } from '@/components/ModalDialog';
import { workspaceAccessConfirmation } from '@/lib/root-workspace-access';

export function WorkspaceAccessControl({ id, name, suspended, deleting }: { id: string; name: string; suspended: boolean; deleting: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useRootActionFeedback(error, notice, () => router.refresh());
  const inFlight = useRef(false);
  const nextSuspended = !suspended;
  const phrase = workspaceAccessConfirmation(id, nextSuspended);
  const title = suspended ? 'Restore workspace' : 'Suspend workspace';
  async function save() {
    if (inFlight.current || confirmation !== phrase) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await fetch(`/api/root/workspaces/${encodeURIComponent(id)}/access`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ suspended: nextSuspended, confirmation }) });
      const payload = await response.json() as { ok?: boolean; suspended?: boolean; error?: string };
      if (!response.ok) { setError(payload.error || 'The access change could not be confirmed. Check the directory and retry.'); return; }
      if (payload.ok !== true || payload.suspended !== nextSuspended) throw new Error('Unconfirmed access change');
      setNotice(nextSuspended ? 'Workspace suspended.' : 'Workspace access restored.');
      setOpen(false); router.refresh();
    } catch { setError('The access change could not be confirmed. Check the directory before retrying.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <><Button type="button" variant="secondary" size="sm" disabled={deleting} onClick={() => { setConfirmation(''); setError(''); setNotice(''); setOpen(true); }}>{suspended ? 'Restore access' : 'Suspend'}</Button>
    {notice && <span role="status">{notice}</span>}
    {open && <ModalDialog className="ui-dialog" labelledBy={`workspace-access-${id}`} busy={busy} onDismiss={() => { if (!busy) setOpen(false); }}>
      <div className="ui-dialog__header"><h2 id={`workspace-access-${id}`}>{title}?</h2></div>
      <div className="ui-dialog__body"><p><strong>{name}</strong></p>
        <p>{nextSuspended ? 'Member access and new app operations will be paused after active operations finish. Published content stays on its platforms.' : 'Members can use their permitted features again, and background work can resume.'}</p>
        <label className="ui-field"><span>Type <strong>{phrase}</strong> to confirm</span><input className="ui-input" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" disabled={busy} /></label>
        {error && <p className="ui-error" role="alert">{error}</p>}
      </div>
      <div className="ui-dialog__actions"><Button type="button" variant="secondary" data-dialog-cancel disabled={busy} onClick={() => setOpen(false)}>Cancel</Button><Button type="button" variant={nextSuspended ? 'danger' : 'primary'} disabled={busy || confirmation !== phrase} onClick={() => void save()}>{busy ? 'Saving…' : title}</Button></div>
    </ModalDialog>}
  </>;
}
