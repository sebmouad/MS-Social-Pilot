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
import styles from './labels.module.css';

export type Label = { id: string; name: string; color: string; createdAt: string; usage: { posts: number; templates: number; contentMixRules: number } | null };
type Usage = NonNullable<Label['usage']>;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const frPlural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;
const COPY = {
  en: {
    requestFailed: 'The request could not be confirmed. Refresh the list and check the current label before trying again.',
    removal: (usage: Usage) => `Deleting this label detaches it from ${plural(usage.posts, 'post')}, clears it from ${plural(usage.templates, 'template')} and removes ${plural(usage.contentMixRules, 'content-mix rule')}. The posts and templates themselves are kept.`,
    removalUnknown: 'Deleting a label detaches it from every post in the workspace, clears it from templates and removes content-mix rules that use it. The posts and templates themselves are kept.',
    limited: 'Your access is limited to some channels, so only members with access to all channels can rename or delete labels.',
    saveUnknown: 'The save result is unknown. Refresh the list and check the label before trying again.', deleteUnknown: 'The deletion result is unknown. Refresh and check the label before retrying.',
    updated: 'Label updated everywhere it is used.', created: 'Label created.', deleted: 'Label deleted. Posts and templates remain; the label is detached from them.',
    search: 'Search labels', name: 'Label name', searchButton: 'Search', clear: 'Clear', newLabel: 'New label', caption: 'Post labels', label: 'Label', posts: 'Posts', templates: 'Templates', mix: 'Content mix rules',
    edit: 'Edit', delete: 'Delete', actionsFor: (name: string) => `Actions for ${name}`, noMatch: 'No labels match this search.', empty: 'No labels yet. Create one to group posts by campaign, client or theme.', clearSearch: 'Clear search',
    limitedNote: 'Your access is limited to some channels, so label counts are hidden and only members with access to all channels can rename or delete labels. You can still create labels.',
    pages: 'Label pages', previous: 'Previous page', next: 'Next page', page: (n: number) => `Page ${n}`,
    editTitle: 'Edit label', newTitle: 'New label', dialogDescription: 'Labels tag posts for filtering and planning. Saving a label does not change or publish any post.',
    cancel: 'Cancel', saveChanges: 'Save changes', createLabel: 'Create label', saving: 'Saving…', nameField: 'Name', colour: 'Colour', renameHelp: 'Renaming or recolouring changes this label on every post and template that uses it.', nameRequired: 'Enter a label name.',
    deleteTitle: 'Delete label', deleteConfirm: 'Delete label', deleting: 'Deleting…', deleteFailed: 'Could not delete the label. Nothing was changed.',
    colours: {} as Record<string, string>,
  },
  fr: {
    requestFailed: 'La demande n’a pas pu être confirmée. Actualisez la liste et vérifiez l’étiquette avant de réessayer.',
    removal: (usage: Usage) => `Supprimer cette étiquette la retire de ${frPlural(usage.posts, 'publication')}, de ${frPlural(usage.templates, 'modèle')} et supprime ${frPlural(usage.contentMixRules, 'règle')} de mix de contenu. Les publications et les modèles sont conservés.`,
    removalUnknown: 'Supprimer une étiquette la retire de toutes les publications de l’espace, des modèles et des règles de mix de contenu qui l’utilisent. Les publications et les modèles sont conservés.',
    limited: 'Votre accès est limité à certains canaux : seuls les membres ayant accès à tous les canaux peuvent renommer ou supprimer des étiquettes.',
    saveUnknown: 'Le résultat de l’enregistrement est inconnu. Actualisez la liste et vérifiez l’étiquette avant de réessayer.', deleteUnknown: 'Le résultat de la suppression est inconnu. Actualisez et vérifiez l’étiquette avant de réessayer.',
    updated: 'Étiquette mise à jour partout où elle est utilisée.', created: 'Étiquette créée.', deleted: 'Étiquette supprimée. Les publications et les modèles restent ; l’étiquette en est retirée.',
    search: 'Rechercher des étiquettes', name: 'Nom de l’étiquette', searchButton: 'Rechercher', clear: 'Effacer', newLabel: 'Nouvelle étiquette', caption: 'Étiquettes de publication', label: 'Étiquette', posts: 'Publications', templates: 'Modèles', mix: 'Règles de mix de contenu',
    edit: 'Modifier', delete: 'Supprimer', actionsFor: (name: string) => `Actions pour ${name}`, noMatch: 'Aucune étiquette ne correspond à cette recherche.', empty: 'Aucune étiquette pour l’instant. Créez-en une pour regrouper les publications par campagne, client ou thème.', clearSearch: 'Effacer la recherche',
    limitedNote: 'Votre accès est limité à certains canaux : les compteurs sont masqués et seuls les membres ayant accès à tous les canaux peuvent renommer ou supprimer des étiquettes. Vous pouvez toujours en créer.',
    pages: 'Pages d’étiquettes', previous: 'Page précédente', next: 'Page suivante', page: (n: number) => `Page ${n}`,
    editTitle: 'Modifier l’étiquette', newTitle: 'Nouvelle étiquette', dialogDescription: 'Les étiquettes servent à filtrer et planifier les publications. Enregistrer une étiquette ne modifie ni ne publie aucune publication.',
    cancel: 'Annuler', saveChanges: 'Enregistrer', createLabel: 'Créer l’étiquette', saving: 'Enregistrement…', nameField: 'Nom', colour: 'Couleur', renameHelp: 'Renommer ou changer la couleur modifie cette étiquette sur toutes les publications et tous les modèles qui l’utilisent.', nameRequired: 'Saisissez un nom d’étiquette.',
    deleteTitle: 'Supprimer l’étiquette', deleteConfirm: 'Supprimer l’étiquette', deleting: 'Suppression…', deleteFailed: 'Impossible de supprimer l’étiquette. Rien n’a été modifié.',
    colours: { blue: 'Bleu', green: 'Vert', red: 'Rouge', orange: 'Orange', yellow: 'Jaune', purple: 'Violet', pink: 'Rose', teal: 'Turquoise', gray: 'Gris', grey: 'Gris' } as Record<string, string>,
  },
};
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

export function LabelManager({ initialLabels, colors, page, hasMore, query, canWrite = true, workspaceWide = true, maxNameCharacters, maxSearchCharacters, locale = 'en' }: { initialLabels: Label[]; colors: string[]; page: number; hasMore: boolean; query: string; canWrite?: boolean; workspaceWide?: boolean; maxNameCharacters: number; maxSearchCharacters: number; locale?: 'en' | 'fr' }) {
  const t = COPY[locale];
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
