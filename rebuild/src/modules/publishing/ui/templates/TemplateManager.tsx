'use client';

import { useRef, useState } from 'react';
import { IconPencil, IconTemplate, IconTrash } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { RouteNotice } from '@/components/RouteNotice';
import { templateCopyDefaults, resolveTemplateCopy, type TemplateCopyCatalog } from './copy';
import styles from './templates.module.css';

export type Template = { id: string; name: string; category: string; body: string; hashtags: string; firstComment: string; firstCommentDelayMinutes: number; labelId: string | null; createdAt: string; updatedAt: string };

function validReceipt(value: unknown): value is Template {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['id', 'name', 'category', 'body', 'hashtags', 'firstComment', 'createdAt', 'updatedAt'].every(key => typeof item[key] === 'string') &&
    Number.isSafeInteger(item.firstCommentDelayMinutes) && (item.firstCommentDelayMinutes as number) >= 0 && (item.labelId === null || typeof item.labelId === 'string') && Boolean(item.id) &&
    Number.isFinite(Date.parse(item.createdAt as string)) && Number.isFinite(Date.parse(item.updatedAt as string));
}
const empty = { name: '', category: '', body: '', hashtags: '', firstComment: '', firstCommentDelayMinutes: '0', labelId: null as string | null };
function errorText(body: unknown, fallback: string) { return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : fallback; }
function time(value: string, locale: 'en' | 'fr', unknown: string) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed) + ' UTC' : unknown; }

