import type { GoalMetric, GoalPace } from './contracts';

/** Customer copy for Goals in both shipped languages; wording follows legacy `goals.*`. */
export const goalsCopy = {
  en: {
    eyebrow: 'Analytics', title: 'Goals this month',
    subtitle: 'Monthly targets per channel, against stored figures so far ({from} to {to}, {zone}). Figures can arrive a day or two late; no data is not zero.',
    loadFailedTitle: 'Goals could not be loaded', loadFailed: 'Goals could not be loaded. Please try again.', retry: 'Try again',
    noChannelsTitle: 'No channels yet', noChannels: 'Goals appear here once a channel is connected and selected.', manageConnections: 'Manage connections',
    none: 'No goals set for this channel.', noneReadOnly: 'No goals set for this channel. A workspace admin can set them.',
    goal: 'Goal', target: 'Target', thisMonth: 'This month', progress: 'Progress', pace: 'Pace', noData: 'No data',
    editHint: 'Leave a box empty for no goal. Targets apply to every month until you change them.',
    refresh: 'Refresh and check', perMonth: '{label} per month', noGoal: 'No goal', save: 'Save goals', saving: 'Saving…', saved: 'Goals saved.', formLabel: 'Goals for {channel}',
    invalid: '{label}: enter a whole number from 1 to 100,000,000, or leave it empty.',
    saveFailed: 'The goals could not be saved. Refresh and check before trying again.', unknown: 'The result is unknown. Refresh before retrying.',
    'metric.followers': 'New followers', 'metric.views': 'Views', 'metric.engagements': 'Engagement', 'metric.posts': 'Posts published',
    'pace.met': 'Reached', 'pace.onTrack': 'On track', 'pace.behind': 'Behind', 'pace.noData': 'No data yet',
  },
  fr: {
    eyebrow: 'Statistiques', title: 'Objectifs du mois',
    subtitle: 'Objectifs mensuels par canal, comparés aux chiffres enregistrés jusqu’ici ({from} au {to}, {zone}). Les chiffres peuvent arriver avec un ou deux jours de retard ; pas de données ne veut pas dire zéro.',
    loadFailedTitle: 'Impossible de charger les objectifs', loadFailed: 'Impossible de charger les objectifs. Réessayez.', retry: 'Réessayer',
    noChannelsTitle: 'Aucun canal pour l’instant', noChannels: 'Les objectifs apparaissent ici une fois un canal connecté et sélectionné.', manageConnections: 'Gérer les connexions',
    none: 'Aucun objectif pour ce canal.', noneReadOnly: 'Aucun objectif pour ce canal. Un administrateur de l’espace peut les fixer.',
    goal: 'Objectif', target: 'Cible', thisMonth: 'Ce mois-ci', progress: 'Progression', pace: 'Rythme', noData: 'Pas de données',
    editHint: 'Laissez une case vide pour ne pas fixer d’objectif. Les objectifs valent pour chaque mois jusqu’à ce que vous les changiez.',
    refresh: 'Actualiser et vérifier', perMonth: '{label} par mois', noGoal: 'Aucun objectif', save: 'Enregistrer', saving: 'Enregistrement…', saved: 'Objectifs enregistrés.', formLabel: 'Objectifs de {channel}',
    invalid: '{label} : saisissez un nombre entier de 1 à 100 000 000, ou laissez vide.',
    saveFailed: 'Impossible d’enregistrer les objectifs. Actualisez et vérifiez avant de réessayer.', unknown: 'Le résultat est inconnu. Actualisez avant de réessayer.',
    'metric.followers': 'Nouveaux abonnés', 'metric.views': 'Vues', 'metric.engagements': 'Engagement', 'metric.posts': 'Publications',
    'pace.met': 'Atteint', 'pace.onTrack': 'Dans le rythme', 'pace.behind': 'En retard', 'pace.noData': 'Pas encore de données',
  },
};

export type GoalsLocale = keyof typeof goalsCopy;
export type GoalsCopyKey = keyof (typeof goalsCopy)['en'];

export function goalsLocale(acceptLanguage: string | null | undefined): GoalsLocale {
  return acceptLanguage?.trim().toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
export const goalsCopyDefaults = Object.fromEntries(Object.keys(goalsCopy.en).map(key => [key, { en: goalsCopy.en[key as GoalsCopyKey], fr: goalsCopy.fr[key as GoalsCopyKey] }])) as Record<GoalsCopyKey, { en: string; fr: string }>;
export type GoalsCatalog = typeof goalsCopyDefaults;
export function goalsText(locale: GoalsLocale, key: GoalsCopyKey, values: Record<string, string | number> = {}, catalog: GoalsCatalog = goalsCopyDefaults): string {
  return catalog[key][locale].replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}
export const goalMetricText = (locale: GoalsLocale, metric: GoalMetric, catalog?: GoalsCatalog) => goalsText(locale, `metric.${metric}`, {}, catalog);
export const goalPaceText = (locale: GoalsLocale, pace: GoalPace, catalog?: GoalsCatalog) => goalsText(locale, `pace.${pace}`, {}, catalog);
