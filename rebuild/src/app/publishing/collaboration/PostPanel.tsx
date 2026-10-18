'use client';

import { AutoTextarea } from '@/components/AutoTextarea';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { addNoteConfirmation, assignConfirmation, deleteNoteConfirmation, restoreVersionConfirmation, setFieldValuesConfirmation, setRecycleConfirmation } from '@/modules/publishing/collaboration/schemas';
import { ConfirmDialog, send, useAction } from './collab-client';
import styles from './collaboration.module.css';

type Label = { id: string; name: string };
type FieldValue = { id: string; name: string; kind: 'text' | 'choice'; options: string[]; value: string };
type Note = { id: string; body: string; authorId: string | null; authorName: string | null; createdAt: string };
type Version = { id: string; authorName: string | null; createdAt: string; message: string; scheduledAt: string | null };
type Recycle = { enabled: boolean; everyDays: number | null; limit: number | null; count: number; nextAt: string | null; variants: string[]; isRepeat: boolean; maxIntervalDays: number; maxRepeats: number; defaultIntervalDays: number; maxVariants: number };
const when = (v: string, timeZone: string) => { const d = new Date(v); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(d) + ` ${timeZone}` : 'Unknown'; };

export function PostPanel(p: { postId: string; canWrite: boolean; labels: Label[]; assigned: string[]; fields: FieldValue[]; notes: Note[]; mentionable: Array<{ id: string; name: string }>; noteMax: number; viewerId: string; canModerate: boolean; versions: Version[]; restore: boolean; recycle: Recycle | null; canRestoreNow: boolean; fieldValueMax?: number; notesCanAdd?: boolean; timeZone: string }) {
  return <div className={styles.root}>
    <LabelsSection {...p} />
    <FieldsSection {...p} valueMax={p.fieldValueMax} />
    <NotesSection {...p} canAdd={p.notesCanAdd !== false} />
    {(p.restore || p.versions.length > 0) && <VersionsSection {...p} />}
    {p.recycle && <RecycleSection timeZone={p.timeZone} postId={p.postId} canWrite={p.canWrite} initial={p.recycle} />}
  </div>;
}

function LabelsSection({ postId, canWrite, labels, assigned }: { postId: string; canWrite: boolean; labels: Label[]; assigned: string[] }) {
  const [saved, setSaved] = useState(new Set(assigned));
  const [chosen, setChosen] = useState(new Set(assigned));
  const [review, setReview] = useState(false);
  const action = useAction();
  const dirty = chosen.size !== saved.size || [...chosen].some(id => !saved.has(id));
  const confirmation = assignConfirmation('set', 1);
  async function apply() {
    const ok = await action.run(async () => {
      const result = await send<{ posts: Array<{ postId: string; labelIds: string[] }> }>('POST', '/api/publishing/assignments', { postIds: [postId], labelIds: [...chosen], mode: 'set', confirmation });
      const labelIds = result.posts?.find(x => x.postId === postId)?.labelIds;
      if (!labelIds) throw new Error('The result could not be verified. Refresh to see the current labels.');
      setSaved(new Set(labelIds)); setChosen(new Set(labelIds)); return 'Labels saved.';
    });
    if (ok) setReview(false);
  }
  return <section className={styles.section} aria-labelledby="labels-title"><h2 id="labels-title">Labels</h2>
    {action.banner}
    {labels.length ? <div className={styles.grid}>{labels.map(l => <label key={l.id} className={styles.check}><input type="checkbox" disabled={!canWrite || action.busy} checked={chosen.has(l.id)} onChange={() => setChosen(c => { const n = new Set(c); if (!n.delete(l.id)) n.add(l.id); return n; })} />{l.name}</label>)}</div> : <p className={styles.empty}>No labels exist yet. Create some in Labels.</p>}
    {canWrite && <div className={styles.actions}><Button variant="primary" disabled={!dirty || action.busy} onClick={() => setReview(true)}>Review label change</Button></div>}
    <ConfirmDialog feedback={action.feedback} open={review} title="Review label change" description="Only this post's labels change. Nothing is published or rescheduled." confirmation={confirmation} actionLabel="Save labels" busy={action.busy} onCancel={() => setReview(false)} onConfirm={() => void apply()} />
  </section>;
}

