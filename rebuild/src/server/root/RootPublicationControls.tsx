'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { ModalDialog } from '@/components/ModalDialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';

type Context = { workspaceId: string; workspaceName: string; postId: string; targetId: string; targetName: string | null };
type Row = Context & { operationId: string; state: string; remotePostId: string | null; remoteUrl: string | null };
type Mode = 'record' | 'finish' | 'adopt';
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function RootPublicationControls({ row }: { row: Row }) {
  const mode = row.state === 'receipt_recorded' ? 'finish' : ['started', 'uncertain'].includes(row.state) ? 'record' : null;
  return <RecoveryControl mode={mode ?? 'record'} context={row} identity={row.operationId} available={mode !== null} />;
}
export function RootLegacyPublicationControl({ row }: { row: Context & { postTargetId: string } }) {
  return <RecoveryControl mode="adopt" context={row} identity={row.postTargetId} />;
}
function RecoveryControl({ mode, context, identity, available = true }: { mode: Mode; context: Context; identity: string; available?: boolean }) {
  const router = useRouter();
  const validation = useFormValidation();
  const inFlight = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<'PUBLISHED' | 'ABSENT' | ''>('');
  const [remotePostId, setRemotePostId] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const phrase = mode === 'record' ? outcome ? `ROOT RECORD PUBLICATION ${identity} ${outcome}` : '' : `ROOT ${mode === 'finish' ? 'FINISH' : 'ADOPT'} PUBLICATION ${identity}`;
  const label = mode === 'record' ? 'Record external check' : mode === 'finish' ? 'Finish local record' : 'Adopt for recovery';
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (notice && !open) noticeRef.current?.focus(); }, [notice, open]);
  function begin() {
    setOutcome(''); setRemotePostId(''); setRemoteUrl(''); setConfirmation(''); setVerified(false); setError(''); setNotice(''); validation.clearAll(); setOpen(true);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!validation.validate(event.currentTarget, {
      outcome: mode === 'record' && !outcome ? 'Choose the result you checked on the destination.' : '',
      remotePostId: mode === 'record' && outcome === 'PUBLISHED' && !remotePostId.trim() ? 'Enter the remote post ID found on the destination.' : '',
      confirmation: !phrase || confirmation !== phrase ? 'Enter the exact confirmation shown.' : '',
    })) return;
    inFlight.current = true; setPending(true); setError('');
    const payload = mode === 'record'
      ? { operationId: identity, outcome, verifiedExternally: verified, confirmation, ...(outcome === 'PUBLISHED' ? { remotePostId: remotePostId.trim(), ...(remoteUrl.trim() ? { remoteUrl: remoteUrl.trim() } : {}) } : {}) }
      : mode === 'finish' ? { action: 'finish', operationId: identity, confirmation } : { action: 'adopt', postTargetId: identity, confirmation };
    try {
      const response = await fetch('/api/root/publication-attempts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(object(body) && typeof body.error === 'string' ? body.error : 'The outcome could not be confirmed. Refresh attempt status before repeating it.');
      const expected = mode === 'record' ? outcome === 'PUBLISHED' ? 'receipt_recorded' : 'attested_absent' : mode === 'finish' ? 'projected' : 'uncertain';
      if (response.redirected || !object(body) || body.ok !== true || body.state !== expected || typeof body.operationId !== 'string' || !body.operationId || mode !== 'adopt' && body.operationId !== identity) throw new Error('This response did not confirm the requested recovery. Refresh attempt status before repeating it.');
      setNotice(mode === 'record' ? outcome === 'PUBLISHED' ? 'Human-verified receipt saved. Finish the local record separately.' : 'Human-verified absence recorded. No new publication was sent.' : mode === 'finish' ? 'Local publication record updated. No new publication was sent.' : 'Older destination adopted for outcome review. No publication was sent.');
      setOpen(false); router.refresh();
    } catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'The outcome could not be confirmed. Refresh attempt status before repeating it.'); }
    finally { inFlight.current = false; setPending(false); }
  }
  const confirmationField = validation.fieldProps('confirmation');
  const remoteIdField = validation.fieldProps('remotePostId');
  const remoteUrlField = validation.fieldProps('remoteUrl');
  return <>
    {available ? <Button variant="secondary" size="sm" onClick={begin}>{label}</Button> : <span>No operator action</span>}
    {notice && <p ref={noticeRef} tabIndex={-1} role="status">{notice}</p>}
    {open && <ModalDialog className="ui-dialog" labelledBy={`root-publication-${identity}`} busy={pending} initialFocus="[data-publication-cancel]" onDismiss={() => { if (!pending) setOpen(false); }}>
      <div className="ui-dialog__header"><h2 id={`root-publication-${identity}`}>{label}</h2></div>
      <form method="post" noValidate onSubmit={event => void submit(event)}>
        <div className="ui-dialog__body">
          <p><strong>Workspace:</strong> {context.workspaceName} · {context.workspaceId}</p>
          <p><strong>Channel:</strong> {context.targetName || 'Channel removed'} · {context.targetId}</p>
          <p><strong>Local post:</strong> <code>{context.postId}</code></p>
          <p>{mode === 'finish' ? 'This only updates local records from the saved receipt. It sends no publication or first comment.' : 'Check the destination directly first. This records a human external check and never contacts the platform. A delayed request may still complete after absence is recorded; check again before retrying.'}</p>
          {mode === 'record' && <>
            <fieldset className="ui-field" disabled={pending}><legend>Verified result on destination</legend>
              <label><input type="radio" name="outcome" value="ABSENT" checked={outcome === 'ABSENT'} onChange={() => { setOutcome('ABSENT'); setConfirmation(''); validation.clear('outcome'); validation.clear('confirmation'); }} /> The publication is absent</label>
              <label><input type="radio" name="outcome" value="PUBLISHED" checked={outcome === 'PUBLISHED'} onChange={() => { setOutcome('PUBLISHED'); setConfirmation(''); validation.clear('outcome'); validation.clear('confirmation'); }} /> The publication exists</label>
            </fieldset><FieldError {...validation.errorProps('outcome')} />
            {outcome === 'PUBLISHED' && <>
              <label className="ui-field" htmlFor={remoteIdField.id}><span>Remote post ID</span><input {...remoteIdField} className="ui-input" name="remotePostId" value={remotePostId} disabled={pending} required onChange={event => { setRemotePostId(event.target.value); validation.clear('remotePostId'); }} /></label><FieldError {...validation.errorProps('remotePostId')} />
              <label className="ui-field" htmlFor={remoteUrlField.id}><span>Public post link, if available</span><input {...remoteUrlField} className="ui-input" name="remoteUrl" type="url" value={remoteUrl} disabled={pending} onChange={event => { setRemoteUrl(event.target.value); validation.clear('remoteUrl'); }} /></label><FieldError {...validation.errorProps('remoteUrl')} />
            </>}
          </>}
          <label className="ui-field" htmlFor={confirmationField.id}><span>Type <strong>{phrase || 'choose a verified result'}</strong> to confirm</span><input {...confirmationField} className="ui-input" name="confirmation" value={confirmation} autoComplete="off" disabled={pending || !phrase} onChange={event => { setConfirmation(event.target.value); validation.clear('confirmation'); }} /></label><FieldError {...validation.errorProps('confirmation')} />
          {mode !== 'finish' && <><label className="ui-field"><span><input type="checkbox" name="verifiedExternally" checked={verified} required disabled={pending} onChange={event => { setVerified(event.target.checked); validation.clear('verifiedExternally'); }} /> I checked this exact destination. This is not automated verification.</span></label><FieldError {...validation.errorProps('verifiedExternally')} /></>}
          {error && <><p ref={errorRef} tabIndex={-1} role="alert" className="ui-error">{error}</p><Button type="button" size="sm" disabled={pending} onClick={() => { setOpen(false); router.refresh(); }}>Refresh attempt status</Button></>}
        </div>
        <div className="ui-dialog__actions"><Button type="button" data-publication-cancel disabled={pending} onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" type="submit" aria-busy={pending} disabled={pending || !phrase || confirmation !== phrase || mode !== 'finish' && !verified || mode === 'record' && outcome === 'PUBLISHED' && !remotePostId.trim()}>{label}</Button></div>
      </form>
    </ModalDialog>}
  </>;
}
