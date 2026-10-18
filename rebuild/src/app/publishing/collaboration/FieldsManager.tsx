'use client';

import { AutoTextarea } from '@/components/AutoTextarea';

import { useState } from 'react';
import { Button } from '@/components/Button';
import { createFieldConfirmation, deleteFieldConfirmation, updateFieldConfirmation } from '@/modules/publishing/collaboration/schemas';
import { ConfirmDialog, send, useAction } from './collab-client';
import styles from './collaboration.module.css';

export type Field = { id: string; name: string; kind: 'text' | 'choice'; options: string[]; position: number };
type Draft = { name: string; kind: 'text' | 'choice'; optionsText: string };
const blank: Draft = { name: '', kind: 'text', optionsText: '' };
const optionsOf = (d: Draft) => d.kind === 'choice' ? d.optionsText.split('\n').map(v => v.trim()).filter(Boolean) : [];

export function FieldsManager({ initialFields, canManage, limits }: { initialFields: Field[]; canManage: boolean; limits: { fieldLimit: number; nameMax: number; optionMax: number; optionsMax: number } }) {
  const [fields, setFields] = useState(initialFields);
  const [editing, setEditing] = useState<Field | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<{ kind: 'save' | 'delete'; field?: Field } | null>(null);
  const action = useAction();
  const options = optionsOf(draft);
  const distinctOptions = new Set(options);
  const optionIssue = distinctOptions.size > limits.optionsMax
    ? `Use no more than ${limits.optionsMax} choices.`
    : options.some(option => option.length > limits.optionMax)
      ? `Each choice must be ${limits.optionMax} characters or fewer.`
      : distinctOptions.size < 2 ? 'Add at least two different non-empty choices.' : null;
  const valid = draft.name.trim().length > 0 && (draft.kind === 'text' || optionIssue === null);
  const begin = (field?: Field) => { setEditing(field ?? null); setDraft(field ? { name: field.name, kind: field.kind, optionsText: field.options.join('\n') } : blank); setOpen(true); };
  const saveConfirmation = editing ? updateFieldConfirmation(editing.id) : createFieldConfirmation(draft.name);

  async function save() {
    const ok = await action.run(async () => {
      const body = { name: draft.name.trim(), kind: draft.kind, options, confirmation: saveConfirmation };
      const saved = await send<Field>(editing ? 'PUT' : 'POST', editing ? `/api/publishing/custom-fields/${encodeURIComponent(editing.id)}` : '/api/publishing/custom-fields', body);
      if (typeof saved.id !== 'string' || saved.name !== body.name || saved.kind !== body.kind) throw new Error('The saved field could not be verified. Refresh to see its current state.');
      setFields(c => (editing ? c.map(f => f.id === saved.id ? saved : f) : [...c, saved]).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name)));
      return editing ? 'Field updated.' : 'Field created. It now appears on every post.';
    });
    if (ok) { setReview(null); setOpen(false); }
  }
  async function remove(field: Field) {
    const ok = await action.run(async () => {
      const result = await send<{ id: string; deleted: boolean; valuesRemoved: number }>('DELETE', `/api/publishing/custom-fields/${encodeURIComponent(field.id)}`, { confirmation: deleteFieldConfirmation(field.id) });
      if (result.id !== field.id || result.deleted !== true) throw new Error('The deletion could not be verified. Refresh to check the field.');
      setFields(c => c.filter(f => f.id !== field.id));
      return `Field deleted. ${result.valuesRemoved} stored value${result.valuesRemoved === 1 ? ' was' : 's were'} removed from posts.`;
    });
    if (ok) setReview(null);
  }

  return <div className={styles.root}>
    {action.banner}
    <section className={styles.section}><h2>Workspace fields</h2>
      <p className={styles.help}>Add fields such as a campaign code or product to every post. Up to {limits.fieldLimit} per workspace.</p>
      {canManage && <div className={styles.actions}><Button variant="primary" disabled={action.busy || fields.length >= limits.fieldLimit} onClick={() => begin()}>New field</Button></div>}
      {fields.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Custom post fields</caption><thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Options</th>{canManage && <th scope="col">Actions</th>}</tr></thead>
        <tbody>{fields.map(f => <tr key={f.id}><th scope="row">{f.name}</th><td>{f.kind === 'choice' ? 'Choice' : 'Text'}</td><td>{f.options.join(', ') || '—'}</td>{canManage && <td><div className={styles.actions}><Button size="sm" disabled={action.busy} onClick={() => begin(f)}>Edit</Button><Button size="sm" variant="danger" disabled={action.busy} onClick={() => setReview({ kind: 'delete', field: f })}>Delete</Button></div></td>}</tr>)}</tbody></table></div>
        : <p className={styles.empty}>No custom fields yet.{canManage ? ' Create one to track campaign codes, products or requesters on each post.' : ''}</p>}
      {!canManage && <p className={styles.help}>Only workspace owners and admins with access to all channels can change fields. You can fill in values on each post.</p>}
    </section>
    {open && !review && <section className={styles.section} aria-labelledby="field-form-title"><h2 id="field-form-title">{editing ? 'Edit field' : 'New field'}</h2>
      <form className={styles.form} onSubmit={event => { event.preventDefault(); if (valid) setReview({ kind: 'save' }); }} noValidate>
        <label>Name<input required maxLength={limits.nameMax} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></label>
        <label>Type<select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as Draft['kind'] }))}><option value="text">Text</option><option value="choice">Choice</option></select></label>
        {draft.kind === 'choice' && <label>Options (one per line)<AutoTextarea rows={4} aria-invalid={Boolean(optionIssue)} aria-describedby="field-option-help" value={draft.optionsText} onChange={e => setDraft(d => ({ ...d, optionsText: e.target.value }))} /></label>}
        {draft.kind === 'choice' && <p id="field-option-help" role={optionIssue ? 'alert' : undefined} className={styles.help}>Up to {limits.optionsMax} choices, {limits.optionMax} characters each.{optionIssue ? ` ${optionIssue}` : ''}</p>}
        <div className={styles.actions}><Button type="submit" variant="primary" disabled={!valid || action.busy}>Review</Button><Button disabled={action.busy} onClick={() => setOpen(false)}>Cancel</Button></div>
      </form></section>}
    <ConfirmDialog feedback={action.feedback} open={review?.kind === 'save'} title="Review field" description="Saving applies to every post in the workspace." confirmation={saveConfirmation} actionLabel="Confirm save" busy={action.busy} onCancel={() => setReview(null)} onConfirm={() => void save()}>
      <p><strong>{draft.name.trim()}</strong> ({draft.kind}){options.length ? `: ${options.join(', ')}` : ''}</p></ConfirmDialog>
    <ConfirmDialog feedback={action.feedback} open={review?.kind === 'delete'} title="Review field deletion" description={`Deleting “${review?.field?.name}” also removes the value every post holds for it. Posts themselves are kept.`} confirmation={review?.field ? deleteFieldConfirmation(review.field.id) : ''} actionLabel="Delete field" danger busy={action.busy} onCancel={() => setReview(null)} onConfirm={() => review?.field && void remove(review.field)} />
  </div>;
}