function FieldsSection({ postId, canWrite, fields, valueMax }: { postId: string; canWrite: boolean; fields: FieldValue[]; valueMax?: number }) {
  const [values, setValues] = useState(Object.fromEntries(fields.map(f => [f.id, f.value])));
  const [saved, setSaved] = useState(values);
  const action = useAction();
  const dirty = fields.some(f => values[f.id] !== saved[f.id]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const changed = Object.fromEntries(fields.filter(f => values[f.id] !== saved[f.id]).map(f => [f.id, values[f.id]!]));
      const result = await send<{ postId: string }>('PUT', `/api/publishing/custom-fields/posts/${encodeURIComponent(postId)}`, { values: changed, confirmation: setFieldValuesConfirmation(postId) });
      if (result.postId !== postId) throw new Error('The result could not be verified. Refresh to see the current values.');
      setSaved(values); return 'Field values saved.';
    });
  }
  return <section className={styles.section} aria-labelledby="fields-title"><h2 id="fields-title">Custom fields</h2>
    {action.banner}
    {fields.length ? <form noValidate className={styles.form} onSubmit={event => void save(event)}>
      {fields.map(f => <label key={f.id}>{f.name}{f.kind === 'choice'
        ? <select disabled={!canWrite || action.busy} value={values[f.id]} onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))}><option value="">Not set</option>{f.options.map(o => <option key={o} value={o}>{o}</option>)}</select>
        : <input disabled={!canWrite || action.busy} maxLength={valueMax} value={values[f.id]} onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))} />}</label>)}
      {canWrite && <div className={styles.actions}><Button type="submit" variant="primary" disabled={!dirty || action.busy}>{action.busy ? 'Saving…' : 'Save values'}</Button></div>}
    </form> : <p className={styles.empty}>No custom fields are set up for this workspace.</p>}
  </section>;
}

function NotesSection({ postId, canWrite, notes: initial, mentionable, noteMax, viewerId, canModerate, canAdd = true, timeZone }: { postId: string; canWrite: boolean; notes: Note[]; mentionable: Array<{ id: string; name: string }>; noteMax: number; viewerId: string; canModerate: boolean; canAdd?: boolean; timeZone: string }) {
  const [notes, setNotes] = useState(initial);
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Note | null>(null);
  const action = useAction();
  const confirmed = addNoteConfirmation(postId);
  async function add(event: React.FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const text = body.trim();
      const ids = mentionable.filter(m => mentions.has(m.id) && text.includes(`@${m.name}`)).map(m => m.id);
      const result = await send<{ id: string; createdAt: string; notified: string }>('POST', '/api/publishing/notes', { postId, body: text, mentionIds: ids, confirmation: confirmed });
      const createdAt = new Date(result.createdAt);
      if (typeof result.id !== 'string' || !Number.isFinite(createdAt.getTime())) throw new Error('The note could not be verified. Refresh to check it.');
      setNotes(n => [{ id: result.id, body: text, authorId: viewerId, authorName: 'You', createdAt: createdAt.toISOString() }, ...n]);
      setBody(''); setMentions(new Set());
      return result.notified === 'failed' ? 'Note saved, but the mention notification could not be delivered.' : result.notified === 'unavailable' ? 'Note saved. Mention notifications are not available, so mentioned members will not be told.' : 'Note saved.';
    });
  }
  async function remove(note: Note) {
    const ok = await action.run(async () => {
      const result = await send<{ id: string; deleted: boolean }>('DELETE', `/api/publishing/notes/${encodeURIComponent(note.id)}`, { confirmation: deleteNoteConfirmation(note.id) });
      if (result.id !== note.id || !result.deleted) throw new Error('The deletion could not be verified. Refresh to check the note.');
      setNotes(n => n.filter(x => x.id !== note.id)); return 'Note deleted.';
    });
    if (ok) setRemoving(null);
  }
  return <section className={styles.section} aria-labelledby="notes-title"><h2 id="notes-title">Team notes</h2>
    <p className={styles.help}>Notes are for your team only and are never published.</p>
    {action.banner}
    {canWrite && canAdd && <form noValidate className={styles.form} onSubmit={event => void add(event)}>
      <label>New note<AutoTextarea rows={3} maxLength={noteMax} required value={body} disabled={action.busy} onChange={e => setBody(e.target.value)} /></label>
      {mentionable.length > 0 && <fieldset className={styles.form}><legend className={styles.meta}>Mention (also type @Name in the note)</legend><div className={styles.grid}>{mentionable.filter(m => m.id !== viewerId).map(m => <label key={m.id} className={styles.check}><input type="checkbox" checked={mentions.has(m.id)} onChange={() => setMentions(s => { const n = new Set(s); if (!n.delete(m.id)) n.add(m.id); return n; })} />{m.name}</label>)}</div></fieldset>}
      <div className={styles.actions}><Button type="submit" variant="primary" disabled={action.busy || !body.trim()}>{action.busy ? 'Saving…' : 'Add note'}</Button><span className={styles.meta}>{body.length}/{noteMax}</span></div>
    </form>}
    {notes.length ? <ul className={styles.form}>{notes.map(n => <li key={n.id} className={styles.note}><div>{n.body}</div><div className={styles.meta}>{n.authorName ?? 'Former member'} · {when(n.createdAt, timeZone)}</div>
      {canWrite && (n.authorId === viewerId || canModerate) && <Button size="sm" variant="danger" disabled={action.busy} onClick={() => setRemoving(n)}>Delete</Button>}</li>)}</ul> : <p className={styles.empty}>No notes yet.</p>}
    <ConfirmDialog feedback={action.feedback} open={Boolean(removing)} title="Delete note" description="This permanently removes the note for everyone." confirmation={removing ? deleteNoteConfirmation(removing.id) : ''} actionLabel="Delete note" danger busy={action.busy} onCancel={() => setRemoving(null)} onConfirm={() => removing && void remove(removing)} />
  </section>;
}

