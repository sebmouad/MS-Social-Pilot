'use client';

import { useRef, useState } from 'react';
import { IconPencil, IconTag, IconTrash } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { Select } from '@/components/Select';
import { RouteNotice } from '@/components/RouteNotice';
import { SidebarDock } from '@/components/SidebarDock';
import { labelCopyDefaults, resolveLabelCopy, type LabelCopyCatalog } from './copy';
import styles from './labels.module.css';

export type Label = { id: string; name: string; color: string; createdAt: string; usage: { posts: number; templates: number; contentMixRules: number } | null };
type Usage = NonNullable<Label['usage']>;

function errorText(body: unknown, fallback: string) { return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : fallback; }
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function isUsage(value: unknown): value is Usage {
  if (!value || typeof value !== 'object') return false;
  const usage = value as { posts?: unknown; templates?: unknown; contentMixRules?: unknown };
  return count(usage.posts) && count(usage.templates) && count(usage.contentMixRules);
}
function isLabelReceipt(value: unknown): value is Label {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<Label>;
  return typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(item.id) && typeof item.name === 'string' && typeof item.color === 'string' && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt)) && (item.usage === null || isUsage(item.usage));
}
function isDeleteReceipt(value: unknown, id: string): value is { id: string; deleted: true; detached: Usage } {
  return Boolean(value && typeof value === 'object' && (value as { id?: unknown }).id === id && (value as { deleted?: unknown }).deleted === true && isUsage((value as { detached?: unknown }).detached));
}

