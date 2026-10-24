'use client';
import type { ComposerCatalog } from '../../composer-catalog';

import { VersionHistory } from './VersionHistory';
import { AutoTextarea } from '@/components/AutoTextarea';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { addNoteConfirmation, assignConfirmation, deleteNoteConfirmation, setFieldValuesConfirmation, setRecycleConfirmation } from '@/modules/publishing/collaboration/schemas';
import { ConfirmDialog, send, useAction } from './collab-client';
import styles from './collaboration.module.css';
import { useCollaborationCopy } from '../compose/CopyProvider';
import { fillComposerCopy } from '../../composer-catalog';

type Label = { id: string; name: string };
type FieldValue = { id: string; name: string; kind: 'text' | 'choice'; options: string[]; value: string };
type Note = { id: string; body: string; authorId: string | null; authorName: string | null; createdAt: string; createdLabel?: string };
type Version = { id: string; authorName: string | null; createdAt: string; createdLabel?: string; message: string; scheduledAt: string | null };
type Recycle = { enabled: boolean; everyDays: number | null; limit: number | null; count: number; nextAt: string | null; nextLabel?: string | null; variants: string[]; isRepeat: boolean; maxIntervalDays: number; maxRepeats: number; defaultIntervalDays: number; maxVariants: number };

export function PostPanel(p: { copyCatalog?: ComposerCatalog; postId: string; canWrite: boolean; labels: Label[]; assigned: string[]; fields: FieldValue[]; notes: Note[]; mentionable: Array<{ id: string; name: string }>; noteMax: number; viewerId: string; canModerate: boolean; versions: Version[]; restore: boolean; recycle: Recycle | null; canRestoreNow: boolean; fieldValueMax?: number; notesCanAdd?: boolean; timeZone: string }) {
  const c = useCollaborationCopy();
  return <div className={styles.root}>
    <LabelsSection {...p} />
    <FieldsSection {...p} valueMax={p.fieldValueMax} />
    <NotesSection {...p} canAdd={p.notesCanAdd !== false} />
    {(p.restore || p.versions.length > 0) && <VersionHistory {...p} />}
    {p.recycle && <RecycleSection timeZone={p.timeZone} postId={p.postId} canWrite={p.canWrite} initial={p.recycle} />}
  </div>;
}

function LabelsSection({ postId, canWrite, labels, assigned }: { postId: string; canWrite: boolean; labels: Label[]; assigned: string[] }) {
  const c = useCollaborationCopy();
  const [saved, setSaved] = useState(new Set(assigned));
  const [chosen, setChosen] = useState(new Set(assigned));
  const [review, setReview] = useState(false);
  const action = useAction();
  const dirty = chosen.size !== saved.size || [...chosen].some(id => !saved.has(id));
  const confirmation = assignConfirmation('set', 1);
  async function apply() {
    const ok = await action.run(async () => {
      const result = await action.send<{ posts: Array<{ postId: string; labelIds: string[] }> }>('POST', '/api/publishing/assignments', { postIds: [postId], labelIds: [...chosen], mode: 'set', confirmation });
      const labelIds = result.posts?.find(x => x.postId === postId)?.labelIds;
      if (!labelIds) throw new Error(c.the_result_could_not_be_verified_refresh_to_see_the_current_labels);
      setSaved(new Set(labelIds)); setChosen(new Set(labelIds)); return c.labels_saved;
    });
    if (ok) setReview(false);
  }
  return <section className={styles.section} aria-labelledby="labels-title"><h2 id="labels-title">{c.labels}</h2>
    {action.banner}
    {labels.length ? <div className={styles.grid}>{labels.map(l => <label key={l.id} className={styles.check}><input type="checkbox" disabled={!canWrite || action.busy} checked={chosen.has(l.id)} onChange={() => setChosen(c => { const n = new Set(c); if (!n.delete(l.id)) n.add(l.id); return n; })} />{l.name}</label>)}</div> : <p className={styles.empty}>{c.no_labels_exist_yet_create_some_in_labels}</p>}
    {canWrite && labels.length > 0 && dirty && <div className={styles.actions}><Button variant="primary" disabled={action.busy} onClick={() => setReview(true)}>{c.review_label_change}</Button></div>}
    <ConfirmDialog feedback={action.feedback} open={review} title={c.review_label_change} description={c.only_this_post_s_labels_change_nothing_is_published_or_rescheduled} confirmation={confirmation} actionLabel={c.save_labels} busy={action.busy} onCancel={() => setReview(false)} onConfirm={() => void apply()} />
  </section>;
}

