'use client';
import { useInboxCatalog } from './copy-context';
import { AutoTextarea } from '@/components/AutoTextarea';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, InfoTip, Menu } from '@/components';
import { useToast } from '@/components/Toast';
import { FieldError, useFormValidation } from '@/components/FormValidation';
import { isOperationErrorCode } from '@/lib/operation-error';
import styles from './inbox.module.css';
import { actionCopy } from './action-copy';
import type { InboxLocale } from './copy';

type Kind = 'message' | 'comment' | 'review';
type Outcome = { ok: true; body: Record<string, number | string | boolean> } | { ok: false; error: string };
type DeleteState = 'started' | 'uncertain' | 'remote_confirmed' | 'completed' | 'rejected';
type DeleteReceipt = { ok: true; operationId: string; itemId: string; state: DeleteState; remoteConfirmed: boolean; localConfirmed: boolean };
type DeleteStatus = { kind: 'loading' | 'none' | 'error' } | { kind: 'operation'; receipt: DeleteReceipt };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const deleteStates = new Set<DeleteState>(['started', 'uncertain', 'remote_confirmed', 'completed', 'rejected']);

function deleteReceipt(value: unknown, itemId: string, operationId?: string): DeleteReceipt | null {
  if (!isRecord(value) || value.ok !== true || (operationId ? value.operationId !== operationId : value.itemId !== itemId) || typeof value.operationId !== 'string' || !value.operationId ||
      typeof value.state !== 'string' || !deleteStates.has(value.state as DeleteState) ||
      typeof value.remoteConfirmed !== 'boolean' || typeof value.localConfirmed !== 'boolean') return null;
  return value as DeleteReceipt;
}

async function readDeleteStatus(itemId: string, errorText: string): Promise<DeleteReceipt | null> {
  const response = await fetch(`/api/inbox/deletions?itemId=${encodeURIComponent(itemId)}`, { cache: 'no-store' });
  const body: unknown = await response.json();
  if (!response.ok || !isRecord(body) || !('operation' in body)) throw new Error(errorText);
  if (body.operation === null) return null;
  const receipt = deleteReceipt(body.operation, itemId);
  if (!receipt) throw new Error(errorText);
  return receipt;
}

function completeDeletion(receipt: DeleteReceipt) {
  return receipt.state === 'completed' && receipt.remoteConfirmed && receipt.localConfirmed;
}

async function send(payload: Record<string, unknown>, locale: InboxLocale = 'en', uncertainOutcome = actionCopy[locale].uncertain): Promise<Outcome> {
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

/** "Last synced" plus Sync now, reporting what the sync found. */
export function InboxSyncBar({ targetId, lastSynced, timeZone, disabled = false, locale = 'en' }: { targetId?: string; lastSynced: string | null; timeZone: string; disabled?: boolean; locale?: InboxLocale }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [syncedNow, setSyncedNow] = useState<string | null>(null);
  const router = useRouter();
  const copy = useInboxCatalog('actionCopy')[locale];

  async function sync() {
    setBusy(true); setResult(null);
    const outcome = await send({ action: 'sync', ...(targetId ? { targetId } : {}) }, locale, copy.uncertain);
    setBusy(false);
    if (!outcome.ok) { setResult({ kind: 'error', text: outcome.error }); return; }
    const fields = ['conversationCount', 'messageCount', 'commentCount', 'targetCount', 'failedCount'] as const;
    const countsValid = fields.every(key => Number.isSafeInteger(outcome.body[key]) && (outcome.body[key] as number) >= 0);
    const syncedAt = outcome.body.syncedAt;
    const dateValid = typeof syncedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(syncedAt) && Number.isFinite(Date.parse(syncedAt)) && new Date(syncedAt).toISOString() === syncedAt;
    if (!countsValid || !dateValid) { setResult({ kind: 'error', text: copy.uncertain }); return; }
    const { conversationCount, messageCount, commentCount, targetCount, failedCount } = outcome.body as Record<typeof fields[number], number>;
    // Present only when the channel's module reads reviews.
    const reviewCount = outcome.body.reviewCount;
    const reviews = typeof reviewCount === 'number' && Number.isSafeInteger(reviewCount) && reviewCount >= 0 ? reviewCount : null;
    setResult({ kind: failedCount ? 'error' : 'ok', text: copy.synced({ targets: Number(targetCount), conversations: Number(conversationCount), messages: Number(messageCount), comments: Number(commentCount), reviews, failed: failedCount }) });
    setSyncedNow(new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(syncedAt)));
    router.refresh();
  }

  const shown = syncedNow ?? lastSynced;
  return <div className={styles.sync}>
    <Button variant="secondary" disabled={disabled || busy} aria-busy={busy} onClick={() => void sync()}>{busy ? copy.syncing : copy.syncNow}</Button>
    <InfoTip name={copy.lastSynced}>{shown ? <>{copy.lastSynced} <strong>{shown}</strong></> : copy.notSynced}</InfoTip>
    <div role="status" aria-live="polite" className="ui-visually-hidden">{result?.kind === 'ok' ? <span>{result.text}</span> : null}</div>
    {result?.kind === 'error' ? <p role="alert" className={styles.error}>{result.text}</p> : null}
  </div>;
}

