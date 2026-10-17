'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import styles from './ThreadProductivity.module.css';

type Props = { kind: 'message' | 'comment'; id: string; canWrite?: boolean; onUseSavedReply?: (body: string) => void };
type Note = { id: string; authorId: string | null; authorName: string; body: string; createdAt: string; canDelete: boolean };
type Reply = { id: string; name: string; body: string };
type Data = { assignment: { assigneeId: string | null; members: { id: string; name: string | null }[] }; notes: Note[]; limits: { noteMaxCharacters: number; savedReplyNameMaxCharacters: number; savedReplyBodyMaxCharacters: number } };
const confirm = (prompt: string) => window.confirm(`Confirm this action?\n\n${prompt}`);
export function ThreadProductivity({ kind, id, canWrite = true, onUseSavedReply }: Props) {
  const [data, setData] = useState<Data | null>(null); const [replies, setReplies] = useState<Reply[]>([]); const [note, setNote] = useState(''); const [replyName, setReplyName] = useState(''); const [replyBody, setReplyBody] = useState(''); const [editing, setEditing] = useState<string | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [productivity, saved] = await Promise.all([fetch(`/api/inbox/productivity?kind=${kind}&id=${encodeURIComponent(id)}`, { cache: 'no-store' }), fetch('/api/inbox/productivity?view=saved-replies', { cache: 'no-store' })]);
    const p = await productivity.json(); const r = await saved.json();
    if (!productivity.ok || !saved.ok) throw new Error(p.error ?? r.error ?? 'Inbox productivity could not be loaded.');
    setData(p); setReplies(r.replies ?? []);
  }, [kind, id]);
  useEffect(() => { let live = true; void load().catch(e => { if (live) setError(e instanceof Error ? e.message : 'Inbox productivity could not be loaded.'); }); return () => { live = false; }; }, [load]);
  async function act(body: Record<string, unknown>, ask?: string) {
    if (ask && !confirm(ask)) return;
    setBusy(true); setError('');
    try { const response = await fetch('/api/inbox/productivity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok || result.ok !== true) throw new Error(result.error ?? 'Action outcome is unconfirmed. Inspect before trying again.'); await load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : 'Action outcome is unconfirmed.'); return false; }
    finally { setBusy(false); }
  }
  const saveReply = async () => { const action = editing ? 'reply.update' : 'reply.create'; const confirmation = editing ? `UPDATE SAVED REPLY ${editing}` : `CREATE SAVED REPLY ${replyName.trim()}`; const ok = await act({ action, ...(editing ? { id: editing } : {}), name: replyName.trim(), body: replyBody.trim(), confirmation }, confirmation); if (ok) { setReplyName(''); setReplyBody(''); setEditing(null); } };
  return <section className={styles.root} aria-label="Inbox productivity">
    <div className={styles.section}><div className={styles.heading}><h3>Assignment</h3></div>
      {data && <div className={styles.row}>{canWrite ? <select aria-label="Assign to" value={data.assignment.assigneeId ?? ''} disabled={busy} onChange={e => { const assigneeId = e.target.value || null; const confirmation = `ASSIGN INBOX ${kind} ${id} TO ${assigneeId ?? 'UNASSIGNED'}`; void act({ action: 'assign', kind, id, assigneeId, confirmation }, confirmation); }}><option value="">Unassigned</option>{data.assignment.members.map(member => <option key={member.id} value={member.id}>{member.name || 'Teammate'}</option>)}</select> : <span className={styles.status}>Assigned to {data.assignment.members.find(member => member.id === data.assignment.assigneeId)?.name ?? 'Unassigned'}</span>}</div>}
    </div>
    <div className={styles.section}><div className={styles.heading}><h3>Private notes</h3></div>{canWrite && <><textarea className={styles.textarea} aria-label="Private note" maxLength={data?.limits.noteMaxCharacters} value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note for your team"/><div className={styles.row}><Button disabled={busy || !note.trim() || note.length > (data?.limits.noteMaxCharacters ?? 0)} onClick={async () => { const confirmation = `ADD PRIVATE NOTE ${kind} ${id}`; const ok = await act({ action: 'note.add', kind, id, body: note, confirmation }, confirmation); if (ok) setNote(''); }}>Add note</Button><span className={styles.status}>Only your workspace team can see these notes.</span></div></>}
      {data?.notes.map(item => <article className={styles.note} key={item.id}><div className={styles.meta}>{item.authorName} · {new Date(item.createdAt).toLocaleString()}</div><p>{item.body}</p>{canWrite && item.canDelete && <Button size="sm" variant="quiet" disabled={busy} onClick={() => { const confirmation = `DELETE PRIVATE NOTE ${item.id}`; void act({ action: 'note.delete', id: item.id, confirmation }, confirmation); }}>Delete note</Button>}</article>)}
    </div>
    <div className={styles.section}><div className={styles.heading}><h3>Saved replies</h3></div><div className={styles.replylist}>{replies.map(item => <article className={styles.reply} key={item.id}><strong>{item.name}</strong><p>{item.body}</p><div className={styles.row}>{onUseSavedReply && <Button size="sm" onClick={() => onUseSavedReply(item.body)}>Use reply</Button>}{canWrite && <><Button size="sm" variant="quiet" disabled={busy} onClick={() => { setEditing(item.id); setReplyName(item.name); setReplyBody(item.body); }}>Edit</Button><Button size="sm" variant="quiet" disabled={busy} onClick={() => { const confirmation = `DELETE SAVED REPLY ${item.id}`; void act({ action: 'reply.delete', id: item.id, confirmation }, confirmation); }}>Delete</Button></>}</div></article>)}</div>{canWrite && <><input className={styles.field} aria-label="Saved reply name" maxLength={data?.limits.savedReplyNameMaxCharacters} value={replyName} onChange={e => setReplyName(e.target.value)} placeholder="Reply name"/><textarea className={styles.textarea} aria-label="Saved reply text" maxLength={data?.limits.savedReplyBodyMaxCharacters} value={replyBody} onChange={e => setReplyBody(e.target.value)} placeholder="Reply text"/><div className={styles.row}><Button disabled={busy || !replyName.trim() || !replyBody.trim() || replyName.trim().length > (data?.limits.savedReplyNameMaxCharacters ?? 0) || replyBody.trim().length > (data?.limits.savedReplyBodyMaxCharacters ?? 0)} onClick={() => void saveReply()}>{editing ? 'Save reply' : 'Create saved reply'}</Button>{editing && <Button variant="quiet" disabled={busy} onClick={() => { setEditing(null); setReplyName(''); setReplyBody(''); }}>Cancel edit</Button>}</div></>}</div>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </section>;
}
