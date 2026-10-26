'use client';
import { useInboxCatalog } from '../ui/copy-context';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Select } from '@/components/Select';
import { useToast } from '@/components/Toast';
import { useConfirm } from '@/components/useConfirm';
import { MentionTextarea, MentionedBody } from './MentionTextarea';
import styles from './ThreadProductivity.module.css';

type Locale = 'en' | 'fr';
type Props = { kind: 'message' | 'comment'; id: string; canWrite?: boolean; locale?: Locale };
type Note = { id: string; authorId: string | null; authorName: string; body: string; mentionIds?: string[]; createdAt: string; canDelete: boolean; labels?: { createdAt?: string } };
type Data = { assignment: { assigneeId: string | null; members: { id: string; name: string | null }[] }; notes: Note[]; mentionable?: { id: string; name: string }[]; limits: { noteMaxCharacters: number; savedReplyNameMaxCharacters: number; savedReplyBodyMaxCharacters: number } };



/** Assignment and private notes for the open conversation. Saved replies are managed from the Inbox header and inserted from the reply box. */
export function ThreadProductivity({ kind, id, canWrite = true, locale = 'en' }: Props) {
  const copy = useInboxCatalog('productivityCopy')[locale];
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null); const [note, setNote] = useState(''); const [mentionIds, setMentionIds] = useState<string[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const productivity = await fetch(`/api/inbox/productivity?kind=${kind}&id=${encodeURIComponent(id)}`, { cache: 'no-store' });
    const p = await productivity.json();
    if (!productivity.ok) throw new Error(p.error ?? copy.loadError);
    setData(p);
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
  const memberName = (assigneeId: string | null) => data?.assignment.members.find(member => member.id === assigneeId)?.name ?? copy.unassigned;
  return <section className={styles.root} aria-label={copy.region}>
    <div className={styles.section}><div className={styles.heading}><h3>{copy.assignment}</h3></div>
      {data && <div className={styles.row}>{canWrite
        ? <Select aria-label={copy.assignTo} value={data.assignment.assigneeId ?? ''} disabled={busy}
            options={[{ value: '', label: copy.unassigned }, ...data.assignment.members.map(member => ({ value: member.id, label: member.name || copy.teammate }))]}
            onChange={value => { const assigneeId = value || null; const confirmation = `ASSIGN INBOX ${kind} ${id} TO ${assigneeId ?? 'UNASSIGNED'}`; void act({ action: 'assign', kind, id, assigneeId, confirmation }, copy.done.assign); }} />
        : <span className={styles.status}>{data.assignment.assigneeId ? copy.assignedTo(memberName(data.assignment.assigneeId)) : copy.unassigned}</span>}</div>}
    </div>
    <div className={styles.section}><div className={styles.heading}><h3>{copy.notes}</h3></div>{canWrite && <><MentionTextarea ariaLabel={copy.note} maxLength={data?.limits.noteMaxCharacters} value={note} mentionable={data?.mentionable ?? []} listLabel={copy.mentionList} emptyLabel={copy.mentionEmpty} placeholder={copy.notePlaceholder} onChange={(next, ids) => { setNote(next); setMentionIds(ids); }} /><div className={styles.row}><Button disabled={busy || !note.trim() || note.length > (data?.limits.noteMaxCharacters ?? 0)} onClick={async () => { const confirmation = `ADD PRIVATE NOTE ${kind} ${id}`; const ok = await act({ action: 'note.add', kind, id, body: note, ...(mentionIds.length ? { mentionIds } : {}), confirmation }, copy.done.noteAdded); if (ok) { setNote(''); setMentionIds([]); } }}>{copy.addNote}</Button><span className={styles.status}>{copy.mentionHint} {copy.notesHelp}</span></div></>}
      {data?.notes.map(item => <article className={styles.note} key={item.id}><div className={styles.meta}>{item.authorName} · {item.labels?.createdAt ?? ''}</div><p><MentionedBody body={item.body} mentionIds={item.mentionIds ?? []} mentionable={data?.mentionable ?? []} /></p>{canWrite && item.canDelete && <Button size="sm" variant="quiet" disabled={busy} onClick={() => { const confirmation = `DELETE PRIVATE NOTE ${item.id}`; void act({ action: 'note.delete', id: item.id, confirmation }, copy.done.noteDeleted, copy.deleteNoteAsk); }}>{copy.deleteNote}</Button>}</article>)}
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {confirmDialog}
  </section>;
}