/** Resolve or reopen, hide or unhide, and delete, for the open thread. */
export function ThreadToolbar({ id, kind, resolved, hidden, canResolve, canHide, canDelete, platformName, listHref, reply = false, locale = 'en' }: { reply?: boolean; id: string; kind: Kind; resolved: boolean; hidden: boolean; canResolve: boolean; canHide: boolean; canDelete: boolean; platformName: string; listHref: string; locale?: InboxLocale }) {
  const [busy, setBusy] = useState<'resolve' | 'hide' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [deleteStatus, setDeleteStatus] = useState<DeleteStatus>({ kind: 'loading' });
  const router = useRouter();
  const toast = useToast();
  const copy = useInboxCatalog('actionCopy')[locale];
  // A deleted reply leaves the thread open; a deleted opening comment returns to the list.
  const leave = () => { if (reply) router.refresh(); else router.replace(listHref); };
  const noun = copy.noun(reply);

  async function run(kindOfAction: 'resolve' | 'hide' | 'delete', payload: Record<string, unknown>, message: string, undo?: Record<string, unknown>, undoMessage?: string) {
    setBusy(kindOfAction); setError(''); setDone('');
    const outcome = await send(payload, locale, copy.uncertain);
    setBusy(null);
    if (!outcome.ok) {
      if (kindOfAction === 'delete') setDeleteStatus({ kind: 'error' });
      setError(outcome.error);
      // A failed resolve or hide is safe to attempt again; deletion keeps its own status dialog.
      if (kindOfAction !== 'delete') toast.failed(copy.failedTitle, () => { void run(kindOfAction, payload, message, undo, undoMessage); }, copy.retry, outcome.error);
      return false;
    }
    if (kindOfAction === 'delete') {
      const receipt = deleteReceipt(outcome.body, id);
      if (!receipt) { setError(copy.uncertain); setDeleteStatus({ kind: 'error' }); return false; }
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
    // Resolve and hide are reversible, so they offer Undo instead of asking first.
    if (undo) toast.undoable(message, () => { void send(undo, locale, copy.uncertain).then(result => { if (result.ok) { setDone(undoMessage ?? ''); router.refresh(); } else toast.notify({ tone: 'error', title: result.error }); }); }, copy.undo);
    router.refresh();
    return true;
  }

  async function checkDeletionStatus() {
    setBusy('delete'); setError('');
    try {
      const receipt = await readDeleteStatus(id, copy.statusError);
      if (receipt && completeDeletion(receipt)) {
        setDeleteStatus({ kind: 'operation', receipt });
        setDone(copy.deletedDone);
        setConfirming(false);
        leave();
      } else {
        setDeleteStatus(receipt ? { kind: 'operation', receipt } : { kind: 'none' });
      }
    } catch {
      setDeleteStatus({ kind: 'error' });
      setError(copy.statusError);
    } finally { setBusy(null); }
  }

  async function finishDeletion() {
    if (deleteStatus.kind !== 'operation' || deleteStatus.receipt.state !== 'remote_confirmed') return;
    setBusy('delete'); setError('');
    const outcome = await send({ action: 'finish_delete', operationId: deleteStatus.receipt.operationId, confirmation: `FINISH DELETION ${deleteStatus.receipt.operationId}` }, locale, copy.uncertain);
    setBusy(null);
    if (!outcome.ok) { setError(outcome.error); return; }
    const receipt = deleteReceipt(outcome.body, id, deleteStatus.receipt.operationId);
    if (!receipt || !completeDeletion(receipt)) {
      if (receipt) setDeleteStatus({ kind: 'operation', receipt });
      setError(copy.uncertain);
      return;
    }
    setDeleteStatus({ kind: 'operation', receipt });
    setDone(copy.deletedDone); setConfirming(false); leave();
  }

  async function openDeleteDialog() {
    setError(''); setDeleteStatus({ kind: 'loading' }); setConfirming(true);
    try {
      const receipt = await readDeleteStatus(id, copy.statusError);
      if (receipt && completeDeletion(receipt)) {
        setDeleteStatus({ kind: 'operation', receipt });
        setDone(copy.deletedDone); setConfirming(false); leave();
      } else {
        setDeleteStatus(receipt ? { kind: 'operation', receipt } : { kind: 'none' });
      }
    } catch {
      setDeleteStatus({ kind: 'error' });
      setError(copy.statusError);
    }
  }

  const deleteBusy = busy === 'delete';
  const operation = deleteStatus.kind === 'operation' ? deleteStatus.receipt : null;
  const canStartDelete = deleteStatus.kind === 'none';
  const canFinishDelete = operation?.state === 'remote_confirmed' && operation.remoteConfirmed && !operation.localConfirmed;
  const cap = copy.cap(reply);

  if (!canResolve) return <p className={styles.readOnly}>{copy.readOnly}</p>;
  return <div className={styles.toolbar}>
    <div className={styles.toolbarButtons}>
      {!reply && <Button size="sm" variant="secondary" data-inbox-resolve disabled={busy !== null} onClick={() => void run('resolve', { action: 'resolve', id, kind, resolved: !resolved }, resolved ? copy.reopened : copy.resolvedDone, { action: 'resolve', id, kind, resolved }, resolved ? copy.resolvedDone : copy.reopened)}>{resolved ? copy.reopen : copy.markResolved}</Button>}
      {kind === 'comment' && canHide && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run('hide', { action: 'moderate', id, hidden: !hidden }, hidden ? copy.visibleDone(cap) : copy.hiddenDone(cap), { action: 'moderate', id, hidden }, hidden ? copy.hiddenDone(cap) : copy.visibleDone(cap))}>{hidden ? copy.unhide(noun) : copy.hide(noun)}</Button>}
      {kind === 'comment' && canDelete && <Button size="sm" variant="quiet" disabled={busy !== null} onClick={() => void openDeleteDialog()}>{copy.delete(noun)}</Button>}
    </div>
    <div role="status" aria-live="polite" className={styles.toolbarStatus}>{done}</div>
    {error && !confirming && <p role="alert" className={styles.error}>{error}</p>}
    <Dialog open={confirming} busy={deleteBusy} title={canStartDelete ? copy.deleteTitle(noun) : copy.statusTitle} description={canStartDelete ? copy.deleteBody(noun, platformName) : copy.statusBody} onClose={() => { if (!deleteBusy) { setConfirming(false); } }}
      actions={<><Button variant="secondary" data-dialog-cancel disabled={deleteBusy} onClick={() => setConfirming(false)}>{canStartDelete ? copy.keep(noun) : copy.close}</Button>
        {(operation || deleteStatus.kind === 'error') && <Button variant="secondary" disabled={deleteBusy} onClick={() => void checkDeletionStatus()}>{deleteBusy ? copy.checking : copy.checkStatus}</Button>}
        {canFinishDelete && <Button variant="danger" disabled={deleteBusy} onClick={() => void finishDeletion()}>{deleteBusy ? copy.finishing : copy.finish}</Button>}
        {canStartDelete && <Button variant="danger" disabled={deleteBusy} onClick={() => void run('delete', { action: 'delete', id, confirmation: `DELETE COMMENT ${id}` }, copy.deletedDone)}>{deleteBusy ? copy.deleting : copy.delete(noun)}</Button>}</>}>
      {deleteStatus.kind === 'loading' && <p className={styles.dialogNote} role="status">{copy.checkingInProgress}</p>}
      {canStartDelete && <p className={styles.dialogNote}>{copy.hideInstead(noun)}</p>}
      {operation?.state === 'started' || operation?.state === 'uncertain' ? <p className={styles.dialogNote} role="status">{copy.unconfirmedPlatform}</p> : null}
      {operation?.state === 'remote_confirmed' ? <p className={styles.dialogNote} role="status">{operation.remoteConfirmed ? copy.remoteConfirmed : copy.remoteUnconfirmed} {copy.finishNote}</p> : null}
      {operation?.state === 'rejected' ? <p className={styles.dialogNote} role="alert">{copy.rejected}</p> : null}
      {operation?.state === 'completed' && !completeDeletion(operation) ? <p className={styles.dialogNote} role="alert">{copy.notFullyConfirmed}</p> : null}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </Dialog>
  </div>;
}

