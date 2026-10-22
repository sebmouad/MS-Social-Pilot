import { z } from 'zod';

const en = {
  title: 'Changelog',
  description: 'Write the public “What’s new” page. Entries appear newest first.',
  siteOff: 'The public site is off, so visitors cannot see this page yet. Turn on “Public site on” in Shared configuration.',
  siteOn: 'The public site is on. Visitors see these entries at /changelog.',
  formTitle: 'New entry',
  dateLabel: 'Date',
  titleLabel: 'Title',
  bodyLabel: 'Details',
  bodyHint: '(optional)',
  add: 'Publish entry',
  adding: 'Publishing…',
  added: 'Entry published.',
  addFailure: 'The entry was not published. Check the date and title, then try again.',
  listCaption: 'Published changelog entries',
  publishedOn: 'Published',
  entry: 'Entry',
  actions: 'Actions',
  remove: 'Remove',
  removing: 'Removing…',
  removeTitle: 'Remove this entry?',
  removeBody: 'It disappears from the public page right away and cannot be restored.',
  cancel: 'Keep it',
  removeFailure: 'The entry was not removed. Reload the page and try again.',
  emptyTitle: 'No entries yet',
  empty: 'Publish your first entry above. Visitors see the latest improvements here.',
  loadFailure: 'The changelog could not be loaded.',
};
const fr: typeof en = {
  title: 'Nouveautés (changelog)',
  description: 'Rédigez la page publique « Nouveautés ». Les entrées s’affichent de la plus récente à la plus ancienne.',
  siteOff: 'Le site public est désactivé : les visiteurs ne voient pas encore cette page. Activez « Site public » dans la configuration partagée.',
  siteOn: 'Le site public est activé. Les visiteurs voient ces entrées sur /changelog.',
  formTitle: 'Nouvelle entrée',
  dateLabel: 'Date',
  titleLabel: 'Titre',
  bodyLabel: 'Détails',
  bodyHint: '(facultatif)',
  add: 'Publier l’entrée',
  adding: 'Publication…',
  added: 'Entrée publiée.',
  addFailure: 'L’entrée n’a pas été publiée. Vérifiez la date et le titre, puis réessayez.',
  listCaption: 'Entrées publiées du changelog',
  publishedOn: 'Publié le',
  entry: 'Entrée',
  actions: 'Actions',
  remove: 'Supprimer',
  removing: 'Suppression…',
  removeTitle: 'Supprimer cette entrée ?',
  removeBody: 'Elle disparaît immédiatement de la page publique et ne peut pas être restaurée.',
  cancel: 'La garder',
  removeFailure: 'L’entrée n’a pas été supprimée. Rechargez la page, puis réessayez.',
  emptyTitle: 'Aucune entrée pour l’instant',
  empty: 'Publiez votre première entrée ci-dessus. Les visiteurs y voient les dernières améliorations.',
  loadFailure: 'Impossible de charger le changelog.',
};

export const ROOT_CHANGELOG_COPY = { en, fr } as const;
export type RootChangelogCopy = typeof en;
const text = z.string().trim().min(1).max(600);
const catalog = z.object(Object.fromEntries(Object.keys(en).map(key => [key, text])) as { [K in keyof RootChangelogCopy]: z.ZodString }).strict();
export const rootChangelogCopySchema = z.object({ en: catalog, fr: catalog }).strict();
