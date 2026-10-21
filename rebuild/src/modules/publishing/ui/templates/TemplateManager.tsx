'use client';

import { useRef, useState } from 'react';
import { IconPencil, IconTemplate, IconTrash } from '@tabler/icons-react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable } from '@/components/DataTable';
import { Dialog } from '@/components/Dialog';
import { RouteNotice } from '@/components/RouteNotice';
import { SidebarDock } from '@/components/SidebarDock';
import styles from './templates.module.css';

export type Template = { id: string; name: string; category: string; body: string; hashtags: string; firstComment: string; firstCommentDelayMinutes: number; labelId: string | null; createdAt: string; updatedAt: string };
const COPY = {
  en: {
    requestFailed: 'The request could not be confirmed. Refresh the list and check the current template before trying again.',
    saveUnknown: 'The save result is unknown. Refresh the list and check the current template before trying again.', deleteUnknown: 'The deletion result is unknown. Refresh and check the template before retrying.',
    needNameAndBody: 'Enter a template name and message before saving.', updated: 'Template updated.', created: 'Template created. It is ready to select in the post composer.', deleted: 'Template deleted. Existing drafts and published posts are unchanged.',
    unknownDate: 'Unknown', search: 'Search templates', searchPlaceholder: 'Name, category or message', searchButton: 'Search', clear: 'Clear', newTemplate: 'New template',
    caption: 'Reusable post templates', template: 'Template', category: 'Category', preview: 'Message preview', updatedColumn: 'Updated', noHashtags: 'No hashtags', includesComment: ' · Includes first comment', uncategorized: 'Uncategorized',
    edit: 'Edit', delete: 'Delete', actionsFor: (name: string) => `Actions for ${name}`, noMatch: 'No templates match this search.', empty: 'No templates yet. Create one to reuse message text, hashtags and a first comment in the post composer.', clearSearch: 'Clear search',
    pages: 'Template pages', previous: 'Previous page', next: 'Next page', page: (n: number) => `Page ${n}`,
    help: 'Templates are shared with workspace members who can create posts. They save message text, hashtags, first comment and an optional label; media and links are chosen separately in the composer.',
    editTitle: 'Edit template', newTitle: 'New template', dialogDescription: 'Templates save reusable post content. Saving a template does not create or publish a post.',
    cancel: 'Cancel', saving: 'Saving…', saveChanges: 'Save changes', createTemplate: 'Create template',
    name: 'Name', optional: '(optional)', message: 'Message', hashtags: 'Hashtags', firstComment: 'First comment', delay: 'Wait before the first comment', delayHint: '(minutes; 0 sends it right after publication)',
    delayHelp: (max: number) => `Choose a whole number from 0 to ${max.toLocaleString('en')} minutes.`, label: 'Label', noLabel: 'No label', mediaHelp: 'Media and links are selected separately in the composer.',
    deleteTitle: 'Delete template', deleteBody: (name: string) => `This removes “${name}” from your workspace. Posts already created from it remain unchanged.`, deleteConfirm: 'Delete template', deleting: 'Deleting…', deleteFailed: 'Could not delete the template. Nothing was changed.',
  },
  fr: {
    requestFailed: 'La demande n’a pas pu être confirmée. Actualisez la liste et vérifiez le modèle avant de réessayer.',
    saveUnknown: 'Le résultat de l’enregistrement est inconnu. Actualisez la liste et vérifiez le modèle avant de réessayer.', deleteUnknown: 'Le résultat de la suppression est inconnu. Actualisez et vérifiez le modèle avant de réessayer.',
    needNameAndBody: 'Saisissez un nom et un message avant d’enregistrer.', updated: 'Modèle mis à jour.', created: 'Modèle créé. Vous pouvez le choisir dans le composeur de publication.', deleted: 'Modèle supprimé. Les brouillons et publications existants ne changent pas.',
    unknownDate: 'Inconnue', search: 'Rechercher des modèles', searchPlaceholder: 'Nom, catégorie ou message', searchButton: 'Rechercher', clear: 'Effacer', newTemplate: 'Nouveau modèle',
    caption: 'Modèles de publication réutilisables', template: 'Modèle', category: 'Catégorie', preview: 'Aperçu du message', updatedColumn: 'Mis à jour', noHashtags: 'Aucun hashtag', includesComment: ' · Avec premier commentaire', uncategorized: 'Sans catégorie',
    edit: 'Modifier', delete: 'Supprimer', actionsFor: (name: string) => `Actions pour ${name}`, noMatch: 'Aucun modèle ne correspond à cette recherche.', empty: 'Aucun modèle pour l’instant. Créez-en un pour réutiliser un message, des hashtags et un premier commentaire dans le composeur.', clearSearch: 'Effacer la recherche',
    pages: 'Pages de modèles', previous: 'Page précédente', next: 'Page suivante', page: (n: number) => `Page ${n}`,
    help: 'Les modèles sont partagés avec les membres de l’espace qui peuvent créer des publications. Ils enregistrent le message, les hashtags, le premier commentaire et une étiquette facultative ; les médias et les liens se choisissent dans le composeur.',
    editTitle: 'Modifier le modèle', newTitle: 'Nouveau modèle', dialogDescription: 'Un modèle conserve du contenu réutilisable. L’enregistrer ne crée ni ne publie aucune publication.',
    cancel: 'Annuler', saving: 'Enregistrement…', saveChanges: 'Enregistrer', createTemplate: 'Créer le modèle',
    name: 'Nom', optional: '(facultatif)', message: 'Message', hashtags: 'Hashtags', firstComment: 'Premier commentaire', delay: 'Délai avant le premier commentaire', delayHint: '(minutes ; 0 l’envoie juste après la publication)',
    delayHelp: (max: number) => `Choisissez un nombre entier de 0 à ${max.toLocaleString('fr')} minutes.`, label: 'Étiquette', noLabel: 'Aucune étiquette', mediaHelp: 'Les médias et les liens se choisissent séparément dans le composeur.',
    deleteTitle: 'Supprimer le modèle', deleteBody: (name: string) => `Cela retire « ${name} » de votre espace. Les publications déjà créées à partir de ce modèle ne changent pas.`, deleteConfirm: 'Supprimer le modèle', deleting: 'Suppression…', deleteFailed: 'Impossible de supprimer le modèle. Rien n’a été modifié.',
  },
};
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

