'use client';
import { AutoTextarea } from '@/components/AutoTextarea';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog } from '@/components';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { isOperationErrorCode } from '@/lib/operation-error';
import styles from './inbox.module.css';
import { REPLY_COPY } from './reply-copy';

type Kind = 'message' | 'comment' | 'review';
type Outcome = { ok: true; body: Record<string, number | string | boolean> } | { ok: false; error: string };
type DeleteState = 'started' | 'uncertain' | 'remote_confirmed' | 'completed' | 'rejected';
type DeleteReceipt = { ok: true; operationId: string; itemId: string; state: DeleteState; remoteConfirmed: boolean; localConfirmed: boolean };
type DeleteStatus = { kind: 'loading' | 'none' | 'error' } | { kind: 'operation'; receipt: DeleteReceipt };

const uncertainOutcome = 'The outcome is unconfirmed. Check the current Inbox and platform state before repeating this action.';
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const deleteStates = new Set<DeleteState>(['started', 'uncertain', 'remote_confirmed', 'completed', 'rejected']);

function deleteReceipt(value: unknown, itemId: string, operationId?: string): DeleteReceipt | null {
  if (!isRecord(value) || value.ok !== true || (operationId ? value.operationId !== operationId : value.itemId !== itemId) || typeof value.operationId !== 'string' || !value.operationId ||
      typeof value.state !== 'string' || !deleteStates.has(value.state as DeleteState) ||
      typeof value.remoteConfirmed !== 'boolean' || typeof value.localConfirmed !== 'boolean') return null;
  return value as DeleteReceipt;
}

async function readDeleteStatus(itemId: string): Promise<DeleteReceipt | null> {
  const response = await fetch(`/api/inbox/deletions?itemId=${encodeURIComponent(itemId)}`, { cache: 'no-store' });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || !('operation' in body)) throw new Error('Could not check deletion status.');
  if (body.operation === null) return null;
  const receipt = deleteReceipt(body.operation, itemId);
  if (!receipt) throw new Error('Could not check deletion status.');
  return receipt;
}

function completeDeletion(receipt: DeleteReceipt) {
  return receipt.state === 'completed' && receipt.remoteConfirmed && receipt.localConfirmed;
}