function VersionsSection({ postId, versions, restore, canWrite, canRestoreNow, timeZone }: { postId: string; versions: Version[]; restore: boolean; canWrite: boolean; canRestoreNow: boolean; timeZone: string }) {
  const [target, setTarget] = useState<Version | null>(null);
  const action = useAction();
  async function apply(v: Version) {
    const ok = await action.run(async () => {
      const result = await send<{ postId: string; versionId: string; approvalReset: boolean }>('POST', '/api/publishing/versions', { postId, versionId: v.id, confirmation: restoreVersionConfirmation(v.id) });
      if (result.postId !== postId || result.versionId !== v.id) throw new Error('The restore could not be verified. Open the post and check its content.');
      return result.approvalReset ? 'Version restored. The post needs approval again.' : 'Version restored.';
    });
    if (ok) setTarget(null);
  }
  return <section className={styles.section} aria-labelledby="versions-title"><h2 id="versions-title">Version history</h2>
    {action.banner}
    {versions.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Saved versions</caption><thead><tr><th scope="col">Saved</th><th scope="col">By</th><th scope="col">Text</th>{restore && canWrite && canRestoreNow && <th scope="col">Actions</th>}</tr></thead>
      <tbody>{versions.map(v => <tr key={v.id}><th scope="row">{when(v.createdAt, timeZone)}</th><td>{v.authorName ?? 'Unknown'}</td><td><span className={styles.msg}>{v.message || 'No text'}</span></td>{restore && canWrite && canRestoreNow && <td><Button size="sm" disabled={action.busy} onClick={() => setTarget(v)}>Restore</Button></td>}</tr>)}</tbody></table></div>
      : <p className={styles.empty}>No earlier versions are stored for this post yet.</p>}
    <ConfirmDialog feedback={action.feedback} open={Boolean(target)} title="Restore this version" confirmationMode="review" description="Restore this version's text, first comment, link, media, destinations and labels. The current schedule, time zone and post format stay unchanged. Usual checks and approvals apply; nothing is published. Your current content stays in history." confirmation={target ? restoreVersionConfirmation(target.id) : ''} actionLabel="Restore version" busy={action.busy} onCancel={() => setTarget(null)} onConfirm={() => target && void apply(target)}>
      {target && <p className={styles.note}>{target.message || 'No text'}</p>}</ConfirmDialog>
  </section>;
}

