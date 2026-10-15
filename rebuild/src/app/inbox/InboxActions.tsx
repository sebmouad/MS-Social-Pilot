'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog } from '@/components';
import styles from './inbox.module.css';

type Kind = 'message' | 'comment';
type Outcome = { ok: true; body: Record<string, number | string | boolean> } | { ok: false; error: string };

async function send(payload: Record<string, unknown>): Promise<Outcome> {
  try {
    const response = await fetch('/api/inbox/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: typeof body.error === 'string' ? body.error : 'The inbox action failed.' };
    return { ok: true, body };
  } catch {
    return { ok: false, error: 'The inbox action could not reach the server. Check your connection and try again.' };
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
    const { conversationCount = 0, messageCount = 0, commentCount = 0, targetCount = 0, failedCount = 0, syncedAt } = outcome.body as Record<string, number | string>;
    const failed = Number(failedCount);
    setResult({ kind: failed ? 'error' : 'ok', text: `Checked ${plural(Number(targetCount), 'channel')}: ${plural(Number(conversationCount), 'conversation')} (${plural(Number(messageCount), 'message')}) and ${plural(Number(commentCount), 'comment')} up to date.${failed ? ` ${plural(failed, 'channel')} could not be read. Reconnect it in Connections, then sync again.` : ''}` });
    if (typeof syncedAt === 'string') setSyncedNow(new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(syncedAt)));
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
export function ThreadToolbar({ id, kind, resolved, hidden, canResolve, canHide, canDelete, platformName, listHref }: { id: string; kind: Kind; resolved: boolean; hidden: boolean; canResolve: boolean; canHide: boolean; canDelete: boolean; platformName: string; listHref: string }) {
  const [busy, setBusy] = useState<'resolve' | 'hide' | 'delete' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const router = useRouter();

  async function run(kindOfAction: 'resolve' | 'hide' | 'delete', payload: Record<string, unknown>, message: string) {
    setBusy(kindOfAction); setError(''); setDone('');
    const outcome = await send(payload);
    setBusy(null);
    if (!outcome.ok) { setError(outcome.error); return false; }
    setDone(message);
    if (kindOfAction === 'delete') router.replace(listHref); else router.refresh();
    return true;
  }

  if (!canResolve) return <p className={styles.readOnly}>You can read this conversation but not change it.</p>;
  return <div className={styles.toolbar}>
    <div className={styles.toolbarButtons}>
      <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run('resolve', { action: 'resolve', id, kind, resolved: !resolved }, resolved ? 'Reopened.' : 'Marked as resolved.')}>{resolved ? 'Reopen' : 'Mark resolved'}</Button>
      {kind === 'comment' && canHide && <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run('hide', { action: 'moderate', id, hidden: !hidden }, hidden ? 'Comment is visible again.' : 'Comment hidden.')}>{hidden ? 'Unhide comment' : 'Hide comment'}</Button>}
      {kind === 'comment' && canDelete && <Button size="sm" variant="quiet" disabled={busy !== null} onClick={() => setConfirming(true)}>Delete comment</Button>}
    </div>
    <div role="status" aria-live="polite" className={styles.toolbarStatus}>{done}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <Dialog open={confirming} title="Delete this comment?" description={`This removes the comment, and any replies under it, from ${platformName} and from your inbox. This cannot be undone.`} onClose={() => { if (busy !== 'delete') { setConfirming(false); } }}
      actions={<><Button variant="secondary" data-dialog-cancel disabled={busy === 'delete'} onClick={() => setConfirming(false)}>Keep comment</Button><Button variant="danger" disabled={busy === 'delete'} onClick={() => void run('delete', { action: 'delete', id }, 'Comment deleted.').then(success => { if (!success) setConfirming(false); })}>{busy === 'delete' ? 'Deleting…' : 'Delete comment'}</Button></>}>
      <p className={styles.dialogNote}>Hiding the comment instead keeps it in your inbox and can be undone.</p>
    </Dialog>
  </div>;
}

/** Reply composer with a character count and the platform's reply rule in plain words. */
export function ReplyBox({ id, kind, allowed, headline, detail, maxLength = 2000 }: { id: string; kind: Kind; allowed: boolean; headline: string; detail?: string; maxLength?: number }) {
  const [text, setText] = useState('');
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
    if (empty || busy || !allowed) return;
    setBusy(true); setError(''); setSent('');
    const outcome = await send({ action: 'reply', id, kind, text });
    setBusy(false);
    if (!outcome.ok) { setError(outcome.error); return; }
    setText(''); setSent('Reply sent.');
    router.refresh();
  }

  return <form method="post" className={styles.reply} onSubmit={event => void submit(event)}>
    <p id={ruleId} className={allowed ? styles.ruleOpen : styles.ruleClosed}><span aria-hidden="true">{allowed ? '●' : '■'}</span> <strong>{headline}</strong>{detail ? <span className={styles.ruleDetail}> {detail}</span> : null}</p>
    <label htmlFor={fieldId} className="ui-visually-hidden">Reply</label>
    <textarea id={fieldId} name="reply" rows={3} maxLength={maxLength} value={text} disabled={!allowed || busy} aria-describedby={`${ruleId} ${countId}`} aria-invalid={Boolean(error) || undefined}
      placeholder={allowed ? (kind === 'message' ? 'Write a reply…' : 'Write a public reply…') : 'Replies are not possible right now.'} onChange={event => { setText(event.target.value); setSent(''); }} />
    <div className={styles.replyFoot}>
      <span id={countId} className={remaining < 100 ? styles.countLow : styles.count}>{text.length.toLocaleString('en-US')} / {maxLength.toLocaleString('en-US')} characters{remaining < 100 ? ` · ${remaining} left` : ''}</span>
      <Button type="submit" variant="primary" disabled={!allowed || busy || empty} aria-busy={busy}>{busy ? 'Sending…' : 'Send reply'}</Button>
    </div>
    <div role="status" aria-live="polite" className={styles.replyStatus}>{sent}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </form>;
}