async function send(payload: Record<string, unknown>): Promise<Outcome> {
  try {
    const response = await fetch('/api/inbox/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    let body: unknown;
    try { body = await response.json(); } catch { return { ok: false, error: uncertainOutcome }; }
    if (!response.ok) {
      if (isRecord(body) && typeof body.error === 'string' && isOperationErrorCode(body.code)) return { ok: false, error: body.error };
      return { ok: false, error: uncertainOutcome };
    }
    if (!isRecord(body) || body.ok !== true) return { ok: false, error: uncertainOutcome };
    return { ok: true, body: body as Record<string, number | string | boolean> };
  } catch {
    return { ok: false, error: uncertainOutcome };
  }
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** "Last synced" plus Sync now, reporting what the sync found. */
export function InboxSyncBar({ targetId, lastSynced, timeZone, disabled = false }: { targetId?: string; lastSynced: string | null; timeZone: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [syncedNow, setSyncedNow] = useState<string | null>(null);
  const router = useRouter();

  async function sync() {
    setBusy(true); setResult(null);
    const outcome = await send({ action: 'sync', ...(targetId ? { targetId } : {}) });
    setBusy(false);
    if (!outcome.ok) { setResult({ kind: 'error', text: outcome.error }); return; }
    const fields = ['conversationCount', 'messageCount', 'commentCount', 'targetCount', 'failedCount'] as const;
    const countsValid = fields.every(key => Number.isSafeInteger(outcome.body[key]) && (outcome.body[key] as number) >= 0);
    const syncedAt = outcome.body.syncedAt;
    const dateValid = typeof syncedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(syncedAt) && Number.isFinite(Date.parse(syncedAt)) && new Date(syncedAt).toISOString() === syncedAt;
    if (!countsValid || !dateValid) { setResult({ kind: 'error', text: uncertainOutcome }); return; }
    const { conversationCount, messageCount, commentCount, targetCount, failedCount } = outcome.body as Record<typeof fields[number], number>;
    const failed = failedCount;
    // Present only when the channel's module reads reviews.
    const reviewCount = outcome.body.reviewCount;
    const reviewNote = typeof reviewCount === 'number' && Number.isSafeInteger(reviewCount) && reviewCount >= 0 ? ` ${plural(reviewCount, 'review')} up to date.` : '';
    setResult({ kind: failed ? 'error' : 'ok', text: `Checked ${plural(Number(targetCount), 'channel')}: ${plural(Number(conversationCount), 'conversation')} (${plural(Number(messageCount), 'message')}) and ${plural(Number(commentCount), 'comment')} up to date.${reviewNote}${failed ? ` ${plural(failed, 'channel')} could not be read. Reconnect it in Connections, then sync again.` : ''}` });
    setSyncedNow(new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(syncedAt)));
    router.refresh();
  }

  const shown = syncedNow ?? lastSynced;
  return <div className={styles.sync}>
    <p className={styles.syncTime}>{shown ? <>Last synced <strong>{shown}</strong></> : 'Not synced yet'}</p>
    <Button variant="secondary" disabled={disabled || busy} aria-busy={busy} onClick={() => void sync()}>{busy ? 'Syncing…' : 'Sync now'}</Button>
    <div role="status" aria-live="polite" className={styles.syncResult}>{result?.kind === 'ok' ? <span>{result.text}</span> : null}</div>
    {result?.kind === 'error' ? <p role="alert" className={styles.error}>{result.text}</p> : null}
  </div>;
}

/** Resolve or reopen, hide or unhide, and delete, for the open thread. */
export function ThreadToolbar({ id, kind, resolved, hidden, canResolve, canHide, canDelete, platformName, listHref, reply = false }: { reply?: boolean; id: string; kind: Kind; resolved: boolean; hidden: boolean; canResolve: boolean; canHide: boolean; canDelete: boolean; platformName: string; listHref: string }) {
  const [busy, setBusy] = useState<'resolve' | 'hide' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [deleteStatus, setDeleteStatus] = useState<DeleteStatus>({ kind: 'loading' });
  const router = useRouter();
  // A deleted reply leaves the thread open; a deleted opening comment returns to the list.
  const leave = () => { if (reply) router.refresh(); else router.replace(listHref); };
  const noun = reply ? 'reply' : 'comment';

  async function run(kindOfAction: 'resolve' | 'hide' | 'delete', payload: Record<string, unknown>, message: string) {
    setBusy(kindOfAction); setError(''); setDone('');
    const outcome = await send(payload);
    setBusy(null);
    if (!outcome.ok) { if (kindOfAction === 'delete') setDeleteStatus({ kind: 'error' }); setError(outcome.error); return false; }
    if (kindOfAction === 'delete') {
      const receipt = deleteReceipt(outcome.body, id);
      if (!receipt) { setError(uncertainOutcome); setDeleteStatus({ kind: 'error' }); return false; }
      if (completeDeletion(receipt)) {
        setDone(message);
        setConfirming(false);
        leave();
        return true;
      }
      setDeleteStatus({ kind: 'operation', receipt });
      setError('');
      return false;
    }
    setDone(message);
    router.refresh();
    return true;
  }

  async function checkDeletionStatus() {
    setBusy('delete'); setError('');
    try {
      const receipt = await readDeleteStatus(id);
      if (receipt && completeDeletion(receipt)) {
        setDeleteStatus({ kind: 'operation', receipt });
        setDone('Comment deleted.');
        setConfirming(false);
        leave();
      } else {
        setDeleteStatus(receipt ? { kind: 'operation', receipt } : { kind: 'none' });
      }
    } catch {
      setDeleteStatus({ kind: 'error' });
      setError('Could not check deletion status. Keep this dialog open and check again.');
    } finally { setBusy(null); }
  }

  async function finishDeletion() {
    if (deleteStatus.kind !== 'operation' || deleteStatus.receipt.state !== 'remote_confirmed') return;
    setBusy('delete'); setError('');
    const outcome = await send({ action: 'finish_delete', operationId: deleteStatus.receipt.operationId, confirmation: `FINISH DELETION ${deleteStatus.receipt.operationId}` });
    setBusy(null);
    if (!outcome.ok) { setError(outcome.error); return; }
    const receipt = deleteReceipt(outcome.body, id, deleteStatus.receipt.operationId);
    if (!receipt || !completeDeletion(receipt)) {
      if (receipt) setDeleteStatus({ kind: 'operation', receipt });
      setError(uncertainOutcome);
      return;
    }
    setDeleteStatus({ kind: 'operation', receipt });
    setDone('Comment deleted.'); setConfirming(false); leave();
  }

  async function openDeleteDialog() {
    setError(''); setDeleteStatus({ kind: 'loading' }); setConfirming(true);
    try {
      const receipt = await readDeleteStatus(id);
      if (receipt && completeDeletion(receipt)) {
        setDeleteStatus({ kind: 'operation', receipt });
        setDone('Comment deleted.'); setConfirming(false); leave();
      } else {
        setDeleteStatus(receipt ? { kind: 'operation', receipt } : { kind: 'none' });
      }
    } catch {
      setDeleteStatus({ kind: 'error' });
      setError('Could not check deletion status. Keep this dialog open and check again.');
    }
  }

  const deleteBusy = busy === 'delete';
  const operation = deleteStatus.kind === 'operation' ? deleteStatus.receipt : null;
  const canStartDelete = deleteStatus.kind === 'none';
  const canFinishDelete = operation?.state === 'remote_confirmed' && operation.remoteConfirmed && !operation.localConfirmed;

  if (!canResolve) return <p className={styles.readOnly}>You can read this conversation but not change it.</p>;
  return <div className={styles.toolbar}>
    <div className={styles.toolbarButtons}>
      {!reply && <Button size="sm" variant="secondary" data-inbox-resolve disabled={busy !== null} onClick={() => void run('resolve', { action: 'resolve', id, kind, resolved: !resolved }, resolved ? 'Reopened.' : 'Marked as resolved.')}>{resolved ? 'Reopen' : 'Mark resolved'}</Button>}
      {kind === 'comment' && canHide && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run('hide', { action: 'moderate', id, hidden: !hidden }, hidden ? `${reply ? 'Reply' : 'Comment'} is visible again.` : `${reply ? 'Reply' : 'Comment'} hidden.`)}>{hidden ? `Unhide ${noun}` : `Hide ${noun}`}</Button>}
      {kind === 'comment' && canDelete && <Button size="sm" variant="quiet" disabled={busy !== null} onClick={() => void openDeleteDialog()}>Delete {noun}</Button>}
    </div>
    <div role="status" aria-live="polite" className={styles.toolbarStatus}>{done}</div>
    {error && !confirming && <p role="alert" className={styles.error}>{error}</p>}
    <Dialog open={confirming} busy={deleteBusy} title={canStartDelete ? `Delete this ${noun}?` : "Comment deletion status"} description={canStartDelete ? `This removes the ${noun}, and any replies under it, from ${platformName} and from your inbox. This cannot be undone.` : "Check the current deletion outcome. Closing this dialog does not undo an existing deletion request."} onClose={() => { if (!deleteBusy) { setConfirming(false); } }}
      actions={<><Button variant="secondary" data-dialog-cancel disabled={deleteBusy} onClick={() => setConfirming(false)}>{canStartDelete ? `Keep ${noun}` : 'Close'}</Button>
        {(operation || deleteStatus.kind === 'error') && <Button variant="secondary" disabled={deleteBusy} onClick={() => void checkDeletionStatus()}>{deleteBusy ? 'Checking…' : 'Check deletion status'}</Button>}
        {canFinishDelete && <Button variant="danger" disabled={deleteBusy} onClick={() => void finishDeletion()}>{deleteBusy ? 'Finishing…' : 'Finish removal from Inbox'}</Button>}
        {canStartDelete && <Button variant="danger" disabled={deleteBusy} onClick={() => void run('delete', { action: 'delete', id, confirmation: `DELETE COMMENT ${id}` }, 'Comment deleted.')}>{deleteBusy ? 'Deleting…' : `Delete ${noun}`}</Button>}</>}>
      {deleteStatus.kind === 'loading' && <p className={styles.dialogNote} role="status">Checking whether a deletion is already in progress…</p>}
      {canStartDelete && <p className={styles.dialogNote}>Hiding the {noun} instead keeps it in your inbox and can be undone.</p>}
      {operation?.state === 'started' || operation?.state === 'uncertain' ? <p className={styles.dialogNote} role="status">The platform outcome is unconfirmed. Check deletion status before taking another action.</p> : null}
      {operation?.state === 'remote_confirmed' ? <p className={styles.dialogNote} role="status">{operation.remoteConfirmed ? 'The platform confirmed deletion.' : 'The platform outcome is unconfirmed.'} Finish removal from Inbox only completes the local cleanup.</p> : null}
      {operation?.state === 'rejected' ? <p className={styles.dialogNote} role="alert">The platform rejected this deletion. Contact your administrator before trying again.</p> : null}
      {operation?.state === 'completed' && !completeDeletion(operation) ? <p className={styles.dialogNote} role="alert">Deletion is not fully confirmed. Check status or contact your administrator.</p> : null}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </Dialog>
  </div>;
}

/** Reply composer with a character count and the platform's reply rule in plain words. */
export function ReplyBox({ id, kind, allowed, headline, detail, maxLength = 2000, value, onChange, locale = 'en' }: { locale?: 'en' | 'fr'; id: string; kind: Kind; allowed: boolean; headline: string; detail?: string; maxLength?: number; value?: string; onChange?: (value: string) => void }) {
  const validation = useFormValidation();
  const copy = REPLY_COPY[locale];
  const inFlight = useRef(false);
  const [localText, setLocalText] = useState('');
  const text = value ?? localText;
  const updateText = (next: string) => { if (value === undefined) setLocalText(next); onChange?.(next); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  const router = useRouter();
  const fieldId = useId();
  const ruleId = `${fieldId}-rule`;
  const countId = `${fieldId}-count`;
  const remaining = maxLength - text.length;
  const empty = text.trim().length === 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (empty || inFlight.current || busy || !allowed) return;
    if (!validation.validate(event.currentTarget)) return;
    inFlight.current = true;
    setBusy(true); setError(''); setSent('');
    const outcome = await send({ action: 'reply', id, kind, text });
    inFlight.current = false; setBusy(false);
    if (!outcome.ok) { setError(locale === 'fr' ? copy.unconfirmed : outcome.error); return; }
    updateText(''); setSent(copy.sent);
    router.refresh();
  }

  return <form method="post" noValidate className={styles.reply} onSubmit={event => void submit(event)}>
    <p id={ruleId} className={allowed ? styles.ruleOpen : styles.ruleClosed}><span aria-hidden="true">{allowed ? '●' : '■'}</span> <strong>{headline}</strong>{detail ? <span className={styles.ruleDetail}> {detail}</span> : null}</p>
    <label htmlFor={fieldId} className="ui-visually-hidden">{copy.reply}</label>
    <AutoTextarea id={fieldId} name="reply" data-inbox-reply rows={3} maxLength={maxLength} value={text} disabled={!allowed || busy} aria-describedby={[ruleId, countId, validation.fieldProps('reply')['aria-describedby']].filter(Boolean).join(' ')} aria-invalid={Boolean(error) || Boolean(validation.errors.reply) || undefined}
      placeholder={allowed ? (kind === 'message' ? copy.privatePlaceholder : copy.publicPlaceholder) : copy.unavailable} onChange={event => { updateText(event.target.value); setSent(''); }} />
    <FieldError {...validation.errorProps('reply')} />
    <div className={styles.replyFoot}>
      <span id={countId} className={remaining < 100 ? styles.countLow : styles.count}>{text.length.toLocaleString(locale)} / {maxLength.toLocaleString(locale)} {copy.characters}{remaining < 100 ? ` · ${remaining} ${copy.left}` : ''}</span>
      <Button type="submit" variant="primary" disabled={!allowed || busy || empty} aria-busy={busy}>{busy ? copy.sending : copy.send}</Button>
    </div>
    <div role="status" aria-live="polite" className={styles.replyStatus}>{sent}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </form>;
}