export function TemplateManager({ catalog = templateCopyDefaults, initialTemplates, labels, page, hasMore, query, canWrite = true, limits, locale = 'en' }: { catalog?: TemplateCopyCatalog; initialTemplates: Template[]; labels: Array<{ id: string; name: string }>; page: number; hasMore: boolean; query: string; canWrite?: boolean; locale?: 'en' | 'fr'; limits: { maxSearchCharacters: number; maxNameCharacters: number; maxCategoryCharacters: number; maxBodyCharacters: number; maxHashtagsCharacters: number; maxFirstCommentCharacters: number; maxFirstCommentDelayMinutes: number } }) {
  const t = resolveTemplateCopy(catalog)[locale];
  const [templates, setTemplates] = useState(initialTemplates);
  const [draft, setDraft] = useState<typeof empty>(empty);
  const [editing, setEditing] = useState<Template | null>(null);
  const [dialog, setDialog] = useState(false);
  const [removing, setRemoving] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const inFlight = useRef(false);
  const nextNotice = (text: string, error = false) => setNotice(value => ({ error, text, key: (value?.key ?? 0) + 1 }));
  const close = () => { if (!busy) setDialog(false); };
  function begin(template?: Template) { setNotice(null); setEditing(template ?? null); setDraft(template ? { name: template.name, category: template.category, body: template.body, hashtags: template.hashtags, firstComment: template.firstComment, firstCommentDelayMinutes: String(template.firstCommentDelayMinutes), labelId: template.labelId } : empty); setDialog(true); }
  // The server still requires its exact confirmation text; the app derives it from the reviewed object so nobody has to type it.
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    if (!draft.name.trim() || !draft.body.trim()) { nextNotice(t.needNameAndBody, true); return; }
    const confirmation = `${editing ? 'UPDATE' : 'CREATE'} TEMPLATE ${editing ? editing.id : draft.name.trim()}`;
    inFlight.current = true; setBusy(true); setNotice(null);
    try {
      const response = await fetch(editing ? `/api/publishing/templates/${encodeURIComponent(editing.id)}` : '/api/publishing/templates', { method: editing ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...draft, firstCommentDelayMinutes: draft.firstCommentDelayMinutes === '' ? 0 : Number(draft.firstCommentDelayMinutes), ...(editing ? { id: editing.id } : {}), confirmation }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !validReceipt(body) || (editing && body.id !== editing.id) || body.name !== draft.name.trim() || body.body !== draft.body.trim() || body.firstComment !== draft.firstComment.trim() || body.firstCommentDelayMinutes !== Number(draft.firstCommentDelayMinutes || 0) || body.hashtags !== draft.hashtags.trim() || body.category !== draft.category.trim() || body.labelId !== draft.labelId) throw new Error(errorText(body, t.requestFailed));
      const saved = body as Template;
      setTemplates(current => editing ? current.map(item => item.id === saved.id ? saved : item).sort((a, b) => a.name.localeCompare(b.name)) : [...current, saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDialog(false); nextNotice(editing ? t.updated : t.created);
    } catch (error) { nextNotice(error instanceof Error && !(error instanceof TypeError) ? error.message : t.saveUnknown, true); }
    finally { setBusy(false); inFlight.current = false; }
  }
  async function performDelete(template: Template): Promise<string | null> {
    if (inFlight.current) return null;
    inFlight.current = true; setNotice(null);
    try {
      const response = await fetch(`/api/publishing/templates/${encodeURIComponent(template.id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: `DELETE TEMPLATE ${template.id}` }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || body.deleted !== true || body.id !== template.id) return errorText(body, t.deleteUnknown);
      setTemplates(current => current.filter(item => item.id !== template.id)); nextNotice(t.deleted);
      return null;
    } catch { return t.deleteUnknown; }
    finally { inFlight.current = false; }
  }
  const pageHref = (target: number) => `/content/library/templates?page=${target}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
  return <div className={styles.root}>
    {notice && !dialog && <RouteNotice error={notice.error} focusKey={`template-notice:${notice.key}`}>{notice.text}</RouteNotice>}
    <form action="/content/library/templates" method="get" className={styles.search} role="search">
      <label htmlFor="template-search">{t.search}</label><input id="template-search" name="q" defaultValue={query} maxLength={limits.maxSearchCharacters} placeholder={t.searchPlaceholder} />
      <Button type="submit" variant="secondary">{t.searchButton}</Button>{query && <a href="/content/library/templates">{t.clear}</a>}
      {canWrite && <Button type="button" variant="primary" onClick={() => begin()}>{t.newTemplate}</Button>}
    </form>
    <DataTable caption={t.caption} rows={templates} rowKey={template => template.id}
      columns={[
        { key: 'name', label: t.template, render: template => <><span className={styles.name}>{template.name}</span><span className={styles.meta}>{template.hashtags || t.noHashtags}{template.firstComment ? t.includesComment : ''}</span></> },
        { key: 'category', label: t.category, render: template => template.category || t.uncategorized },
        { key: 'preview', label: t.preview, render: template => <span className={styles.preview}>{template.body}</span> },
        { key: 'updated', label: t.updatedColumn, render: template => time(template.updatedAt, locale, t.unknownDate) },
      ]}
      rowActions={canWrite ? template => [
        { key: 'edit', label: t.edit, icon: <IconPencil size={16} />, disabled: busy, onSelect: () => begin(template) },
        { key: 'delete', label: t.delete, icon: <IconTrash size={16} />, danger: true, disabled: busy, onSelect: () => { if (!inFlight.current) setRemoving(template); } },
      ] : undefined}
      rowActionsLabel={template => t.actionsFor(template.name)}
      emptyIcon={<IconTemplate />} emptyMessage={query ? t.noMatch : t.empty}
      emptyAction={query ? <a className="ui-button ui-button--secondary" href="/content/library/templates">{t.clearSearch}</a> : canWrite ? <Button variant="primary" onClick={() => begin()}>{t.newTemplate}</Button> : undefined} />
    <nav className={styles.pagination} aria-label={t.pages}>{page > 1 && <a href={pageHref(page - 1)}>{t.previous}</a>}<span>{t.page(page)}</span>{hasMore && <a href={pageHref(page + 1)}>{t.next}</a>}</nav>
    <p className={styles.help}>{t.help}</p>
    <Dialog open={dialog} title={editing ? t.editTitle : t.newTitle} description={t.dialogDescription} onClose={close} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={close}>{t.cancel}</Button><Button type="submit" form="template-form" variant="primary" disabled={busy}>{busy ? t.saving : editing ? t.saveChanges : t.createTemplate}</Button></>}>
      {notice?.error && <RouteNotice error focusKey={`template-edit-error:${notice.key}`}>{notice.text}</RouteNotice>}
      <form id="template-form" className={styles.form} onSubmit={event => void save(event)} noValidate>
        <label>{t.name}<input disabled={busy} required maxLength={limits.maxNameCharacters} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label>{t.category} <span>{t.optional}</span><input disabled={busy} maxLength={limits.maxCategoryCharacters} value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value }))} /></label>
        <label>{t.message}<textarea disabled={busy} required maxLength={limits.maxBodyCharacters} rows={6} value={draft.body} onChange={event => setDraft(current => ({ ...current, body: event.target.value }))} /></label>
        <label>{t.hashtags} <span>{t.optional}</span><textarea disabled={busy} maxLength={limits.maxHashtagsCharacters} rows={2} value={draft.hashtags} onChange={event => setDraft(current => ({ ...current, hashtags: event.target.value }))} /></label>
        <label>{t.firstComment} <span>{t.optional}</span><textarea disabled={busy} maxLength={limits.maxFirstCommentCharacters} rows={3} value={draft.firstComment} onChange={event => setDraft(current => ({ ...current, firstComment: event.target.value }))} /></label>
        <label>{t.delay} <span>{t.delayHint}</span><input disabled={busy} type="number" inputMode="numeric" min={0} max={limits.maxFirstCommentDelayMinutes} step={1} value={draft.firstCommentDelayMinutes} onChange={event => setDraft(current => ({ ...current, firstCommentDelayMinutes: event.target.value }))} aria-describedby="template-first-comment-delay-help" /></label>
        <p id="template-first-comment-delay-help" className={styles.help}>{t.delayHelp(limits.maxFirstCommentDelayMinutes)}</p>
        <label>{t.label} <span>{t.optional}</span><select disabled={busy} value={draft.labelId ?? ''} onChange={event => setDraft(current => ({ ...current, labelId: event.target.value || null }))}><option value="">{t.noLabel}</option>{labels.map(label => <option key={label.id} value={label.id}>{label.name}</option>)}</select></label>
        <p className={styles.help}>{t.mediaHelp}</p>
      </form>
    </Dialog>
    <ConfirmDialog open={removing !== null} title={t.deleteTitle} objectName={removing?.name ?? ''} consequence={t.deleteBody(removing?.name ?? '')}
      confirmLabel={t.deleteConfirm} cancelLabel={t.cancel} pendingLabel={t.deleting} failureLabel={t.deleteFailed}
      onConfirm={() => removing ? performDelete(removing) : null} onClose={() => setRemoving(null)} />
  </div>;
}
