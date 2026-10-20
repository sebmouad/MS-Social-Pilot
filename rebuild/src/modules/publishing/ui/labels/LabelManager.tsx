'use client';

import { useRef, useState } from 'react';
import { IconPencil, IconTag, IconTrash } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { Select } from '@/components/Select';
import { RouteNotice } from '@/components/RouteNotice';
import { SidebarDock } from '@/components/SidebarDock';
import styles from './labels.module.css';

export type Label = { id: string; name: string; color: string; createdAt: string; usage: { posts: number; templates: number; contentMixRules: number } | null };
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
function errorText(body: unknown) { return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'The request could not be confirmed. Refresh the list and check the current label before trying again.'; }
function removalText(usage: Label['usage']) {
  return usage
    ? `Deleting this label detaches it from ${plural(usage.posts, 'post')}, clears it from ${plural(usage.templates, 'template')} and removes ${plural(usage.contentMixRules, 'content-mix rule')}. The posts and templates themselves are kept.`
    : 'Deleting a label detaches it from every post in the workspace, clears it from templates and removes content-mix rules that use it. The posts and templates themselves are kept.';
}
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function isUsage(value: unknown): value is NonNullable<Label['usage']> {
  if (!value || typeof value !== 'object') return false;
  const usage = value as { posts?: unknown; templates?: unknown; contentMixRules?: unknown };
  return count(usage.posts) && count(usage.templates) && count(usage.contentMixRules);
}
function isLabelReceipt(value: unknown): value is Label {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Label>;
  return typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(item.id) && typeof item.name === 'string' && typeof item.color === 'string' && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) && (item.usage === null || isUsage(item.usage));
}
function isDeleteReceipt(value: unknown, id: string): value is { id: string; deleted: true; detached: NonNullable<Label['usage']> } {
  return Boolean(value && typeof value === 'object' && (value as { id?: unknown }).id === id && (value as { deleted?: unknown }).deleted === true && isUsage((value as { detached?: unknown }).detached));
}