function FieldsSection({ postId, canWrite, fields, valueMax }: { postId: string; canWrite: boolean; fields: FieldValue[]; valueMax?: number }) {
  const c = useCollaborationCopy();
  const [values, setValues] = useState(Object.fromEntries(fields.map(f => [f.id, f.value])));
  const [saved, setSaved] = useState(values);
  const action = useAction();
  const dirty = fields.some(f => values[f.id] !== saved[f.id]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const changed = Object.fromEntries(fields.filter(f => values[f.id] !== saved[f.id]).map(f => [f.id, values[f.id]!]));
      const result = await action.send<{ postId: string }>('PUT', `/api/publishing/custom-fields/posts/${encodeURIComponent(postId)}`, { values: changed, confirmation: setFieldValuesConfirmation(postId) });
      if (result.postId !== postId) throw new Error(c.the_result_could_not_be_verified_refresh_to_see_the_current_values);
      setSaved(values); return c.field_values_saved;
    });
  }
  return <section className={styles.section} aria-labelledby="fields-title"><h2 id="fields-title">{c.custom_fields}</h2>
    {action.banner}
    {fields.length ? <form noValidate className={styles.form} onSubmit={event => void save(event)}>
      {fields.map(f => <label key={f.id}>{f.name}{f.kind === 'choice'
        ? <select disabled={!canWrite || action.busy} value={values[f.id]} onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))}><option value="">{c.not_set}</option>{f.options.map(o => <option key={o} value={o}>{o}</option>)}</select>
        : <input disabled={!canWrite || action.busy} maxLength={valueMax} value={values[f.id]} onChange={e => setValues(v => ({ ...v, [f.id]: e.target.value }))} />}</label>)}
      {canWrite && <div className={styles.actions}><Button type="submit" variant="primary" disabled={!dirty || action.busy}>{action.busy ? c.saving : c.save_values}</Button></div>}
    </form> : <p className={styles.empty}>{c.no_custom_fields_are_set_up_for_this_workspace}</p>}
  </section>;
}

/** The team-notes thread on its own, for surfaces that attach comments to a post card (the approval pipeline). */
export function PostNotesThread(props: { postId: string; canWrite: boolean; notes: Note[]; mentionable: Array<{ id: string; name: string }>; noteMax: number; viewerId: string; canModerate: boolean; canAdd?: boolean; timeZone: string; idPrefix?: string }) {
  return <NotesSection {...props} />;
}

function NotesSection({ postId, canWrite, notes: initial, mentionable, noteMax, viewerId, canModerate, canAdd = true, timeZone, idPrefix = 'notes' }: { postId: string; canWrite: boolean; notes: Note[]; mentionable: Array<{ id: string; name: string }>; noteMax: number; viewerId: string; canModerate: boolean; canAdd?: boolean; timeZone: string; idPrefix?: string }) {
  const c = useCollaborationCopy();
  const [notes, setNotes] = useState(initial);
  const [body, setBody] = useState('');
  const [mentions, setMentions] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<Note | null>(null);
  const action = useAction();
  const confirmed = addNoteConfirmation(postId);
  // You cannot mention yourself, so the picker appears only when someone else can be mentioned.
  const others = mentionable.filter(m => m.id !== viewerId);
  async function add(event: React.FormEvent) {
    event.preventDefault();
    await action.run(async () => {
      const text = body.trim();
      const ids = mentionable.filter(m => mentions.has(m.id) && text.includes(`@${m.name}`)).map(m => m.id);
      const result = await action.send<{ id: string; createdAt: string; createdLabel?: string | null; notified: string }>('POST', '/api/publishing/notes', { postId, body: text, mentionIds: ids, confirmation: confirmed });
      const createdAt = new Date(result.createdAt);
      if (typeof result.id !== 'string' || !Number.isFinite(createdAt.getTime())) throw new Error(c.the_note_could_not_be_verified_refresh_to_check_it);
      setNotes(n => [{ id: result.id, body: text, authorId: viewerId, authorName: c.you, createdAt: createdAt.toISOString(), ...(result.createdLabel ? { createdLabel: result.createdLabel } : {}) }, ...n]);
      setBody(''); setMentions(new Set());
      return result.notified === 'queued' ? c.note_saved_mention_notifications_queued : c.note_saved;
    });
  }
  async function remove(note: Note) {
    const ok = await action.run(async () => {
      const result = await action.send<{ id: string; deleted: boolean }>('DELETE', `/api/publishing/notes/${encodeURIComponent(note.id)}`, { confirmation: deleteNoteConfirmation(note.id) });
      if (result.id !== note.id || !result.deleted) throw new Error(c.the_deletion_could_not_be_verified_refresh_to_check_the_note);
      setNotes(n => n.filter(x => x.id !== note.id)); return c.note_deleted;
    });
    if (ok) setRemoving(null);
  }
  return <section className={styles.section} aria-labelledby={`${idPrefix}-title`}><h2 id={`${idPrefix}-title`}>{c.team_notes}</h2>
    <p className={styles.help}>{c.notes_are_for_your_team_only_and_are_never_published}</p>
    {action.banner}
    {canWrite && canAdd && <form noValidate className={styles.form} onSubmit={event => void add(event)}>
      <label>{c.new_note}<AutoTextarea rows={3} maxLength={noteMax} required value={body} disabled={action.busy} onChange={e => setBody(e.target.value)} /></label>
      {others.length > 0 && <fieldset className={styles.form}><legend className={styles.meta}>{c.mention_also_type_name_in_the_note}</legend><div className={styles.grid}>{others.map(m => <label key={m.id} className={styles.check}><input type="checkbox" checked={mentions.has(m.id)} onChange={() => setMentions(s => { const n = new Set(s); if (!n.delete(m.id)) n.add(m.id); return n; })} />{m.name}</label>)}</div></fieldset>}
      <div className={styles.actions}><Button type="submit" variant="primary" disabled={action.busy || !body.trim()}>{action.busy ? c.saving : c.add_note}</Button><span className={styles.meta}>{body.length}/{noteMax}</span></div>
    </form>}
    {notes.length ? <ul className={styles.form}>{notes.map(n => <li key={n.id} className={styles.note}><div>{n.body}</div><div className={styles.meta}>{n.authorName ?? c.former_member} · {n.createdLabel || c.unknown}</div>
      {canWrite && (n.authorId === viewerId || canModerate) && <Button size="sm" variant="danger" disabled={action.busy} onClick={() => setRemoving(n)}>{c.delete}</Button>}</li>)}</ul> : <p className={styles.empty}>{c.no_notes_yet}</p>}
    <ConfirmDialog feedback={action.feedback} open={Boolean(removing)} title={c.delete_note} description={c.this_permanently_removes_the_note_for_everyone} confirmation={removing ? deleteNoteConfirmation(removing.id) : ''} actionLabel={c.delete_note} danger busy={action.busy} onCancel={() => setRemoving(null)} onConfirm={() => removing && void remove(removing)} />
  </section>;
}


