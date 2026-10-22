'use client';
import { ROOT_RECOVERY_LIMITS, type RootRecoveryLimits } from '@/lib/config/root-recovery-policy';
import { useRootActionFeedback } from '@/modules/root/ui/RootActionFeedback';
import { useRootInterface } from './RootInterface';

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

export function RootPostDeletionControls({ row, limits = ROOT_RECOVERY_LIMITS }: { row: DeletionRow; limits?: RootRecoveryLimits }) {
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
  useRootActionFeedback(error, notice, () => router.refresh());
  const copy = useRootInterface();
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
    {recoverable ? <Button size="sm" variant="secondary" disabled={reviewRequired} onClick={begin}>{copy.reviewAction}</Button> : <span>{row.state === 'remote_confirmed' ? copy.awaitingCleanup : copy.noOperatorAction}</span>}
    {notice && <p role="status" ref={noticeRef} tabIndex={-1}>{notice}</p>}
    {open && <ModalDialog className="ui-dialog" labelledBy={`root-post-delete-${row.operationId}`} busy={busy} initialFocus="[data-post-deletion-cancel]" onDismiss={dismiss}>
      <div className="ui-dialog__header"><h2 id={`root-post-delete-${row.operationId}`}>{copy.postRecoveryTitle}</h2></div>
      <form method="post" noValidate onSubmit={event => void submit(event)}>
        <div className="ui-dialog__body">
          <p>{copy.postRecoveryAttestation}</p>
          <p><strong>{copy.recoveryWorkspace}</strong> {row.workspaceName} · {row.workspaceId}</p>
          <p><strong>{copy.recoveryChannel}</strong> {row.targetName || copy.recoveryChannelRemoved} · {row.targetId}</p>
          <p><strong>{copy.recoveryPlatform}</strong> {row.provider} · <strong>{copy.postRecoveryRemotePost}</strong> <code>{row.remotePostId}</code></p>
          <p><strong>{copy.postRecoveryLocalPosts}</strong> {row.localPostIds.map(id => <code key={id}>{id} </code>)}</p>
          <fieldset className="ui-field" disabled={busy}>
            <legend>{copy.postRecoveryLegend}</legend>
            <label><input type="radio" name="outcome" value="deleted" checked={outcome === 'deleted'} onChange={() => { setOutcome('deleted'); validation.clear('outcome'); setConfirmation(''); validation.clear('confirmation'); }} /> {copy.postRecoveryDeleted}</label>
            <label><input type="radio" name="outcome" value="not_deleted" checked={outcome === 'not_deleted'} onChange={() => { setOutcome('not_deleted'); validation.clear('outcome'); setConfirmation(''); validation.clear('confirmation'); }} /> {copy.postRecoveryNotDeleted}</label>
          </fieldset>
          <FieldError {...validation.errorProps('outcome')} />
          <label className="ui-field" htmlFor={confirmationField.id}><span>{copy.recoveryType} <strong>{phrase || copy.recoveryChooseResult}</strong> {copy.recoveryToConfirm}</span>
            <input {...confirmationField} className="ui-input" name="confirmation" value={confirmation} maxLength={limits.confirmationMaxCharacters} autoComplete="off" disabled={busy || !outcome} onChange={event => { setConfirmation(event.target.value); validation.clear('confirmation'); }} />
          </label>
          <FieldError {...validation.errorProps('confirmation')} />
          <label className="ui-field"><span><input type="checkbox" name="verifiedOnPlatform" checked={verified} required disabled={busy} onChange={event => { setVerified(event.target.checked); validation.clear('verifiedOnPlatform'); }} /> {copy.postRecoveryChecked}</span></label>
          <FieldError {...validation.errorProps('verifiedOnPlatform')} />
          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="ui-error">{error}</p>}
        </div>
        <div className="ui-dialog__actions">
          <Button type="button" data-dialog-cancel data-post-deletion-cancel disabled={busy} onClick={dismiss}>{reviewRequired ? copy.postRecoveryCloseReview : copy.cancel}</Button>
          <Button type="submit" variant="danger" disabled={busy || reviewRequired || !outcome || confirmation !== phrase || !verified}>{busy ? copy.recoveryRecording : copy.postRecoveryRecord}</Button>
        </div>
      </form>
    </ModalDialog>}
  </>;
}
