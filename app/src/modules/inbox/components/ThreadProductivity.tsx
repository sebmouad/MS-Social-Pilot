'use client';
import { useInboxCatalog } from '../ui/copy-context';
import { useCallback, useEffect, useState } from 'react';
import { IconPencil, IconTrash } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { Menu } from '@/components/Menu';
import { Select } from '@/components/Select';
import { useToast } from '@/components/Toast';
import { TextInput } from '@/components/Forms';
import { useConfirm } from '@/components/useConfirm';
import { EmptyState } from '@/components/EmptyState';
import { MentionTextarea, MentionedBody } from './MentionTextarea';
import styles from './ThreadProductivity.module.css';

type Locale = 'en' | 'fr';
type Props = { kind: 'message' | 'comment'; id: string; canWrite?: boolean; onUseSavedReply?: (body: string) => void; locale?: Locale };
type Note = { id: string; authorId: string | null; authorName: string; body: string; mentionIds?: string[]; createdAt: string; canDelete: boolean; labels?: { createdAt?: string } };
type Reply = { id: string; name: string; body: string };
type Data = { assignment: { assigneeId: string | null; members: { id: string; name: string | null }[] }; notes: Note[]; mentionable?: { id: string; name: string }[]; limits: { noteMaxCharacters: number; savedReplyNameMaxCharacters: number; savedReplyBodyMaxCharacters: number } };



