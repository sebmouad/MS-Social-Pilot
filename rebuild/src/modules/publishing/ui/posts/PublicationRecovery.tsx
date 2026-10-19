"use client";

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components';
import { ModalDialog } from '@/components/ModalDialog';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import styles from '@/modules/publishing/ui/publishing.module.css';

type Operation = { id: string; postTargetId: string; targetId: string; targetName: string | null; state: string; reason: string | null; remotePostId: string | null; remoteUrl: string | null; createdAt: string; updatedAt: string };
type Status = { postId: string; operations: Operation[]; legacyProcessingCount: number; truncated: boolean };
type Target = { id: string; name?: string | null; status: string; remotePostId: string | null };
type Mode = { kind: 'record'; operation: Operation } | { kind: 'finish'; operation: Operation } | { kind: 'adopt'; target: Target };
type Props = { postId: string; excerpt: string; targets: Target[] };

function isStatus(value: unknown): value is Status {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<Status>;
  const textOrNull = (item: unknown) => item === null || typeof item === 'string';
  const safeLink = (item: unknown) => { if (item === null) return true; if (typeof item !== 'string') return false; try { const url = new URL(item); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
  return typeof result.postId === 'string' && Array.isArray(result.operations) && result.operations.every(operation => operation && typeof operation.id === 'string' && typeof operation.postTargetId === 'string' && typeof operation.targetId === 'string' && textOrNull(operation.targetName) && ['started', 'uncertain', 'submitted', 'receipt_recorded', 'projected', 'rejected', 'attested_absent'].includes(operation.state) && textOrNull(operation.remotePostId) && safeLink(operation.remoteUrl)) && Number.isSafeInteger(result.legacyProcessingCount) && Number(result.legacyProcessingCount) >= 0 && typeof result.truncated === 'boolean';
}

async function readStatus(postId: string): Promise<Status> {
  const response = await fetch(`/api/publishing/recovery?postId=${encodeURIComponent(postId)}`, { cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body && typeof body.error === 'string' ? body.error : 'Publication recovery could not be loaded.');
  if (response.redirected || !isStatus(body) || body.postId !== postId) throw new Error('Publication recovery returned an unreadable status. Reload and check again.');
  return body;
}

export function PublicationRecovery({ postId, excerpt, targets }: Props) {
  const router = useRouter();
  const validation = useFormValidation();
  const inFlight = useRef(false);
  const loadVersion = useRef(0);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const [notice, setNotice] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [loadPending, setLoadPending] = useState(false);
  const [pending, setPending] = useState(false);
  const [opened, setOpened] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [outcome, setOutcome] = useState<'PUBLISHED' | 'ABSENT' | ''>('');
  const [verified, setVerified] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [remotePostId, setRemotePostId] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);

  async function refresh() {
    const version = ++loadVersion.current;
    setLoadPending(true); setError('');
    try { const next = await readStatus(postId); if (version === loadVersion.current) setStatus(next); }
    catch (cause) { if (version === loadVersion.current) setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Publication recovery could not be loaded.'); }
    finally { if (version === loadVersion.current) setLoadPending(false); }
  }
  useEffect(() => { if (opened) void refresh(); return () => { loadVersion.current++; }; }, [opened, postId]);
  useEffect(() => { if (notice && !mode) noticeRef.current?.focus(); }, [notice, mode]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function open(next: Mode) {
    const submittedId = next.kind === 'record' && next.operation.state === 'submitted' ? next.operation.remotePostId : null;
    validation.clearAll(); setNotice(''); setError(''); setOutcome(submittedId ? 'PUBLISHED' : ''); setVerified(false); setConfirmation(''); setRemotePostId(submittedId ?? ''); setRemoteUrl(next.kind === 'record' ? next.operation.remoteUrl ?? '' : ''); setMode(next);
  }
  const expected = mode?.kind === 'record' && outcome ? `RECORD PUBLICATION ${mode.operation.id} ${outcome}` : mode?.kind === 'finish' ? `FINISH PUBLICATION ${mode.operation.id}` : mode?.kind === 'adopt' ? `ADOPT PUBLICATION ${mode.target.id}` : '';

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode || inFlight.current) return;
    if (!validation.validate(event.currentTarget, {
      outcome: mode.kind === 'record' && !outcome ? 'Choose the outcome you checked on the destination.' : '',
      remotePostId: mode.kind === 'record' && outcome === 'PUBLISHED' && !remotePostId.trim() ? 'Enter the remote post ID found on the destination.' : '',
      confirmation: !expected || confirmation !== expected ? 'Enter the exact confirmation shown.' : '',
    })) return;
    inFlight.current = true; setPending(true); setError('');
    const payload = mode.kind === 'record'
      ? { action: 'record', postId, operationId: mode.operation.id, outcome, verifiedExternally: true, confirmation, ...(outcome === 'PUBLISHED' ? { remotePostId: remotePostId.trim(), ...(remoteUrl.trim() ? { remoteUrl: remoteUrl.trim() } : {}) } : {}) }
      : mode.kind === 'finish'
        ? { action: 'finish', postId, operationId: mode.operation.id, confirmation }
        : { action: 'adopt', postId, postTargetId: mode.target.id, confirmation };
    try {
      const response = await fetch('/api/publishing/recovery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body && typeof body.error === 'string' ? body.error : 'The recovery outcome could not be saved. Check current status before repeating it.');
      if (response.redirected || !isStatus(body) || body.postId !== postId) throw new Error('The outcome may have been saved, but the returned status was unreadable. Refresh publication status before repeating any action.');
      const confirmed = mode.kind === 'record' ? body.operations.some(operation => operation.id === mode.operation.id && operation.state === (outcome === 'PUBLISHED' ? 'receipt_recorded' : 'attested_absent') && (mode.operation.state !== 'submitted' || operation.remotePostId === mode.operation.remotePostId)) : mode.kind === 'finish' ? body.operations.some(operation => operation.id === mode.operation.id && operation.state === 'projected') : body.operations.some(operation => operation.postTargetId === mode.target.id && operation.state === 'uncertain');
      if (!confirmed) throw new Error('The response did not confirm this operation. Refresh publication status before repeating it.');
      setNotice(mode.kind === 'finish' ? 'Local publication record updated. No new publication was sent.' : mode.kind === 'adopt' ? 'Older destination adopted for outcome review.' : mode.operation.state === 'submitted' ? 'Human-verified receipt saved. Finish the local record separately. No new publication was sent.' : outcome === 'PUBLISHED' ? 'Human-verified receipt saved. Finish the local record separately.' : 'Human-verified absence recorded. No publication was sent.');
      setStatus(body); setMode(null);
      if (mode.kind === 'finish' || mode.kind === 'record' && outcome === 'ABSENT') {
        const destination = new URL(window.location.href);
        destination.searchParams.set('notice', mode.kind === 'finish' ? 'publication-finished' : 'publication-absent');
        destination.searchParams.set('recovery', mode.operation.id);
        router.replace(destination.pathname + destination.search, { scroll: false });
      } else router.refresh();
    } catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'The recovery outcome could not be saved. Check current status before repeating it.'); }
    finally { inFlight.current = false; setPending(false); }
  }

  async function refreshFromDialog() {
    setLoadPending(true); setError('');
    try { setStatus(await readStatus(postId)); setMode(null); router.refresh(); }
    catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : 'Publication status could not be refreshed.'); }
    finally { setLoadPending(false); }
  }

  const unresolvedTargets = targets.filter(target => target.status === 'processing');
  if (!unresolvedTargets.length) return notice ? <p ref={noticeRef} tabIndex={-1} role="status">{notice}</p> : null;
  const confirmationField = validation.fieldProps('confirmation');
  const remoteIdField = validation.fieldProps('remotePostId');
  const remoteUrlField = validation.fieldProps('remoteUrl');
  return <section className={styles.help} aria-label="Publication recovery" tabIndex={-1}>
    {notice && <p ref={noticeRef} tabIndex={-1} role="status">{notice}</p>}
    <strong>Publication result needs review</strong>
    <p>A destination may have accepted this post even if its response was lost. Check the destination directly before recording an outcome.</p>
    <Button variant="secondary" size="sm" type="button" onClick={() => { setOpened(value => !value); if (status === null && !error) setLoadPending(true); }} aria-expanded={opened}>{opened ? 'Hide recovery' : 'Review publication result'}</Button>
    {opened ? <div className={styles.help}>
      {loadPending && !status ? <p role="status">Loading publication history…</p> : null}
      {error && !mode ? <><p role="alert" tabIndex={-1} ref={errorRef} className="ui-error">{error}</p><Button variant="secondary" size="sm" type="button" disabled={loadPending} onClick={() => void refresh()}>{loadPending ? 'Checking…' : 'Refresh publication status'}</Button></> : null}
      {status ? <>
        <p><strong>Post context:</strong> {excerpt || 'No post text is available.'}</p>
        {status.truncated ? <p role="status">This history is limited to recent operations. Older records are not shown here. Ask your workspace administrator if you need more history.</p> : null}
        {status.operations.map(operation => <article key={operation.id} className={styles.firstCommentRow}>
          <div><strong>{operation.targetName || 'Destination'}</strong><p>Operation <code>{operation.id}</code> · {operation.state === 'submitted' ? 'Submitted; awaiting verification' : operation.state.replaceAll('_', ' ')}</p>
            {operation.remotePostId ? <p>Remote post ID: <code>{operation.remotePostId}</code></p> : null}
            {operation.remoteUrl ? <p><a href={operation.remoteUrl} target="_blank" rel="noreferrer">Open recorded publication</a></p> : null}
          </div>
          {['started', 'uncertain'].includes(operation.state) ? <Button variant="secondary" size="sm" type="button" disabled={pending} onClick={() => open({ kind: 'record', operation })}>Record external check</Button> : operation.state === 'submitted' && operation.remotePostId ? <Button variant="secondary" size="sm" type="button" disabled={pending} onClick={() => open({ kind: 'record', operation })}>Verify submitted publication</Button> : operation.state === 'receipt_recorded' ? <Button variant="primary" size="sm" type="button" disabled={pending} onClick={() => open({ kind: 'finish', operation })}>Finish local record</Button> : null}
        </article>)}
        {status.legacyProcessingCount > 0 ? <div><p>{status.legacyProcessingCount} older processing destination(s) have no recovery operation yet. Adopt only after checking the destination directly.</p>{unresolvedTargets.filter(target => !status.operations.some(op => op.postTargetId === target.id)).map(target => <Button key={target.id} variant="secondary" size="sm" type="button" disabled={pending} onClick={() => open({ kind: 'adopt', target })}>Adopt {target.name || 'destination'} for recovery</Button>)}</div> : null}
      </> : null}
    </div> : null}
    {mode ? <ModalDialog className="ui-dialog" labelledBy="publication-recovery-title" onDismiss={() => { if (!pending) setMode(null); }} busy={pending} initialFocus={error ? '[data-publication-error]' : '[data-publication-cancel]'}>
      <form method="post" noValidate onSubmit={submit}>
        <div className="ui-dialog__header"><div><h2 id="publication-recovery-title">{mode.kind === 'record' ? 'Record the destination check' : mode.kind === 'finish' ? 'Finish the local publication record?' : 'Adopt this older destination?'}</h2><p>{mode.kind === 'record' ? `External check for ${mode.operation.targetName || 'this destination'}.` : mode.kind === 'adopt' ? `External check for ${mode.target.name || 'this destination'}.` : 'This updates local records only.'}</p></div></div>
        <div className="ui-dialog__body">
          <p><strong>Post context:</strong> {excerpt || 'No post text is available.'}</p>
          {mode.kind === 'record' ? <>
            {mode.operation.state === 'submitted' ? <p>Check that this exact submitted post is published. Its saved ID cannot be replaced. This records your external check; finish the local record separately.</p> : null}
            <fieldset className="ui-field" disabled={pending}><legend>What did you verify on the destination?</legend>
              {!(mode.operation.state === 'submitted' && mode.operation.remotePostId) ? <label><input type="radio" name="outcome" value="ABSENT" checked={outcome === 'ABSENT'} onChange={() => { setOutcome('ABSENT'); setConfirmation(''); }} /> The post is absent</label> : null}
              <label><input type="radio" name="outcome" value="PUBLISHED" checked={outcome === 'PUBLISHED'} onChange={() => { setOutcome('PUBLISHED'); setConfirmation(''); }} /> The post is published</label>
            </fieldset>
            {outcome === 'PUBLISHED' ? <><FieldError {...validation.errorProps('outcome')} /><label className="ui-field" htmlFor={remoteIdField.id}><span>Remote post ID</span><input {...remoteIdField} className="ui-input" name="remotePostId" required value={remotePostId} onChange={event => { setRemotePostId(event.target.value); validation.clear('remotePostId'); }} disabled={pending} readOnly={Boolean(mode.operation.state === 'submitted' && mode.operation.remotePostId)} /></label><FieldError {...validation.errorProps('remotePostId')} /><label className="ui-field" htmlFor={remoteUrlField.id}><span>Public post link, if available</span><input {...remoteUrlField} className="ui-input" name="remoteUrl" type="url" value={remoteUrl} onChange={event => { setRemoteUrl(event.target.value); validation.clear('remoteUrl'); }} disabled={pending} /></label><FieldError {...validation.errorProps('remoteUrl')} /></> : null}
          </> : null}
          {mode.kind === 'record' || mode.kind === 'adopt' ? <><label className="ui-field"><span><input type="checkbox" name="verifiedExternally" required checked={verified} disabled={pending} onChange={event => { setVerified(event.target.checked); validation.clear('verifiedExternally'); }} /> I checked this exact destination myself. This is not automated verification, and a delayed request may still complete later.</span></label><FieldError {...validation.errorProps('verifiedExternally')} /></> : null}
          <p>{mode.kind === 'finish' ? 'This only projects a saved receipt into local post records. It will not send another publication request.' : 'The app will not contact the platform or retry the original request.'}</p>
          <label className="ui-field" htmlFor={confirmationField.id}><span>Type <strong>{expected || 'choose an outcome first'}</strong> to confirm</span><input {...confirmationField} className="ui-input" name="confirmation" autoComplete="off" value={confirmation} onChange={event => { setConfirmation(event.target.value); validation.clear('confirmation'); }} disabled={pending || !expected} /></label><FieldError {...validation.errorProps('confirmation')} />
          {error ? <><p id="publication-recovery-error" data-publication-error ref={errorRef} tabIndex={-1} role="alert" className="ui-error">{error}</p><Button variant="secondary" size="sm" type="button" disabled={loadPending || pending} onClick={() => void refreshFromDialog()}>{loadPending ? 'Checking status…' : 'Refresh publication status'}</Button></> : null}
        </div>
        <div className="ui-dialog__actions"><Button type="button" data-publication-cancel disabled={pending} onClick={() => setMode(null)}>Cancel</Button><Button variant="primary" type="submit" aria-busy={pending} disabled={pending || !expected || confirmation !== expected || (mode.kind === 'record' && (!verified || !outcome || outcome === 'PUBLISHED' && !remotePostId.trim())) || (mode.kind === 'adopt' && !verified)}>{mode.kind === 'finish' ? 'Finish local record' : mode.kind === 'adopt' ? 'Adopt for recovery' : 'Record checked outcome'}</Button></div>
      </form>
    </ModalDialog> : null}
  </section>;
}