export function LabelManager({ initialLabels, colors, page, hasMore, query, canWrite = true, workspaceWide = true, maxNameCharacters, maxSearchCharacters }: { initialLabels: Label[]; colors: string[]; page: number; hasMore: boolean; query: string; canWrite?: boolean; workspaceWide?: boolean; maxNameCharacters: number; maxSearchCharacters: number }) {
  const [labels, setLabels] = useState(initialLabels);
  const [draft, setDraft] = useState({ name: '', color: colors[0] ?? 'blue' });
  const [editing, setEditing] = useState<Label | null>(null);
  const [dialog, setDialog] = useState(false);
  const [review, setReview] = useState<{ kind: 'save' | 'delete'; label?: Label } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const inFlight = useRef(false);
  const nextNotice = (text: string, error = false) => setNotice(value => ({ error, text, key: (value?.key ?? 0) + 1 }));
  const close = () => { if (!busy) setDialog(false); };
  const canChange = canWrite && workspaceWide;
  const limitedReason = 'Your access is limited to some channels, so only members with access to all channels can rename or delete labels.';
  function begin(label?: Label) { setEditing(label ?? null); setDraft(label ? { name: label.name, color: label.color } : { name: '', color: colors[0] ?? 'blue' }); setDialog(true); }
  const saveConfirmation = editing ? `UPDATE LABEL ${editing.id}` : `CREATE LABEL ${draft.name.trim()}`;
  const deleteConfirmation = review?.label ? `DELETE LABEL ${review.label.id}` : '';
  const byName = (a: Label, b: Label) => a.name.localeCompare(b.name);
  function save(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); if (inFlight.current) return; setConfirmation(''); setReview({ kind: 'save' }); }
  async function performSave() {
    if (inFlight.current || confirmation !== saveConfirmation) return;
    inFlight.current = true; setBusy(true); setNotice(null);
    try {
      const response = await fetch(editing ? `/api/publishing/labels/${encodeURIComponent(editing.id)}` : '/api/publishing/labels', { method: editing ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...draft, ...(editing ? { id: editing.id } : {}), confirmation: saveConfirmation }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !isLabelReceipt(body) || body.id !== (editing?.id ?? body.id) || body.name !== draft.name.trim() || body.color !== draft.color) throw new Error(errorText(body));
      const saved = body;
      setLabels(current => (editing ? current.map(item => item.id === saved.id ? saved : item) : [...current, saved]).sort(byName));
      setDialog(false); setReview(null); nextNotice(editing ? 'Label updated everywhere it is used.' : 'Label created.');
    } catch (error) { nextNotice(error instanceof Error ? error.message : 'The save result is unknown. Refresh the list and check the label before trying again.', true); setReview(null); }
    finally { setBusy(false); inFlight.current = false; }
  }
  async function performDelete(label: Label) {
    if (inFlight.current || confirmation !== deleteConfirmation) return;
    inFlight.current = true; setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/publishing/labels/${encodeURIComponent(label.id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !isDeleteReceipt(body, label.id)) throw new Error(errorText(body));
      setLabels(current => current.filter(item => item.id !== label.id)); setReview(null); nextNotice('Label deleted. Posts and templates remain; the label is detached from them.');
    } catch (error) { nextNotice(error instanceof Error ? error.message : 'The deletion result is unknown. Refresh and check the label before retrying.', true); setReview(null); }
    finally { setBusy(false); inFlight.current = false; }
  }
  const href = (target: number) => `/publishing/labels?page=${target}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
  return <div className={styles.root}>
    {notice && <RouteNotice error={notice.error} focusKey={`label-notice:${notice.key}`}>{notice.text}</RouteNotice>}
    <SidebarDock><form action="/publishing/labels" method="get" className={styles.search} role="search">
      <label htmlFor="label-search">Search labels</label><input id="label-search" name="q" defaultValue={query} maxLength={maxSearchCharacters} placeholder="Label name" />
      <Button type="submit" variant="secondary">Search</Button>{query && <a href="/publishing/labels">Clear</a>}
      {canWrite && <Button type="button" variant="primary" onClick={() => begin()}>New label</Button>}
    </form></SidebarDock>
    <DataTable caption="Post labels" rows={labels} rowKey={label => label.id}
      columns={[
        { key: 'label', label: 'Label', render: label => <span className={styles.chip}><span className={styles.swatch} data-color={label.color} aria-hidden="true" />{label.name}</span> },
        { key: 'posts', label: 'Posts', align: 'end', render: label => label.usage ? label.usage.posts : '—' },
        { key: 'templates', label: 'Templates', align: 'end', render: label => label.usage ? label.usage.templates : '—' },
        { key: 'mix', label: 'Content mix rules', align: 'end', render: label => label.usage ? label.usage.contentMixRules : '—' },
      ]}
      rowActions={canWrite ? label => [
        { key: 'edit', label: 'Edit', icon: <IconPencil size={16} />, disabled: !workspaceWide, disabledReason: limitedReason, onSelect: () => begin(label) },
        { key: 'delete', label: 'Delete', icon: <IconTrash size={16} />, danger: true, disabled: busy || !workspaceWide, disabledReason: limitedReason, onSelect: () => { if (!inFlight.current) { setConfirmation(''); setReview({ kind: 'delete', label }); } } },
      ] : undefined}
      rowActionsLabel={label => `Actions for ${label.name}`}
      emptyIcon={<IconTag />} emptyMessage={query ? 'No labels match this search.' : 'No labels yet. Create one to group posts by campaign, client or theme.'}
      emptyAction={query ? <a className="ui-button ui-button--secondary" href="/publishing/labels">Clear search</a> : canWrite ? <Button variant="primary" onClick={() => begin()}>New label</Button> : undefined} />
    {canWrite && !workspaceWide && <p className={styles.note}>Your access is limited to some channels, so label counts are hidden and only members with access to all channels can rename or delete labels. You can still create labels.</p>}
    <nav className={styles.pagination} aria-label="Label pages">{page > 1 && <a href={href(page - 1)}>Previous page</a>}<span>Page {page}</span>{hasMore && <a href={href(page + 1)}>Next page</a>}</nav>
    <Dialog open={dialog} title={editing ? 'Edit label' : 'New label'} description="Labels tag posts for filtering and planning. Saving a label does not change or publish any post." onClose={close} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={close}>Cancel</Button><Button type="submit" form="label-form" variant="primary" disabled={busy}>{editing ? 'Review changes' : 'Review label'}</Button></>}>
      <form id="label-form" className={styles.form} onSubmit={save} noValidate>
        <label>Name<input required maxLength={maxNameCharacters} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <div className={styles.field}><span>Colour</span><Select aria-label="Colour" value={draft.color} onChange={color => setDraft(current => ({ ...current, color }))} options={colors.map(color => ({ value: color, label: color[0]!.toUpperCase() + color.slice(1), icon: <span className={styles.swatch} data-color={color} aria-hidden="true" /> }))} /></div>
        {editing && <p className={styles.help}>Renaming or recolouring changes this label on every post and template that uses it.</p>}
      </form>
    </Dialog>
    <Dialog open={Boolean(review)} title={review?.kind === 'delete' ? 'Review label deletion' : 'Review label save'} description={review?.kind === 'delete' ? removalText(review.label?.usage ?? null) : 'Confirm to save this label to your workspace.'} onClose={() => !busy && setReview(null)} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setReview(null)}>Cancel</Button><Button variant={review?.kind === 'delete' ? 'danger' : 'primary'} disabled={busy || confirmation !== (review?.kind === 'delete' ? deleteConfirmation : saveConfirmation)} onClick={() => review?.kind === 'delete' && review.label ? void performDelete(review.label) : void performSave()}>{busy ? 'Working…' : review?.kind === 'delete' ? 'Delete label' : 'Confirm save'}</Button></>}>
      <p><strong>{review?.kind === 'delete' ? review.label?.name : draft.name || 'Untitled label'}</strong></p>
      <label className={styles.confirmLabel}>Type <code>{review?.kind === 'delete' ? deleteConfirmation : saveConfirmation}</code> to confirm<input autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
    </Dialog>
  </div>;
}
