'use client';
import { useRootActionFeedback } from '@/server/root/RootActionFeedback';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { ModalDialog } from '@/components/ModalDialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';

type DeletionRow = {
  operationId: string; workspaceId: string; workspaceName: string; targetId: string;
  targetName: string | null; provider: string; remoteObjectId: string; localItemId: string; state: string; createdAt: string; updatedAt: string;
  remoteConfirmedAt: string | null; completedAt: string | null;
};
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function RootInboxDeletionControls({ row }: { row: DeletionRow }) {
  const router = useRouter();
  const validation = useFormValidation();
  const inFlight = useRef(false);
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useRootActionFeedback(error, notice, () => router.refresh());
  const phrase = `CONFIRM REMOTE DELETION ${row.operationId}`;
  const recoverable = row.state === 'started' || row.state === 'uncertain';
  const confirmationField = validation.fieldProps('confirmation');

  function begin() {
    setConfirmation(''); setVerified(false); setError(''); setNotice(''); validation.clearAll(); setOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recoverable || inFlight.current) return;
    if (!validation.validate(event.currentTarget, { confirmation: confirmation === phrase ? '' : 'Enter the exact confirmation shown.' })) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/root/inbox-deletions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: row.operationId, confirmation, verifiedOnPlatform: verified }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(record(payload) && typeof payload.error === 'string' ? payload.error : 'The confirmation could not be recorded. Check recovery history before repeating it.');
        return;
      }
      if (response.redirected || !record(payload) || payload.ok !== true || payload.operationId !== row.operationId || payload.workspaceId !== row.workspaceId || payload.targetId !== row.targetId || payload.localItemId !== row.localItemId || payload.state !== 'remote_confirmed') {
        setError('The response did not confirm this operation. Check recovery history before repeating it.');
        return;
      }
      setNotice('Remote deletion marked as confirmed. Local Inbox removal remains available to the workspace member.');
      setOpen(false); setConfirmation(''); setVerified(false); router.refresh();
    } catch {
      setError('The result could not be confirmed. Check recovery history before repeating it.');
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <>
    {recoverable ? <Button size="sm" variant="secondary" onClick={begin}>Review</Button> : <span>{row.state === 'remote_confirmed' ? 'Awaiting local cleanup' : 'No operator action'}</span>}
    {notice && <p role="status">{notice}</p>}
    {open && <ModalDialog className="ui-dialog" labelledBy={`root-inbox-delete-${row.operationId}`} busy={busy} onDismiss={() => { if (!busy) setOpen(false); }}>
      <div className="ui-dialog__header"><h2 id={`root-inbox-delete-${row.operationId}`}>Confirm remote deletion</h2></div>
      <form method="post" noValidate onSubmit={event => void submit(event)}>
        <div className="ui-dialog__body">
          <p>Verify the comment and its replies are deleted on the actual platform before continuing. This is an operator attestation, not an automatic provider check.</p>
          <p><strong>Workspace:</strong> {row.workspaceName} · {row.workspaceId}</p>
          <p><strong>Channel:</strong> {row.targetName || 'Channel removed'} · {row.targetId}</p>
          <p><strong>Platform:</strong> {row.provider}</p>
          <p><strong>Remote comment ID:</strong> <code>{row.remoteObjectId}</code></p>
          <p><strong>Inbox item:</strong> {row.localItemId}</p>
          <label className="ui-field" htmlFor={confirmationField.id}><span>Type <strong>{phrase}</strong> to confirm</span>
            <input {...confirmationField} className="ui-input" name="confirmation" value={confirmation} maxLength={300} autoComplete="off" disabled={busy} onChange={event => { setConfirmation(event.target.value); validation.clear('confirmation'); }} />
          </label>
          <FieldError {...validation.errorProps('confirmation')} />
          <label className="ui-field"><span><input {...validation.fieldProps('verifiedOnPlatform')} type="checkbox" name="verifiedOnPlatform" checked={verified} required disabled={busy} onChange={event => { setVerified(event.target.checked); validation.clear('verifiedOnPlatform'); }} /> I verified the deletion on the platform.</span></label>
          <FieldError {...validation.errorProps('verifiedOnPlatform')} />
          {error && <p role="alert" className="ui-error">{error}</p>}
        </div>
        <div className="ui-dialog__actions">
          <Button type="button" data-dialog-cancel disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={busy || confirmation !== phrase || !verified}>{busy ? 'Recording…' : 'Confirm remote deletion'}</Button>
        </div>
      </form>
    </ModalDialog>}
  </>;
}