/** Assignment, private notes and saved replies for the open conversation. Saved replies only fill the reply box; they never send. */
export function ThreadProductivity({ kind, id, canWrite = true, onUseSavedReply, locale = 'en' }: Props) {
  const copy = useInboxCatalog('productivityCopy')[locale];
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null); const [replies, setReplies] = useState<Reply[]>([]); const [note, setNote] = useState(''); const [mentionIds, setMentionIds] = useState<string[]>([]); const [replyName, setReplyName] = useState(''); const [replyBody, setReplyBody] = useState(''); const [editing, setEditing] = useState<string | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [productivity, saved] = await Promise.all([fetch(`/api/inbox/productivity?kind=${kind}&id=${encodeURIComponent(id)}`, { cache: 'no-store' }), fetch('/api/inbox/productivity?view=saved-replies', { cache: 'no-store' })]);
    const p = await productivity.json(); const r = await saved.json();
    if (!productivity.ok || !saved.ok) throw new Error(p.error ?? r.error ?? copy.loadError);
    setData(p); setReplies(r.replies ?? []);
  }, [kind, id, copy.loadError]);
  useEffect(() => { let live = true; void load().catch(e => { if (live) setError(e instanceof Error ? e.message : copy.loadError); }); return () => { live = false; }; }, [load, copy.loadError]);
  // Reversible actions send their exact confirmation after the explicit click; only deletions ask first, in plain words.
  const [confirm, confirmDialog] = useConfirm({ title: copy.confirmTitle, cancel: copy.cancel, confirm: copy.deleteConfirm });
  async function act(body: Record<string, unknown>, done: string, ask?: string) {
    if (ask && !(await confirm(ask))) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/inbox/productivity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error ?? copy.unconfirmed);
      await load(); toast.notify({ title: done }); return true;
    } catch (e) { setError(e instanceof Error ? e.message : copy.unconfirmedShort); return false; }
    finally { setBusy(false); }
  }
  const saveReply = async () => {
    const action = editing ? 'reply.update' : 'reply.create';
    const confirmation = editing ? `UPDATE SAVED REPLY ${editing}` : `CREATE SAVED REPLY ${replyName.trim()}`;
    const ok = await act({ action, ...(editing ? { id: editing } : {}), name: replyName.trim(), body: replyBody.trim(), confirmation }, editing ? copy.done.replyUpdated : copy.done.replyCreated);
    if (ok) { setReplyName(''); setReplyBody(''); setEditing(null); }
  };
  const memberName = (assigneeId: string | null) => data?.assignment.members.find(member => member.id === assigneeId)?.name ?? copy.unassigned;
  return <section className={styles.root} aria-label={copy.region}>
    <div className={styles.section}><div className={styles.heading}><h3>{copy.assignment}</h3></div>
      {data && <div className={styles.row}>{canWrite
        ? <Select aria-label={copy.assignTo} value={data.assignment.assigneeId ?? ''} disabled={busy}
            options={[{ value: '', label: copy.unassigned }, ...data.assignment.members.map(member => ({ value: member.id, label: member.name || copy.teammate }))]}
            onChange={value => { const assigneeId = value || null; const confirmation = `ASSIGN INBOX ${kind} ${id} TO ${assigneeId ?? 'UNASSIGNED'}`; void act({ action: 'assign', kind, id, assigneeId, confirmation }, copy.done.assign); }} />
        : <span className={styles.status}>{copy.assignedTo(memberName(data.assignment.assigneeId))}</span>}</div>}
    </div>
    <div className={styles.section}><div className={styles.heading}><h3>{copy.notes}</h3></div>{canWrite && <><MentionTextarea ariaLabel={copy.note} maxLength={data?.limits.noteMaxCharacters} value={note} mentionable={data?.mentionable ?? []} listLabel={copy.mentionList} emptyLabel={copy.mentionEmpty} placeholder={copy.notePlaceholder} onChange={(next, ids) => { setNote(next); setMentionIds(ids); }} /><div className={styles.row}><Button disabled={busy || !note.trim() || note.length > (data?.limits.noteMaxCharacters ?? 0)} onClick={async () => { const confirmation = `ADD PRIVATE NOTE ${kind} ${id}`; const ok = await act({ action: 'note.add', kind, id, body: note, ...(mentionIds.length ? { mentionIds } : {}), confirmation }, copy.done.noteAdded); if (ok) { setNote(''); setMentionIds([]); } }}>{copy.addNote}</Button><span className={styles.status}>{copy.mentionHint} {copy.notesHelp}</span></div></>}
      {data?.notes.map(item => <article className={styles.note} key={item.id}><div className={styles.meta}>{item.authorName} · {item.labels?.createdAt ?? ''}</div><p><MentionedBody body={item.body} mentionIds={item.mentionIds ?? []} mentionable={data?.mentionable ?? []} /></p>{canWrite && item.canDelete && <Button size="sm" variant="quiet" disabled={busy} onClick={() => { const confirmation = `DELETE PRIVATE NOTE ${item.id}`; void act({ action: 'note.delete', id: item.id, confirmation }, copy.done.noteDeleted, copy.deleteNoteAsk); }}>{copy.deleteNote}</Button>}</article>)}
    </div>
    <div className={styles.section}><div className={styles.heading}><h3>{copy.savedReplies}</h3></div>
      {data && !replies.length ? <EmptyState title={copy.noReplies}>{copy.noRepliesBody}</EmptyState> : null}
      <div className={styles.replylist}>{replies.map(item => <article className={styles.reply} key={item.id}>
        <div className={styles.replyHead}><strong>{item.name}</strong>
          {canWrite && <Menu label={copy.replyActions(item.name)} items={[
            { key: 'edit', label: copy.edit, icon: <IconPencil size={16} />, disabled: busy, onSelect: () => { setEditing(item.id); setReplyName(item.name); setReplyBody(item.body); } },
            { key: 'delete', label: copy.delete, icon: <IconTrash size={16} />, danger: true, disabled: busy, onSelect: () => { const confirmation = `DELETE SAVED REPLY ${item.id}`; void act({ action: 'reply.delete', id: item.id, confirmation }, copy.done.replyDeleted, copy.deleteReplyAsk); } },
          ]} />}
        </div>
        <p>{item.body}</p>
        {onUseSavedReply && <div className={styles.row}><Button size="sm" onClick={() => onUseSavedReply(item.body)}>{copy.useReply}</Button></div>}
      </article>)}</div>
      {canWrite && <><TextInput aria-label={copy.replyName} maxLength={data?.limits.savedReplyNameMaxCharacters} value={replyName} onChange={e => setReplyName(e.target.value)} placeholder={copy.replyNamePlaceholder}/><textarea className={styles.textarea} aria-label={copy.replyText} maxLength={data?.limits.savedReplyBodyMaxCharacters} value={replyBody} onChange={e => setReplyBody(e.target.value)} placeholder={copy.replyTextPlaceholder}/><div className={styles.row}><Button disabled={busy || !replyName.trim() || !replyBody.trim() || replyName.trim().length > (data?.limits.savedReplyNameMaxCharacters ?? 0) || replyBody.trim().length > (data?.limits.savedReplyBodyMaxCharacters ?? 0)} onClick={() => void saveReply()}>{editing ? copy.saveReply : copy.createReply}</Button>{editing && <Button variant="quiet" disabled={busy} onClick={() => { setEditing(null); setReplyName(''); setReplyBody(''); }}>{copy.cancelEdit}</Button>}</div></>}</div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {confirmDialog}
  </section>;
}
