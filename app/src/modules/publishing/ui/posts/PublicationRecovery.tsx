"use client";
import { usePublishingActionText } from '@/modules/publishing/ui/WorkflowSubmitButtons';
import { defaultPublishingActionText, type PublishingActionText, type PublishingActionCopyKey } from '@/modules/publishing/action-catalog';

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

async function readStatus(postId: string, t: PublishingActionText = defaultPublishingActionText): Promise<Status> {
  const response = await fetch(`/api/publishing/recovery?postId=${encodeURIComponent(postId)}`, { cache: 'no-store' });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body && typeof body.error === 'string' ? body.error : t('publicationRecoveryCouldNotBeLoaded'));
  if (response.redirected || !isStatus(body) || body.postId !== postId) throw new Error(t('publicationRecoveryReturnedAnUnreadableStatusReload'));
  return body;
}

export function PublicationRecovery({ postId, excerpt, targets }: Props) {
  const t = usePublishingActionText();
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
    try { const next = await readStatus(postId, t); if (version === loadVersion.current) setStatus(next); }
    catch (cause) { if (version === loadVersion.current) setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : t('publicationRecoveryCouldNotBeLoaded')); }
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
      outcome: mode.kind === 'record' && !outcome ? t('chooseTheOutcomeYouCheckedOnThe') : '',
      remotePostId: mode.kind === 'record' && outcome === 'PUBLISHED' && !remotePostId.trim() ? t('enterTheRemotePostIDFoundOn') : '',
      confirmation: !expected || confirmation !== expected ? t('enterTheExactConfirmationShown') : '',
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
      if (!response.ok) throw new Error(body && typeof body.error === 'string' ? body.error : t('theRecoveryOutcomeCouldNotBeSaved'));
      if (response.redirected || !isStatus(body) || body.postId !== postId) throw new Error(t('theOutcomeMayHaveBeenSavedBut'));
      const confirmed = mode.kind === 'record' ? body.operations.some(operation => operation.id === mode.operation.id && operation.state === (outcome === 'PUBLISHED' ? 'receipt_recorded' : 'attested_absent') && (mode.operation.state !== 'submitted' || operation.remotePostId === mode.operation.remotePostId)) : mode.kind === 'finish' ? body.operations.some(operation => operation.id === mode.operation.id && operation.state === 'projected') : body.operations.some(operation => operation.postTargetId === mode.target.id && operation.state === 'uncertain');
      if (!confirmed) throw new Error(t('theResponseDidNotConfirmThisOperation'));
      setNotice(mode.kind === 'finish' ? t('localPublicationRecordUpdatedNoNewPublication') : mode.kind === 'adopt' ? t('olderDestinationAdoptedForOutcomeReview') : mode.operation.state === 'submitted' ? t('humanverifiedReceiptSavedFinishTheLocalRecord') : outcome === 'PUBLISHED' ? t('humanverifiedReceiptSavedFinishTheLocalRecord2') : t('humanverifiedAbsenceRecordedNoPublicationWasSent'));
      setStatus(body); setMode(null);
      if (mode.kind === 'finish' || mode.kind === 'record' && outcome === 'ABSENT') {
        const destination = new URL(window.location.href);
        destination.searchParams.set('notice', mode.kind === 'finish' ? 'publication-finished' : 'publication-absent');
        destination.searchParams.set('recovery', mode.operation.id);
        router.replace(destination.pathname + destination.search, { scroll: false });
      } else router.refresh();
    } catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : t('theRecoveryOutcomeCouldNotBeSaved')); }
    finally { inFlight.current = false; setPending(false); }
  }

  async function refreshFromDialog() {
    setLoadPending(true); setError('');
    try { setStatus(await readStatus(postId, t)); setMode(null); router.refresh(); }
    catch (cause) { setError(cause instanceof Error && !(cause instanceof TypeError) ? cause.message : t('publicationStatusCouldNotBeRefreshed')); }
    finally { setLoadPending(false); }
  }

  const unresolvedTargets = targets.filter(target => target.status === 'processing');
  if (!unresolvedTargets.length) return notice ? <p ref={noticeRef} tabIndex={-1} role="status">{notice}</p> : null;
  const confirmationField = validation.fieldProps('confirmation');
  const remoteIdField = validation.fieldProps('remotePostId');
  const remoteUrlField = validation.fieldProps('remoteUrl');
  return <section className={styles.help} aria-label={t('publicationRecovery')} tabIndex={-1}>
    {notice && <p ref={noticeRef} tabIndex={-1} role="status">{notice}</p>}
    <strong>{t('publicationResultNeedsReview')}</strong>
    <p>{t('aDestinationMayHaveAcceptedThisPost')}</p>
    <Button variant="secondary" size="sm" type="button" onClick={() => { setOpened(value => !value); if (status === null && !error) setLoadPending(true); }} aria-expanded={opened}>{opened ? t('hideRecovery') : t('reviewPublicationResult')}</Button>
    {opened ? <div className={styles.help}>
      {loadPending && !status ? <p role="status">{t('loadingPublicationHistory')}</p> : null}
      {error && !mode ? <><p role="alert" tabIndex={-1} ref={errorRef} className="ui-error">{error}</p><Button variant="secondary" size="sm" type="button" disabled={loadPending} onClick={() => void refresh()}>{loadPending ? t('checking') : t('refreshPublicationStatus')}</Button></> : null}
      {status ? <>
        <p><strong>{t('postContext')}</strong> {excerpt || t('noPostTextIsAvailable')}</p>
        {status.truncated ? <p role="status">{t('thisHistoryIsLimitedToRecentOperations')}</p> : null}
        {status.operations.map(operation => <article key={operation.id} className={styles.firstCommentRow}>
          <div><strong>{operation.targetName || t('destination')}</strong><p>{t('operation')} <code>{operation.id}</code> · {operation.state === 'submitted' ? t('submitted') : t(`publication_${operation.state}` as PublishingActionCopyKey)}</p>
            {operation.remotePostId ? <p>{t('remotePostID')} <code>{operation.remotePostId}</code></p> : null}
            {operation.remoteUrl ? <p><a href={operation.remoteUrl} target="_blank" rel="noreferrer">{t('openRecordedPublication')}</a></p> : null}
          </div>
          {['started', 'uncertain'].includes(operation.state) ? <Button variant="secondary" size="sm" type="button" disabled={pending} onClick={() => open({ kind: 'record', operation })}>{t('recordExternalCheck')}</Button> : operation.state === 'submitted' && operation.remotePostId ? <Button variant="secondary" size="sm" type="button" disabled={pending} onClick={() => open({ kind: 'record', operation })}>{t('verifySubmittedPublication')}</Button> : operation.state === 'receipt_recorded' ? <Button variant="primary" size="sm" type="button" disabled={pending} onClick={() => open({ kind: 'finish', operation })}>{t('finishLocalRecord')}</Button> : null}
        </article>)}
        {status.legacyProcessingCount > 0 ? <div><p>{status.legacyProcessingCount} {t('olderProcessingDestinationsHaveNoRecoveryOperation')}</p>{unresolvedTargets.filter(target => !status.operations.some(op => op.postTargetId === target.id)).map(target => <Button key={target.id} variant="secondary" size="sm" type="button" disabled={pending} onClick={() => open({ kind: 'adopt', target })}>{t('adopt')} {target.name || t('destination')} {t('forRecovery')}</Button>)}</div> : null}
      </> : null}
    </div> : null}
    {mode ? <ModalDialog className="ui-dialog" labelledBy="publication-recovery-title" onDismiss={() => { if (!pending) setMode(null); }} busy={pending} initialFocus={error ? '[data-publication-error]' : '[data-publication-cancel]'}>
      <form method="post" noValidate onSubmit={submit}>
        <div className="ui-dialog__header"><div><h2 id="publication-recovery-title">{mode.kind === 'record' ? t('recordTheDestinationCheck') : mode.kind === 'finish' ? t('finishTheLocalPublicationRecord') : t('adoptThisOlderDestination')}</h2><p>{mode.kind === 'record' ? t('externalCheck', { destination: mode.operation.targetName || t('thisDestination') }) : mode.kind === 'adopt' ? t('externalCheck', { destination: mode.target.name || t('thisDestination') }) : t('thisUpdatesLocalRecordsOnly')}</p></div></div>
        <div className="ui-dialog__body">
          <p><strong>{t('postContext')}</strong> {excerpt || t('noPostTextIsAvailable')}</p>
          {mode.kind === 'record' ? <>
            {mode.operation.state === 'submitted' ? <p>{t('checkThatThisExactSubmittedPostIs')}</p> : null}
            <fieldset className="ui-field" disabled={pending}><legend>{t('whatDidYouVerifyOnTheDestination')}</legend>
              {!(mode.operation.state === 'submitted' && mode.operation.remotePostId) ? <label><input type="radio" name="outcome" value="ABSENT" checked={outcome === 'ABSENT'} onChange={() => { setOutcome('ABSENT'); setConfirmation(''); }} /> {t('thePostIsAbsent')}</label> : null}
              <label><input type="radio" name="outcome" value="PUBLISHED" checked={outcome === 'PUBLISHED'} onChange={() => { setOutcome('PUBLISHED'); setConfirmation(''); }} /> {t('thePostIsPublished')}</label>
            </fieldset>
            {outcome === 'PUBLISHED' ? <><FieldError {...validation.errorProps('outcome')} /><label className="ui-field" htmlFor={remoteIdField.id}><span>{t('remotePostID2')}</span><input {...remoteIdField} className="ui-input" name="remotePostId" required value={remotePostId} onChange={event => { setRemotePostId(event.target.value); validation.clear('remotePostId'); }} disabled={pending} readOnly={Boolean(mode.operation.state === 'submitted' && mode.operation.remotePostId)} /></label><FieldError {...validation.errorProps('remotePostId')} /><label className="ui-field" htmlFor={remoteUrlField.id}><span>{t('publicPostLinkIfAvailable')}</span><input {...remoteUrlField} className="ui-input" name="remoteUrl" type="url" value={remoteUrl} onChange={event => { setRemoteUrl(event.target.value); validation.clear('remoteUrl'); }} disabled={pending} /></label><FieldError {...validation.errorProps('remoteUrl')} /></> : null}
          </> : null}
          {mode.kind === 'record' || mode.kind === 'adopt' ? <><label className="ui-field"><span><input type="checkbox" name="verifiedExternally" required checked={verified} disabled={pending} onChange={event => { setVerified(event.target.checked); validation.clear('verifiedExternally'); }} /> {t('iCheckedThisExactDestinationMyselfThis')}</span></label><FieldError {...validation.errorProps('verifiedExternally')} /></> : null}
          <p>{mode.kind === 'finish' ? t('thisOnlyProjectsASavedReceiptInto') : t('theAppWillNotContactThePlatform')}</p>
          <label className="ui-field" htmlFor={confirmationField.id}><span>{t('type')} <strong>{expected || t('chooseOutcome')}</strong> {t('toConfirm')}</span><input {...confirmationField} className="ui-input" name="confirmation" autoComplete="off" value={confirmation} onChange={event => { setConfirmation(event.target.value); validation.clear('confirmation'); }} disabled={pending || !expected} /></label><FieldError {...validation.errorProps('confirmation')} />
          {error ? <><p id="publication-recovery-error" data-publication-error ref={errorRef} tabIndex={-1} role="alert" className="ui-error">{error}</p><Button variant="secondary" size="sm" type="button" disabled={loadPending || pending} onClick={() => void refreshFromDialog()}>{loadPending ? t('checkingStatus') : t('refreshPublicationStatus')}</Button></> : null}
        </div>
        <div className="ui-dialog__actions"><Button type="button" data-publication-cancel disabled={pending} onClick={() => setMode(null)}>{t('cancel')}</Button><Button variant="primary" type="submit" aria-busy={pending} disabled={pending || !expected || confirmation !== expected || (mode.kind === 'record' && (!verified || !outcome || outcome === 'PUBLISHED' && !remotePostId.trim())) || (mode.kind === 'adopt' && !verified)}>{mode.kind === 'finish' ? t('finishLocalRecord') : mode.kind === 'adopt' ? t('adoptForRecovery') : t('recordCheckedOutcome')}</Button></div>
      </form>
    </ModalDialog> : null}
  </section>;
}
