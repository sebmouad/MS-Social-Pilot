'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import styles from './share.module.css';

type Decision = 'approved' | 'rejected' | 'comment';
export function ReviewActions({ token, postId, canDecide, allowComments, notice }: { token: string; postId: string; canDecide: boolean; allowComments: boolean; notice?: string }) {
  const [name, setName] = useState(''); const [comment, setComment] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState(''); const [failed, setFailed] = useState(false);
  const [settled, setSettled] = useState(false);
  const inFlight = useRef(false);
  async function send(decision: Decision) {
    if (inFlight.current) return;
    if (!name.trim()) { setFailed(true); setNote('Enter your name first.'); return; }
    if (decision !== 'approved' && !comment.trim()) { setFailed(true); setNote(decision === 'rejected' ? 'Tell the team what to change.' : 'Write a comment first.'); return; }
    inFlight.current = true; setBusy(true); setNote(''); setFailed(false);
    try {
      const response = await fetch(`/api/sharing/public/${encodeURIComponent(token)}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ postId, decision, authorName: name.trim(), ...(comment.trim() ? { comment: comment.trim() } : {}) }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.recorded !== true) throw new Error(typeof result.error === 'string' ? result.error : 'Your answer could not be confirmed. Try again.');
      setNote(String(result.message)); setComment(''); if (decision !== 'comment') setSettled(true);
    } catch (cause) { setFailed(true); setNote(cause instanceof Error ? cause.message : 'Your answer could not be confirmed. Try again.'); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <form className={styles.actions} onSubmit={event => event.preventDefault()}>
    <label>Your name<input value={name} onChange={event => setName(event.target.value)} maxLength={200} autoComplete="name" disabled={busy} /></label>
    <label>Comment<textarea value={comment} onChange={event => setComment(event.target.value)} rows={2} maxLength={10000} disabled={busy} /></label>
    {notice && <small>{notice}</small>}
    <div className={styles.buttons}>
      {canDecide && !settled && <Button variant="primary" disabled={busy} onClick={() => send('approved')}>Approve</Button>}
      {canDecide && !settled && <Button disabled={busy} onClick={() => send('rejected')}>Request changes</Button>}
      {allowComments && <Button variant="quiet" disabled={busy} onClick={() => send('comment')}>Send comment</Button>}
    </div>
    {note && <p role={failed ? 'alert' : 'status'} className={failed ? styles.error : styles.ok}>{note}</p>}
  </form>;
}
