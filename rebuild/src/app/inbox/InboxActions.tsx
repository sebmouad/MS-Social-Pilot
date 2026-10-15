'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

type Kind = 'message' | 'comment';
type ReplyWindowState = 'open' | 'closed' | 'no_recipient';

export function InboxActions({ id, kind, resolved, hidden = false, canWrite, replyWindow, replyUntil, replyWindowHours }: { id: string; kind: Kind; resolved: boolean; hidden?: boolean; canWrite: boolean; replyWindow?: ReplyWindowState; replyUntil?: string; replyWindowHours: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  if (!canWrite) return <small className="inbox-read-only">Read only</small>;

  async function send(payload: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/inbox/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'The inbox action failed.');
      router.refresh();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The inbox action failed.'); return false; }
    finally { setBusy(false); }
  }

  function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = new FormData(form).get('reply');
    if (typeof text !== 'string') return;
    void send({ action: 'reply', id, kind, text }).then(success => { if (success) form.reset(); });
  }

  return <div className="inbox-actions">
    {kind === 'message' && replyWindow && <small className={replyWindow === 'open' ? 'inbox-window-open' : 'inbox-window-closed'} role="status">{replyWindow === 'open' ? `Standard reply window open until ${replyUntil}, based on the latest stored visitor message.` : replyWindow === 'closed' ? `Standard reply window closed ${replyWindowHours} hours after the latest stored visitor message.` : 'No visitor message is stored, so this conversation cannot be replied to from Inbox.'}</small>}
    <form onSubmit={reply}><label><span className="sr-only">Reply</span><textarea name="reply" required maxLength={2000} rows={2} disabled={kind === 'message' && replyWindow !== 'open'} placeholder={kind === 'message' ? 'Write a message reply…' : 'Write a comment reply…'} /></label><button disabled={busy || (kind === 'message' && replyWindow !== 'open')} type="submit">Reply</button></form>
    <div className="inbox-action-buttons">
      <button type="button" disabled={busy} onClick={() => void send({ action: 'resolve', id, kind, resolved: !resolved })}>{resolved ? 'Reopen' : 'Resolve'}</button>
      {kind === 'comment' && <button type="button" disabled={busy} onClick={() => void send({ action: 'moderate', id, hidden: !hidden })}>{hidden ? 'Unhide' : 'Hide comment'}</button>}
    </div>
    {error && <p role="alert" className="inbox-error">{error}</p>}
  </div>;
}

export function InboxSyncButton({ targetId, disabled }: { targetId?: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();
  async function sync() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/inbox/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'sync', ...(targetId ? { targetId } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Inbox sync failed.');
      setMessage(`Synced ${result.conversationCount} conversations and ${result.commentCount} comments.`);
      router.refresh();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Inbox sync failed.'); }
    finally { setBusy(false); }
  }
  return <div className="inbox-sync-control"><button className="button button-secondary" disabled={disabled || busy} onClick={() => void sync()} type="button">{busy ? 'Syncing…' : 'Sync now'}</button>{message && <span role="status">{message}</span>}</div>;
}
