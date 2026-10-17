'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { RouteNotice } from '@/components/RouteNotice';
import { TEMPLATE_DEFAULTS } from '@/modules/publishing/templates-config';
import { SidebarDock } from '@/components/SidebarDock';
import styles from './templates.module.css';

export type Template = { id: string; name: string; category: string; body: string; hashtags: string; firstComment: string; labelId: string | null; createdAt: string; updatedAt: string };
function validReceipt(value: unknown): value is Template {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['id', 'name', 'category', 'body', 'hashtags', 'firstComment', 'createdAt', 'updatedAt'].every(key => typeof item[key] === 'string') &&
    (item.labelId === null || typeof item.labelId === 'string') && Boolean(item.id) &&
    Number.isFinite(Date.parse(item.createdAt as string)) && Number.isFinite(Date.parse(item.updatedAt as string));
}
const empty = { name: '', category: '', body: '', hashtags: '', firstComment: '', labelId: null as string | null };
function errorText(body: unknown) { return body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'The request could not be confirmed. Refresh the list and check the current template before trying again.'; }
function time(value: string) { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(parsed) + ' UTC' : 'Unknown'; }

export function TemplateManager({ initialTemplates, labels, page, hasMore, query, canWrite = true, limits = TEMPLATE_DEFAULTS }: { initialTemplates: Template[]; labels: Array<{ id: string; name: string }>; page: number; hasMore: boolean; query: string; canWrite?: boolean; limits?: { maxSearchCharacters: number; maxNameCharacters: number; maxCategoryCharacters: number; maxBodyCharacters: number; maxHashtagsCharacters: number; maxFirstCommentCharacters: number } }) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [draft, setDraft] = useState<typeof empty>(empty);
  const [editing, setEditing] = useState<Template | null>(null);
  const [dialog, setDialog] = useState(false);
  const [review, setReview] = useState<{ kind: 'save' | 'delete'; template?: Template } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string; key: number } | null>(null);
  const inFlight = useRef(false);
  const nextNotice = (text: string, error = false) => setNotice(value => ({ error, text, key: (value?.key ?? 0) + 1 }));
  const close = () => { if (!busy) setDialog(false); };
  function begin(template?: Template) { setEditing(template ?? null); setDraft(template ? { name: template.name, category: template.category, body: template.body, hashtags: template.hashtags, firstComment: template.firstComment, labelId: template.labelId } : empty); setDialog(true); }
  const saveConfirmation = `${editing ? 'UPDATE' : 'CREATE'} TEMPLATE ${editing ? editing.id : draft.name.trim()}`;
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current) return;
    setConfirmation(''); setReview({ kind: 'save' });
  }
  async function performSave() {
    if (inFlight.current || confirmation !== saveConfirmation) return;
    inFlight.current = true; setBusy(true); setNotice(null);
    try {
      const response = await fetch(editing ? `/api/publishing/templates/${encodeURIComponent(editing.id)}` : '/api/publishing/templates', { method: editing ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...draft, ...(editing ? { id: editing.id } : {}), confirmation: saveConfirmation }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !validReceipt(body) || (editing && body.id !== editing.id) || body.name !== draft.name.trim() || body.body !== draft.body.trim() || body.firstComment !== draft.firstComment.trim() || body.hashtags !== draft.hashtags.trim() || body.category !== draft.category.trim() || body.labelId !== draft.labelId) throw new Error(errorText(body));
      const saved = body as Template;
      setTemplates(current => editing ? current.map(item => item.id === saved.id ? saved : item).sort((a, b) => a.name.localeCompare(b.name)) : [...current, saved].sort((a, b) => a.name.localeCompare(b.name)));
      setDialog(false); setReview(null); nextNotice(editing ? 'Template updated.' : 'Template created. It is ready to select in the post composer.');
    } catch (error) { nextNotice(error instanceof Error ? error.message : 'The save result is unknown. Refresh the list and check the current template before trying again.', true); }
    finally { setBusy(false); inFlight.current = false; }
  }
  function remove(template: Template) {
    if (inFlight.current) return;
    setConfirmation(''); setReview({ kind: 'delete', template });
  }
  async function performDelete(template: Template) {
    if (inFlight.current || confirmation !== `DELETE TEMPLATE ${template.id}`) return;
    inFlight.current = true; setBusy(true); setNotice(null);
    try {
      const response = await fetch(`/api/publishing/templates/${encodeURIComponent(template.id)}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation }) });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body || body.deleted !== true || body.id !== template.id) throw new Error(errorText(body));
      setTemplates(current => current.filter(item => item.id !== template.id)); setReview(null); nextNotice('Template deleted. Existing drafts and published posts are unchanged.');
    } catch (error) { nextNotice(error instanceof Error ? error.message : 'The deletion result is unknown. Refresh and check the template before retrying.', true); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <div className={styles.root}>
    {notice && <RouteNotice error={notice.error} focusKey={`template-notice:${notice.key}`}>{notice.text}</RouteNotice>}
    <SidebarDock><form action="/publishing/templates" method="get" className={styles.search} role="search">
      <label htmlFor="template-search">Search templates</label><input id="template-search" name="q" defaultValue={query} maxLength={limits.maxSearchCharacters} placeholder="Name, category or message" />
      <Button type="submit" variant="secondary">Search</Button>{query && <a href="/publishing/templates">Clear</a>}
      {canWrite && <Button type="button" variant="primary" onClick={() => begin()}>New template</Button>}
    </form></SidebarDock>
    {templates.length ? <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Reusable post templates</caption><thead><tr><th scope="col">Template</th><th scope="col">Category</th><th scope="col">Message preview</th><th scope="col">Updated</th>{canWrite && <th scope="col">Actions</th>}</tr></thead><tbody>{templates.map(template => <tr key={template.id}><th scope="row"><span className={styles.name}>{template.name}</span><span className={styles.meta}>{template.hashtags || 'No hashtags'}{template.firstComment ? ' · Includes first comment' : ''}</span></th><td>{template.category || 'Uncategorized'}</td><td><span className={styles.preview}>{template.body}</span></td><td>{time(template.updatedAt)}</td>{canWrite && <td><div className={styles.actions}><Button size="sm" disabled={busy} onClick={() => begin(template)}>Edit</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(template)}>Delete</Button></div></td>}</tr>)}</tbody></table></div> : <p className={styles.empty}>{query ? 'No templates match this search.' : 'No templates yet. Create one to reuse message text, hashtags and a first comment in the post composer.'}</p>}
    <nav className={styles.pagination} aria-label="Template pages">{page > 1 && <a href={`/publishing/templates?page=${page - 1}${query ? `&q=${encodeURIComponent(query)}` : ''}`}>Previous page</a>}<span>Page {page}</span>{hasMore && <a href={`/publishing/templates?page=${page + 1}${query ? `&q=${encodeURIComponent(query)}` : ''}`}>Next page</a>}</nav>
    <p className={styles.help}>Templates are shared with workspace members who can create posts. They save message text, hashtags, first comment and an optional label; media and links are chosen separately in the composer.</p>
    <Dialog open={dialog} title={editing ? 'Edit template' : 'New template'} description="Templates save reusable post content. Saving a template does not create or publish a post." onClose={close} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={close}>Cancel</Button><Button type="submit" form="template-form" variant="primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Create template'}</Button></>}>
      <form id="template-form" className={styles.form} onSubmit={event => void save(event)} noValidate>
        <label>Name<input disabled={busy} required maxLength={limits.maxNameCharacters} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} /></label>
        <label>Category <span>(optional)</span><input disabled={busy} maxLength={limits.maxCategoryCharacters} value={draft.category} onChange={event => setDraft(current => ({ ...current, category: event.target.value }))} /></label>
        <label>Message<textarea disabled={busy} required maxLength={limits.maxBodyCharacters} rows={6} value={draft.body} onChange={event => setDraft(current => ({ ...current, body: event.target.value }))} /></label>
        <label>Hashtags <span>(optional)</span><textarea disabled={busy} maxLength={limits.maxHashtagsCharacters} rows={2} value={draft.hashtags} onChange={event => setDraft(current => ({ ...current, hashtags: event.target.value }))} /></label>
        <label>First comment <span>(optional)</span><textarea disabled={busy} maxLength={limits.maxFirstCommentCharacters} rows={3} value={draft.firstComment} onChange={event => setDraft(current => ({ ...current, firstComment: event.target.value }))} /></label>
        <label>Label <span>(optional)</span><select disabled={busy} value={draft.labelId ?? ''} onChange={event => setDraft(current => ({ ...current, labelId: event.target.value || null }))}><option value="">No label</option>{labels.map(label => <option key={label.id} value={label.id}>{label.name}</option>)}</select></label>
        <p className={styles.help}>Media and links are selected separately in the composer.</p>
      </form>
    </Dialog>
    <Dialog open={Boolean(review)} title={review?.kind === 'delete' ? 'Review template deletion' : 'Review template save'} description={review?.kind === 'delete' ? `This removes “${review.template?.name}” from your workspace. Posts already created from it remain unchanged.` : 'Review the template changes before saving them to your workspace.'} onClose={() => !busy && setReview(null)} busy={busy} actions={<><Button data-dialog-cancel disabled={busy} onClick={() => setReview(null)}>Cancel</Button><Button variant={review?.kind === 'delete' ? 'danger' : 'primary'} disabled={busy || confirmation !== (review?.kind === 'delete' ? `DELETE TEMPLATE ${review.template?.id}` : saveConfirmation)} onClick={() => review?.kind === 'delete' && review.template ? void performDelete(review.template) : void performSave()}>{busy ? 'Working…' : review?.kind === 'delete' ? 'Delete template' : 'Confirm save'}</Button></>}>
      <p><strong>{review?.kind === 'delete' ? review.template?.name : draft.name || 'Untitled template'}</strong></p>
      {review?.kind === 'save' && <p className={styles.reviewPreview}>{draft.body}{draft.hashtags ? `\n${draft.hashtags}` : ''}{draft.firstComment ? `\n\nFirst comment: ${draft.firstComment}` : ''}</p>}
      <label className={styles.confirmLabel}>Type <code>{review?.kind === 'delete' ? `DELETE TEMPLATE ${review.template?.id}` : saveConfirmation}</code> to confirm<input autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
    </Dialog>
  </div>;
}
