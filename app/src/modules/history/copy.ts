import { z } from 'zod';

/** Locales the History screen and its messages are written in. */
export type HistoryLocale = 'en' | 'fr';
export const historyLocale = (language: string | null | undefined): HistoryLocale => (language ?? '').trim().toLowerCase().startsWith('fr') ? 'fr' : 'en';

const en = {
  title: 'History',
  description: 'See who did what in this workspace and which emails were sent.',
  tabsLabel: 'History views',
  tabActivity: 'Activity',
  tabEmail: 'Emails',
  searchActivity: 'Search actions',
  searchEmail: 'Search recipient or subject',
  failuresOnly: 'Only problems',
  filter: 'Apply',
  clear: 'Clear filters',
  when: 'When',
  who: 'Who',
  what: 'What happened',
  details: 'Details',
  to: 'To',
  subject: 'Subject',
  status: 'Status',
  problem: 'Problem',
  statusSent: 'Sent',
  statusFailed: 'Not delivered',
  statusSkipped: 'Skipped',
  statusOther: 'Unknown',
  systemActor: 'Automatic',
  formerMember: 'Former member',
  activityCaption: 'Workspace activity, newest first',
  emailCaption: 'Emails sent for this workspace, newest first',
  emptyActivityTitle: 'No activity yet',
  emptyActivity: 'Changes made by your team and by scheduled work appear here.',
  emptyEmailTitle: 'No emails yet',
  emptyEmail: 'Invitations, notifications and reports sent from this workspace appear here.',
  noMatchTitle: 'Nothing matches',
  noMatch: 'No entries match these filters. Clear them to see everything.',
  retention: 'Entries are kept for {days} days, then removed.',
  retentionForever: 'Entries are kept until the operator sets a retention period.',
  recentFailures: '{count} emails were not delivered in the last {days} days. Check the recipient addresses and mail settings.',
  noRecentFailures: 'Every email in the last {days} days was delivered or skipped on purpose.',
  previous: 'Newer entries',
  next: 'Older entries',
  pagesLabel: 'History pages',
  rangeLabel: 'Showing {from}–{to}',
  loadFailureTitle: 'History could not be loaded',
  loadFailure: 'Refresh the page. If it keeps failing, try again in a few minutes.',
  managersOnlyTitle: 'Only owners and admins can see history',
  managersOnly: 'Ask a workspace owner or admin if you need to know who changed something.',
  invalidFilters: 'Those filters are not valid. Clear them and try again.',
};

const fr: typeof en = {
  title: 'Historique',
  description: 'Voyez qui a fait quoi dans cet espace de travail et quels e-mails ont été envoyés.',
  tabsLabel: 'Vues de l’historique',
  tabActivity: 'Activité',
  tabEmail: 'E-mails',
  searchActivity: 'Rechercher une action',
  searchEmail: 'Rechercher un destinataire ou un objet',
  failuresOnly: 'Problèmes uniquement',
  filter: 'Appliquer',
  clear: 'Effacer les filtres',
  when: 'Quand',
  who: 'Qui',
  what: 'Ce qui s’est passé',
  details: 'Détails',
  to: 'À',
  subject: 'Objet',
  status: 'Statut',
  problem: 'Problème',
  statusSent: 'Envoyé',
  statusFailed: 'Non distribué',
  statusSkipped: 'Ignoré',
  statusOther: 'Inconnu',
  systemActor: 'Automatique',
  formerMember: 'Ancien membre',
  activityCaption: 'Activité de l’espace de travail, la plus récente d’abord',
  emailCaption: 'E-mails envoyés pour cet espace de travail, les plus récents d’abord',
  emptyActivityTitle: 'Aucune activité pour l’instant',
  emptyActivity: 'Les modifications faites par votre équipe et par les tâches planifiées apparaissent ici.',
  emptyEmailTitle: 'Aucun e-mail pour l’instant',
  emptyEmail: 'Les invitations, notifications et rapports envoyés depuis cet espace apparaissent ici.',
  noMatchTitle: 'Aucun résultat',
  noMatch: 'Aucune entrée ne correspond à ces filtres. Effacez-les pour tout voir.',
  retention: 'Les entrées sont conservées {days} jours, puis supprimées.',
  retentionForever: 'Les entrées sont conservées tant que l’opérateur n’a pas fixé de durée de conservation.',
  recentFailures: '{count} e-mails n’ont pas été distribués ces {days} derniers jours. Vérifiez les adresses et les réglages d’envoi.',
  noRecentFailures: 'Tous les e-mails des {days} derniers jours ont été distribués ou ignorés volontairement.',
  previous: 'Entrées plus récentes',
  next: 'Entrées plus anciennes',
  pagesLabel: 'Pages de l’historique',
  rangeLabel: 'Affichage de {from} à {to}',
  loadFailureTitle: 'Impossible de charger l’historique',
  loadFailure: 'Actualisez la page. Si le problème persiste, réessayez dans quelques minutes.',
  managersOnlyTitle: 'Seuls les propriétaires et administrateurs voient l’historique',
  managersOnly: 'Demandez à un propriétaire ou administrateur de l’espace si vous voulez savoir qui a modifié quelque chose.',
  invalidFilters: 'Ces filtres ne sont pas valides. Effacez-les, puis réessayez.',
};