type SavedReply = { id: string; name: string; body: string };
const isSavedReply = (value: unknown): value is SavedReply => typeof value === 'object' && value !== null && typeof (value as SavedReply).id === 'string' && typeof (value as SavedReply).name === 'string' && typeof (value as SavedReply).body === 'string';

/** Reply composer with a character count and the platform's reply rule in plain words. */
export function ReplyBox({ id, kind, allowed, headline, detail, maxLength = 2000, value, onChange, onInsertSavedReply, locale = 'en' }: { locale?: 'en' | 'fr'; id: string; kind: Kind; allowed: boolean; headline: string; detail?: string; maxLength?: number; value?: string; onChange?: (value: string) => void; onInsertSavedReply?: (body: string) => void }) {
  const validation = useFormValidation();
  const copy = useInboxCatalog('REPLY_COPY')[locale];
  const inFlight = useRef(false);
  const [localText, setLocalText] = useState('');
  const text = value ?? localText;
  const updateText = (next: string) => { if (value === undefined) setLocalText(next); onChange?.(next); };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  // Saved replies only fill the draft through the caller's insert handler; inserting never sends anything.
  const [savedReplies, setSavedReplies] = useState<SavedReply[] | 'error' | null>(null);
  // The fetch depends only on whether a handler exists, so typing in the draft never refetches the list.
  const wantsSaved = Boolean(onInsertSavedReply);
  useEffect(() => {
    if (!wantsSaved) return;
    let live = true;
    setSavedReplies(null);
    fetch('/api/inbox/productivity?view=saved-replies', { cache: 'no-store' })
      .then(async response => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok || !body || typeof body !== 'object') throw new Error('unavailable');
        const replies = (body as { replies?: unknown }).replies;
        if (!Array.isArray(replies) || !replies.every(isSavedReply)) throw new Error('unavailable');
        if (live) setSavedReplies(replies);
      })
      .catch(() => { if (live) setSavedReplies('error'); });
    return () => { live = false; };
  }, [wantsSaved]);
  const router = useRouter();
  const fieldId = useId();
  const ruleId = `${fieldId}-rule`;
  const countId = `${fieldId}-count`;
  const remaining = maxLength - text.length;
  const empty = text.trim().length === 0;
  const insert = onInsertSavedReply;
  const savedItems = savedReplies === null ? [{ key: 'loading', label: copy.savedRepliesLoading, disabled: true, onSelect: () => {} }]
    : savedReplies === 'error' ? [{ key: 'error', label: copy.savedRepliesError, disabled: true, onSelect: () => {} }]
    : savedReplies.length ? savedReplies.map(reply => ({ key: reply.id, label: reply.name, onSelect: () => insert?.(reply.body) }))
    : [{ key: 'empty', label: copy.savedRepliesEmpty, disabled: true, onSelect: () => {} }];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (empty || inFlight.current || busy || !allowed) return;
    if (!validation.validate(event.currentTarget)) return;
    inFlight.current = true;
    setBusy(true); setError(''); setSent('');
    const outcome = await send({ action: 'reply', id, kind, text }, locale, copy.unconfirmed);
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
      <div className={styles.replyActions}>
        {onInsertSavedReply ? <Menu label={copy.savedReplies} trigger={<>{copy.savedReplies}</>} items={savedItems} /> : null}
        <Button type="submit" variant="primary" disabled={!allowed || busy || empty} aria-busy={busy}>{busy ? copy.sending : copy.send}</Button>
      </div>
    </div>
    <div role="status" aria-live="polite" className={styles.replyStatus}>{sent}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </form>;
}
