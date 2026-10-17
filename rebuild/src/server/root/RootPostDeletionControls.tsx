'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { ModalDialog } from '@/components/ModalDialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';

type DeletionRow = {
  operationId: string; workspaceId: string; workspaceName: string; targetId: string; targetName: string | null;
  provider: string; remotePostId: string; localPostIds: string[]; state: string;
};
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function RootPostDeletionControls({ row }: { row: DeletionRow }) {
  const router = useRouter();
  const validation = useFormValidation();
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<'deleted' | 'not_deleted' | ''>('');
  const [confirmation, setConfirmation] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const previousIdentity = useRef(`${row.operationId}:${row.state}`);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const phrase = outcome ? `ROOT RECORD POST DELETION ${row.operationId} ${outcome === 'deleted' ? 'DELETED' : 'NOT DELETED'}` : '';
  const recoverable = row.state === 'started' || row.state === 'uncertain';
  const confirmationField = validation.fieldProps('confirmation');

  useEffect(() => {
    const identity = `${row.operationId}:${row.state}`;
    if (previousIdentity.current !== identity) { previousIdentity.current = identity; setReviewRequired(false); }
  }, [row.operationId, row.state]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (notice && !open) noticeRef.current?.focus(); }, [notice, open]);

  function begin() {
    if (reviewRequired) return;
    setOutcome(''); setConfirmation(''); setVerified(false); setError(''); setNotice(''); validation.clearAll(); setOpen(true);
  }

  function dismiss() {
    if (busy) return;
    setOpen(false);
    if (reviewRequired) { setNotice('Review the current deletion history before taking another action.'); router.refresh(); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recoverable || inFlight.current || reviewRequired) return;
    const errors = {
      outcome: outcome ? '' : 'Choose the result you verified on the platform.',
      confirmation: confirmation === phrase ? '' : 'Enter the exact confirmation shown.',
    };
    if (!validation.validate(event.currentTarget, errors)) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/root/post-deletions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationId: row.operationId, outcome, confirmation, verifiedOnPlatform: verified }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const validationError = response.status < 500 && record(payload) && payload.code === 'invalid_request' && typeof payload.error === 'string';
        if (!validationError) setReviewRequired(true);
        setError(record(payload) && typeof payload.error === 'string' ? payload.error : 'The outcome could not be recorded. Check recovery history before repeating it.');
        return;
      }
      const expectedState = outcome === 'deleted' ? 'remote_confirmed' : 'rejected';
      if (response.redirected || !record(payload) || payload.ok !== true || payload.operationId !== row.operationId || payload.state !== expectedState) {
        setReviewRequired(true);
        setError('The response did not confirm this operation. Check recovery history before repeating it.');
        return;
      }
      setNotice(outcome === 'deleted' ? 'Remote deletion marked as human-verified. Local cleanup remains available to the workspace member.' : 'The platform was verified as not deleted. No new provider request was made.');
      setOpen(false); setConfirmation(''); setVerified(false); setOutcome(''); router.refresh();
    } catch {
      setReviewRequired(true);
      setError('The result could not be confirmed. Check recovery history before repeating it.');
    } finally { inFlight.current = false; setBusy(false); }
  }

  return <>
    {recoverable ? <Button size="sm" variant="secondary" disabled={reviewRequired} onClick={begin}>Review</Button> : <span>{row.state === 'remote_confirmed' ? 'Awaiting local cleanup' : 'No operator action'}</span>}
    {notice && <p role="status" ref={noticeRef} tabIndex={-1}>{notice}</p>}
    {open && <ModalDialog className="ui-dialog" labelledBy={`root-post-delete-${row.operationId}`} busy={busy} initialFocus="[data-post-deletion-cancel]" onDismiss={dismiss}>
      <div className="ui-dialog__header"><h2 id={`root-post-delete-${row.operationId}`}>Record verified post deletion outcome</h2></div>
      <form method="post" noValidate onSubmit={event => void submit(event)}>
        <div className="ui-dialog__body">
          <p>Check the actual platform before recording either result. This is a human attestation, not a provider check. A pending request may still take effect later, including after “not deleted” is recorded; check again before starting another attempt.</p>
          <p><strong>Workspace:</strong> {row.workspaceName} · {row.workspaceId}</p>
          <p><strong>Channel:</strong> {row.targetName || 'Channel removed'} · {row.targetId}</p>
          <p><strong>Platform:</strong> {row.provider} · <strong>Remote post ID:</strong> <code>{row.remotePostId}</code></p>
          <p><strong>Local post IDs:</strong> {row.localPostIds.map(id => <code key={id}>{id} </code>)}</p>
          <fieldset className="ui-field" disabled={busy}>
            <legend>Verified result on platform</legend>
            <label><input type="radio" name="outcome" value="deleted" checked={outcome === 'deleted'} onChange={() => { setOutcome('deleted'); validation.clear('outcome'); setConfirmation(''); validation.clear('confirmation'); }} /> Deleted</label>
            <label><input type="radio" name="outcome" value="not_deleted" checked={outcome === 'not_deleted'} onChange={() => { setOutcome('not_deleted'); validation.clear('outcome'); setConfirmation(''); validation.clear('confirmation'); }} /> Not deleted</label>
          </fieldset>
          <FieldError {...validation.errorProps('outcome')} />
          <label className="ui-field" htmlFor={confirmationField.id}><span>Type <strong>{phrase || 'choose a verified result'}</strong> to confirm</span>
            <input {...confirmationField} className="ui-input" name="confirmation" value={confirmation} maxLength={300} autoComplete="off" disabled={busy || !outcome} onChange={event => { setConfirmation(event.target.value); validation.clear('confirmation'); }} />
          </label>
          <FieldError {...validation.errorProps('confirmation')} />
          <label className="ui-field"><span><input type="checkbox" name="verifiedOnPlatform" checked={verified} required disabled={busy} onChange={event => { setVerified(event.target.checked); validation.clear('verifiedOnPlatform'); }} /> I checked the actual platform for this exact post.</span></label>
          <FieldError {...validation.errorProps('verifiedOnPlatform')} />
          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="ui-error">{error}</p>}
        </div>
        <div className="ui-dialog__actions">
          <Button type="button" data-dialog-cancel data-post-deletion-cancel disabled={busy} onClick={dismiss}>{reviewRequired ? 'Close and review' : 'Cancel'}</Button>
          <Button type="submit" variant="danger" disabled={busy || reviewRequired || !outcome || confirmation !== phrase || !verified}>{busy ? 'Recording…' : 'Record verified outcome'}</Button>
        </div>
      </form>
    </ModalDialog>}
  </>;
}