function RecycleSection({ postId, canWrite, initial, timeZone }: { postId: string; canWrite: boolean; initial: Recycle; timeZone: string }) {
  const c = useCollaborationCopy();
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
      const r = await action.send<{ enabled: boolean; everyDays: number | null; limit: number | null; count: number; nextAt: string | null; nextLabel?: string | null; variants: string[]; isRepeat: boolean }>('PUT', '/api/publishing/recycle', body);
      if (r.enabled !== enabled) throw new Error(c.the_saved_settings_could_not_be_verified_refresh_to_see_the_current);
      setState(s => ({ ...s, ...r })); return enabled ? c.repeating_is_on : c.repeating_is_off;
    });
    if (ok) setReview(false);
  }
  return <section className={styles.section} aria-labelledby="recycle-title"><h2 id="recycle-title">{c.repeat_this_post}</h2>
    {action.banner}
    {state.isRepeat ? <p className={styles.help}>{c.this_post_is_a_repeat_of_another_post_change_repeating_on_the}</p> : <>
      <p className={styles.help}>{state.enabled ? fillComposerCopy(c.repeatStatus, { days: state.everyDays ?? '', count: state.count, plural: state.count === 1 ? '' : 's', next: state.nextAt ? fillComposerCopy(c.nextRepeat, { time: state.nextLabel || c.unknown }) : '' }) : c.repeating_is_off} { c.repeatHint }</p>
      <form noValidate className={styles.form} onSubmit={event => { event.preventDefault(); setReview(true); }}>
        <label className={styles.check}><input type="checkbox" disabled={!canWrite || action.busy} checked={enabled} onChange={e => setEnabled(e.target.checked)} />{c.repeat_this_post}</label>
        <label>{c.days_between_repeats}<input type="number" min={1} max={state.maxIntervalDays} required value={days} disabled={!canWrite || action.busy} onChange={e => setDays(Math.max(1, Math.min(state.maxIntervalDays, Number(e.target.value) || 1)))} /></label>
        <label>{c.stop_after_leave_empty_for_no_limit}<input type="number" min={1} max={state.maxRepeats} value={limit} disabled={!canWrite || action.busy} onChange={e => setLimit(e.target.value)} /></label>
        <label>{c.alternate_wordings_separate_with_a_line_containing_only}<AutoTextarea rows={5} value={variants} disabled={!canWrite || action.busy} onChange={e => setVariants(e.target.value)} /></label>
        {list.length > state.maxVariants && <p role="alert">{fillComposerCopy(c.variantsMax, { max: state.maxVariants })}</p>}
        {canWrite && <div className={styles.actions}><Button type="submit" variant="primary" disabled={action.busy || list.length > state.maxVariants}>{c.review_repeat_settings}</Button></div>}
      </form></>}
    <ConfirmDialog feedback={action.feedback} open={review} confirmationMode="review" title={c.review_repeat_settings} description={enabled ? fillComposerCopy(c.repeatReview, { days, limit: limit ? fillComposerCopy(c.repeatLimit, { count: limit }) : '' }) : c.repeating_stops_repeats_already_created_are_not_removed} confirmation={confirmation} actionLabel={c.save_repeat_settings} busy={action.busy} onCancel={() => setReview(false)} onConfirm={() => void save()} />
  </section>;
}