function RecycleSection({ postId, canWrite, initial, timeZone }: { postId: string; canWrite: boolean; initial: Recycle; timeZone: string }) {
  const [state, setState] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [days, setDays] = useState(initial.everyDays ?? initial.defaultIntervalDays);
  const [limit, setLimit] = useState(initial.limit === null ? '' : String(initial.limit));
  const [variants, setVariants] = useState(initial.variants.join('\n---\n'));
  const [review, setReview] = useState(false);
  const action = useAction();
  const list = variants.split('\n---\n').map(v => v.trim()).filter(Boolean);
  const confirmation = setRecycleConfirmation(postId);
  async function save() {
    const ok = await action.run(async () => {
      const body = { postId, enabled, everyDays: days, limit: limit === '' ? null : Number(limit), variants: list, confirmation };
      const r = await send<{ enabled: boolean; everyDays: number | null; limit: number | null; count: number; nextAt: string | null; variants: string[]; isRepeat: boolean }>('PUT', '/api/publishing/recycle', body);
      if (r.enabled !== enabled) throw new Error('The saved settings could not be verified. Refresh to see the current state.');
      setState(s => ({ ...s, ...r })); return enabled ? 'Repeating is on.' : 'Repeating is off.';
    });
    if (ok) setReview(false);
  }
  return <section className={styles.section} aria-labelledby="recycle-title"><h2 id="recycle-title">Repeat this post</h2>
    {action.banner}
    {state.isRepeat ? <p className={styles.help}>This post is a repeat of another post. Change repeating on the original.</p> : <>
      <p className={styles.help}>{state.enabled ? `Repeating every ${state.everyDays} days. ${state.count} repeat${state.count === 1 ? '' : 's'} so far${state.nextAt ? `; next on ${when(state.nextAt, timeZone)}` : ''}.` : 'Repeating is off.'} Channels may reject identical text, so alternate wordings can rotate. Changed wordings may need workspace approval; when approvals are required, only editors and above can add them.</p>
      <form noValidate className={styles.form} onSubmit={event => { event.preventDefault(); setReview(true); }}>
        <label className={styles.check}><input type="checkbox" disabled={!canWrite || action.busy} checked={enabled} onChange={e => setEnabled(e.target.checked)} />Repeat this post</label>
        <label>Days between repeats<input type="number" min={1} max={state.maxIntervalDays} required value={days} disabled={!canWrite || action.busy} onChange={e => setDays(Math.max(1, Math.min(state.maxIntervalDays, Number(e.target.value) || 1)))} /></label>
        <label>Stop after (leave empty for no limit)<input type="number" min={1} max={state.maxRepeats} value={limit} disabled={!canWrite || action.busy} onChange={e => setLimit(e.target.value)} /></label>
        <label>Alternate wordings (separate with a line containing only ---)<AutoTextarea rows={5} value={variants} disabled={!canWrite || action.busy} onChange={e => setVariants(e.target.value)} /></label>
        {list.length > state.maxVariants && <p role="alert">Use at most {state.maxVariants} wordings.</p>}
        {canWrite && <div className={styles.actions}><Button type="submit" variant="primary" disabled={action.busy || list.length > state.maxVariants}>Review repeat settings</Button></div>}
      </form></>}
    <ConfirmDialog feedback={action.feedback} open={review} confirmationMode="review" title="Review repeat settings" description={enabled ? `New posts will be prepared every ${days} days${limit ? `, up to ${limit} times` : ''} on the same channels. Workspace approval rules may hold each repeat for review before publication.` : 'Repeating stops. Repeats already created are not removed.'} confirmation={confirmation} actionLabel="Save repeat settings" busy={action.busy} onCancel={() => setReview(false)} onConfirm={() => void save()} />
  </section>;
}