export const HISTORY_COPY = { en, fr } as const;
export type HistoryCopy = typeof en;
const text = z.string().trim().min(1).max(600);
const catalog = z.object(Object.fromEntries(Object.keys(en).map(key => [key, text])) as { [K in keyof HistoryCopy]: z.ZodString }).strict();
export const historyCopySchema = z.object({ en: catalog, fr: catalog }).strict();

/** Action labels: `module.event` -> readable text. Unlisted actions are shown as readable words made from the code. */
export const HISTORY_ACTION_LABELS = {
  'tasks.created': { en: 'Created a task', fr: 'A créé une tâche' },
  'tasks.created_many': { en: 'Created several tasks', fr: 'A créé plusieurs tâches' },
  'tasks.updated': { en: 'Changed a task', fr: 'A modifié une tâche' },
  'tasks.status_changed': { en: 'Moved a task', fr: 'A déplacé une tâche' },
  'tasks.deleted': { en: 'Deleted a task', fr: 'A supprimé une tâche' },
  'tasks.comment_added': { en: 'Commented on a task', fr: 'A commenté une tâche' },
  'tasks.comment_deleted': { en: 'Deleted a task comment', fr: 'A supprimé un commentaire de tâche' },
  'team.member_added': { en: 'Added a team member', fr: 'A ajouté un membre' },
  'team.member_updated': { en: 'Changed a team member', fr: 'A modifié un membre' },
  'team.member_removed': { en: 'Removed a team member', fr: 'A retiré un membre' },
  'inbox.moderation_rule_created': { en: 'Created a moderation rule', fr: 'A créé une règle de modération' },
  'inbox.moderation_rule_updated': { en: 'Changed a moderation rule', fr: 'A modifié une règle de modération' },
  'inbox.moderation_rule_deleted': { en: 'Deleted a moderation rule', fr: 'A supprimé une règle de modération' },
  'inbox.moderation_action_undone': { en: 'Undid a moderation action', fr: 'A annulé une action de modération' },
  'inbox.conversation_resolved': { en: 'Resolved a conversation', fr: 'A résolu une conversation' },
  'inbox.conversation_reopened': { en: 'Reopened a conversation', fr: 'A rouvert une conversation' },
  'inbox.comment_resolved': { en: 'Resolved a comment', fr: 'A résolu un commentaire' },
  'inbox.comment_reopened': { en: 'Reopened a comment', fr: 'A rouvert un commentaire' },
  'inbox.review_resolved': { en: 'Resolved a review', fr: 'A résolu un avis' },
  'inbox.review_reopened': { en: 'Reopened a review', fr: 'A rouvert un avis' },
} as const;
export const historyActionLabelsSchema = z.record(z.string().min(1).max(120), z.object({ en: text, fr: text }).strict());
export type ActionLabels = Record<string, { en: string; fr: string }>;

/** Readable fallback for an action code, e.g. `media.upload_failed` -> "Media: upload failed". */
export function humanizeAction(action: string): string {
  const [head, ...rest] = action.split('.');
  const words = (value: string) => value.replace(/[_-]+/g, ' ').trim();
  const tail = words(rest.join(' '));
  const lead = words(head ?? '');
  const sentence = tail ? `${lead}: ${tail}` : lead;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function actionLabel(action: string, locale: HistoryLocale, labels: ActionLabels): string {
  return labels[action]?.[locale] ?? humanizeAction(action);
}

export const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