export function LabelManager({ catalog = labelCopyDefaults, initialLabels, colors, page, hasMore, query, canWrite = true, workspaceWide = true, maxNameCharacters, maxSearchCharacters, locale = 'en' }: { catalog?: LabelCopyCatalog; initialLabels: Label[]; colors: string[]; page: number; hasMore: boolean; query: string; canWrite?: boolean; workspaceWide?: boolean; maxNameCharacters: number; maxSearchCharacters: number; locale?: 'en' | 'fr' }) {
  const t = resolveLabelCopy(catalog)[locale];
  const [labels, setLabels] = useState(initialLabels);
  const [draft, setDraft] = useState({ name: '', color: colors[0] ?? 'blue' });
  const [editing, setEditing] = useState<Label | null>(null);
  const [dialog, setDialog] = useState(false);
  const [removing, setRemoving] = useState<Label | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const inFlight = useRef(false);
  const nextNotice = (text: string, error = false) => setNotice(value => ({ error, text, key: (value?.key ?? 0) + 1 }));
  const close = () => { if (!busy) setDialog(false); };
  const canChange = canWrite && workspaceWide;
  const colourName = (color: string) => t.colours[color] ?? color[0]!.toUpperCase() + color.slice(1);
  function begin(label?: Label) { setNotice(null); setEditing(label ?? null); setDraft(label ? { name: label.name, color: label.color } : { name: '', color: colors[0] ?? 'blue' }); setDialog(true); }
  const byName = (a: Label, b: Label) => a.name.localeCompare(b.name);
  // The server still requires its exact confirmation text; the app derives it from the reviewed object so nobody has to type it.
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (!draft.name.trim()) { nextNotice(t.nameRequired, true); return; }
    const confirmation = editing ? `UPDATE LABEL ${editing.id}` : `CREATE LABEL ${draft.name.trim()}`;
    inFlight.current = true; setBusy(true); setNotice(null);
    try {
      const response = await fetch(editing ? `/api/publishing/labels/${encodeURIComponent(editing.id)}` : '/api/publishing/labels', { method: editing ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...draft, ...(editing ? { id: editing.id } : {}), confirmation }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !isLabelReceipt(body) || body.id !== (editing?.id ?? body.id) || body.name !== draft.name.trim() || body.color !== draft.color) throw new Error(errorText(body, t.requestFailed));
      const saved = body;
      setLabels(current => (editing ? current.map(item => item.id === saved.id ? saved : item) : [...current, saved]).sort(byName));
      setDialog(false); nextNotice(editing ? t.updated : t.created);
    } catch (error) { nextNotice(error instanceof Error && !(error instanceof TypeError) ? error.message : t.saveUnknown, true); }
    finally { setBusy(false); inFlight.current = false; }
  }
  async function performDelete(label: Label): Promise<string | null> {
    if (inFlight.current) return null;
    inFlight.current = true; setNotice(null);
    try {
      const response = await fetch(`/api/publishing/labels/${encodeURIComponent(label.id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: `DELETE LABEL ${label.id}` }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !isDeleteReceipt(body, label.id)) return errorText(body, t.deleteUnknown);
      setLabels(current => current.filter(item => item.id !== label.id)); nextNotice(t.deleted);
      return null;
    } catch { return t.deleteUnknown; }
    finally { inFlight.current = false; }
  }
  const href = (target: number) => `/publishing/labels?page=${target}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
  return <div className={styles.root}>
    {notice && !dialog && <RouteNotice error={notice.error} focusKey={`label-notice:${notice.key}`}>{notice.text}</RouteNotice>}
    <SidebarDock><form action="/publishing/labels" method="get" className={styles.search} role="search">
      <label htmlFor="label-search">{t.search}</label><input id="label-search" name="q" defaultValue={query} maxLength={maxSearchCharacters} placeholder={t.name} />
      <Button type="submit" variant="secondary">{t.searchButton}</Button>{query && <a href="/publishing/labels">{t.clear}</a>}
      {canWrite && <Button type="button" variant="primary" onClick={() => begin()}>{t.newLabel}</Button>}
    </form></SidebarDock>
    <DataTable caption={t.caption} rows={labels} rowKey={label => label.id}
      columns={[
        { key: 'label', label: t.label, render: label => <span className={styles.chip}><span className={styles.swatch} data-color={label.color} aria-hidden="true" />{label.name}</span> },
        { key: 'posts', label: t.posts, align: 'end', render: label => label.usage ? label.usage.posts : '—' },
        { key: 'templates', label: t.templates, align: 'end', render: label => label.usage ? label.usage.templates : '—' },
        { key: 'mix', label: t.mix, align: 'end', render: label => label.usage ? label.usage.contentMixRules : '—' },
      ]}
      rowActions={canWrite ? label => [
        { key: 'edit', label: t.edit, icon: <IconPencil size={16} />, disabled: !workspaceWide, disabledReason: t.limited, onSelect: () => begin(label) },
        { key: 'delete', label: t.delete, icon: <IconTrash size={16} />, danger: true, disabled: busy || !workspaceWide, disabledReason: t.limited, onSelect: () => { if (!inFlight.current) setRemoving(label); } },
      ] : undefined}
      rowActionsLabel={label => t.actionsFor(label.name)}
      emptyIcon={<IconTag />} emptyMessage={query ? t.noMatch : t.empty}
      emptyAction={query ? <a className="ui-button ui-button--secondary" href="/publishing/labels">{t.clearSearch}</a> : canWrite ? <Button variant="primary" onClick={() => begin()}>{t.newLabel}</Button> : undefined} />
    {canWrite && !canChange && <p className={styles.note}>{t.limitedNote}</p>}
    <nav className={styles.pagination} aria-label={t.pages}>{page > 1 && <a href={href(page - 1)}>{t.previous}</a>}<span>{t.page(page)}</span>{hasMore && <a href={href(page + 1)}>{t.next}</a>}</nav>
    <Dialog open={dialog} title={editing ? t.editTitle : t.newTitle} description={t.dialogDescription} onClose={close} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={close}>{t.cancel}</Button><Button type="submit" form="label-form" variant="primary" disabled={busy}>{busy ? t.saving : editing ? t.saveChanges : t.createLabel}</Button></>}>
      {notice?.error && <RouteNotice error focusKey={`label-edit-error:${notice.key}`}>{notice.text}</RouteNotice>}
      <form id="label-form" className={styles.form} onSubmit={event => void save(event)} noValidate>
        <label>{t.nameField}<input required disabled={busy} maxLength={maxNameCharacters} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <div className={styles.field}><span>{t.colour}</span><Select aria-label={t.colour} value={draft.color} onChange={color => setDraft(current => ({ ...current, color }))} options={colors.map(color => ({ value: color, label: colourName(color), icon: <span className={styles.swatch} data-color={color} aria-hidden="true" /> }))} /></div>
        {editing && <p className={styles.help}>{t.renameHelp}</p>}
      </form>
    </Dialog>
    <ConfirmDialog open={removing !== null} title={t.deleteTitle} objectName={removing?.name ?? ''} consequence={removing?.usage ? t.removal(removing.usage) : t.removalUnknown}
      confirmLabel={t.deleteConfirm} cancelLabel={t.cancel} pendingLabel={t.deleting} failureLabel={t.deleteFailed}
      onConfirm={() => removing ? performDelete(removing) : null} onClose={() => setRemoving(null)} />
  </div>;
}