export function TemplateManager({ initialTemplates, labels, page, hasMore, query, canWrite = true, limits, locale = 'en' }: { initialTemplates: Template[]; labels: Array<{ id: string; name: string }>; page: number; hasMore: boolean; query: string; canWrite?: boolean; locale?: 'en' | 'fr'; limits: { maxSearchCharacters: number; maxNameCharacters: number; maxCategoryCharacters: number; maxBodyCharacters: number; maxHashtagsCharacters: number; maxFirstCommentCharacters: number; maxFirstCommentDelayMinutes: number } }) {
  const t = COPY[locale];
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
  const pageHref = (target: number) => `/publishing/templates?page=${target}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
  return <div className={styles.root}>
    {notice && !dialog && <RouteNotice error={notice.error} focusKey={`template-notice:${notice.key}`}>{notice.text}</RouteNotice>}
    <SidebarDock><form action="/publishing/templates" method="get" className={styles.search} role="search">
      <label htmlFor="template-search">{t.search}</label><input id="template-search" name="q" defaultValue={query} maxLength={limits.maxSearchCharacters} placeholder={t.searchPlaceholder} />
      <Button type="submit" variant="secondary">{t.searchButton}</Button>{query && <a href="/publishing/templates">{t.clear}</a>}
      {canWrite && <Button type="button" variant="primary" onClick={() => begin()}>{t.newTemplate}</Button>}
    </form></SidebarDock>
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
      emptyAction={query ? <a className="ui-button ui-button--secondary" href="/publishing/templates">{t.clearSearch}</a> : canWrite ? <Button variant="primary" onClick={() => begin()}>{t.newTemplate}</Button> : undefined} />
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
