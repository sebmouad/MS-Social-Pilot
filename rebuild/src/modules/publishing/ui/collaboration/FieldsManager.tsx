'use client';

import { AutoTextarea } from '@/components/AutoTextarea';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { createFieldConfirmation, deleteFieldConfirmation, updateFieldConfirmation } from '@/modules/publishing/collaboration/schemas';
import { ConfirmDialog, send, useAction } from './collab-client';
import styles from './collaboration.module.css';
import { useCollaborationCopy } from '../compose/CopyProvider';
import { fillComposerCopy } from '../../composer-catalog';

export type Field = { id: string; name: string; kind: 'text' | 'choice'; options: string[]; position: number };
type Draft = { name: string; kind: 'text' | 'choice'; optionsText: string };
const blank: Draft = { name: '', kind: 'text', optionsText: '' };
const optionsOf = (d: Draft) => d.kind === 'choice' ? d.optionsText.split('\n').map(v => v.trim()).filter(Boolean) : [];

export function FieldsManager({ initialFields, canManage, limits }: { initialFields: Field[]; canManage: boolean; limits: { fieldLimit: number; nameMax: number; optionMax: number; optionsMax: number } }) {
  const c = useCollaborationCopy();
  const [fields, setFields] = useState(initialFields);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<{ kind: 'save' | 'delete'; field?: Field } | null>(null);
  const action = useAction();
  const options = optionsOf(draft);
  const distinctOptions = new Set(options);
  const optionIssue = distinctOptions.size > limits.optionsMax
    ? fillComposerCopy(c.choiceMax, { max: limits.optionsMax })
    : options.some(option => option.length > limits.optionMax)
      ? fillComposerCopy(c.choiceLength, { max: limits.optionMax })
      : distinctOptions.size < 2 ? c.add_at_least_two_different_non_empty_choices : null;
  const valid = draft.name.trim().length > 0 && (draft.kind === 'text' || optionIssue === null);
  const begin = (field?: Field) => { setEditing(field ?? null); setDraft(field ? { name: field.name, kind: field.kind, optionsText: field.options.join('\n') } : blank); setOpen(true); };
  const saveConfirmation = editing ? updateFieldConfirmation(editing.id) : createFieldConfirmation(draft.name);

  async function save() {
    const ok = await action.run(async () => {
      const body = { name: draft.name.trim(), kind: draft.kind, options, confirmation: saveConfirmation };
      const saved = await action.send<Field>(editing ? 'PUT' : 'POST', editing ? `/api/publishing/custom-fields/${encodeURIComponent(editing.id)}` : '/api/publishing/custom-fields', body);
      if (typeof saved.id !== 'string' || saved.name !== body.name || saved.kind !== body.kind) throw new Error(c.the_saved_field_could_not_be_verified_refresh_to_see_its_current);
      setFields(c => (editing ? c.map(f => f.id === saved.id ? saved : f) : [...c, saved]).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)));
      return editing ? c.field_updated : c.field_created_it_now_appears_on_every_post;
    });
    if (ok) { setReview(null); setOpen(false); }
  }
  async function remove(field: Field) {
    const ok = await action.run(async () => {
      const result = await action.send<{ id: string; deleted: boolean; valuesRemoved: number }>('DELETE', `/api/publishing/custom-fields/${encodeURIComponent(field.id)}`, { confirmation: deleteFieldConfirmation(field.id) });
      if (result.id !== field.id || result.deleted !== true) throw new Error(c.the_deletion_could_not_be_verified_refresh_to_check_the_field);
      setFields(c => c.filter(f => f.id !== field.id));
      return fillComposerCopy(result.valuesRemoved === 1 ? c.fieldDeletedSingular : c.fieldDeletedPlural, { count: result.valuesRemoved });
    });
    if (ok) setReview(null);
  }

  return <div className={styles.root}>
    {action.banner}
    <section className={styles.section}><h2>{c.workspace_fields}</h2>
      <p className={styles.help}>{fillComposerCopy(c.fieldsIntro, { max: limits.fieldLimit })}</p>
      {canManage && <div className={styles.actions}><Button variant="primary" disabled={action.busy || fields.length >= limits.fieldLimit} onClick={() => begin()}>{c.new_field}</Button></div>}
      {fields.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">{c.custom_post_fields}</caption><thead><tr><th scope="col">{c.name}</th><th scope="col">{c.type}</th><th scope="col">{c.options}</th>{canManage && <th scope="col">{c.actions}</th>}</tr></thead>
        <tbody>{fields.map(f => <tr key={f.id}><th scope="row">{f.name}</th><td>{f.kind === 'choice' ? c.choice : c.text}</td><td>{f.options.join(', ') || '—'}</td>{canManage && <td><div className={styles.actions}><Button size="sm" disabled={action.busy} onClick={() => begin(f)}>{c.edit}</Button><Button size="sm" variant="danger" disabled={action.busy} onClick={() => setReview({ kind: 'delete', field: f })}>{c.delete}</Button></div></td>}</tr>)}</tbody></table></div>
        : <p className={styles.empty}>{c.noFieldsYet}{canManage ? c.create_one_to_track_campaign_codes_products_or_requesters_on_each_post : ''}</p>}
      {!canManage && <p className={styles.help}>{c.only_workspace_owners_and_admins_with_access_to_all_channels_can_change}</p>}
    </section>
    {open && !review && <section className={styles.section} aria-labelledby="field-form-title"><h2 id="field-form-title">{editing ? c.edit_field : c.new_field}</h2>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); if (valid) setReview({ kind: 'save' }); }} noValidate>
        <label>{c.name}<input required maxLength={limits.nameMax} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></label>
        <label>{c.type}<select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as Draft['kind'] }))}><option value="text">{c.text}</option><option value="choice">{c.choice}</option></select></label>
        {draft.kind === 'choice' && <label>{c.options_one_per_line}<AutoTextarea rows={4} aria-invalid={Boolean(optionIssue)} aria-describedby="field-option-help" value={draft.optionsText} onChange={e => setDraft(d => ({ ...d, optionsText: e.target.value }))} /></label>}
        {draft.kind === 'choice' && <p id="field-option-help" role={optionIssue ? 'alert' : undefined} className={styles.help}>{fillComposerCopy(c.choiceBounds, { max: limits.optionsMax, length: limits.optionMax })}{optionIssue ? ` ${optionIssue}` : ''}</p>}
        <div className={styles.actions}><Button type="submit" variant="primary" disabled={!valid || action.busy}>{c.review}</Button><Button disabled={action.busy} onClick={() => setOpen(false)}>{c.cancel}</Button></div>
      </form></section>}
    <ConfirmDialog feedback={action.feedback} open={review?.kind === 'save'} title={c.review_field} description={c.saving_applies_to_every_post_in_the_workspace} confirmation={saveConfirmation} actionLabel={c.confirm_save} busy={action.busy} onCancel={() => setReview(null)} onConfirm={() => void save()}>
      <p><strong>{draft.name.trim()}</strong> ({draft.kind === 'choice' ? c.choice : c.text}){options.length ? `: ${options.join(', ')}` : ''}</p></ConfirmDialog>
    <ConfirmDialog feedback={action.feedback} open={review?.kind === 'delete'} title={c.review_field_deletion} description={fillComposerCopy(c.fieldDeleteHelp, { name: review?.field?.name ?? '' })} confirmation={review?.field ? deleteFieldConfirmation(review.field.id) : ''} actionLabel={c.delete_field} danger busy={action.busy} onCancel={() => setReview(null)} onConfirm={() => review?.field && void remove(review.field)} />
  </div>;
}
