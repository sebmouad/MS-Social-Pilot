export type OriginLocale = 'en' | 'fr';

/** Customer wording for recipe-created posts and the Feeds status card. */
export const recipeOriginCopy = {
  en: {
    badge: 'Recipe', filter: 'Recipe automation', link: 'Article',
    statusTitle: 'Recipe automation', statusPaused: 'Paused', statusActive: 'Running', statusUnavailable: 'Unavailable',
    nextSlots: 'Next posts', nextEmpty: 'Nothing scheduled yet.', publishedToday: 'Published today', failures: 'Need attention',
    failuresNone: 'None', failuresDetail: '{failed} failed, {uncertain} to check', pool: 'Recipes left', poolUnknown: 'Not available right now',
    poolLow: 'Running low', poolOk: 'Healthy', poolDays: '{days} days left', poolCount: '{count} recipes', lastRun: 'Last check', never: 'Not yet',
    emptyHeading: 'Upcoming slots', slotAt: '{when} — {channel}',
  },
  fr: {
    badge: 'Recette', filter: 'Automatisation des recettes', link: 'Article',
    statusTitle: 'Automatisation des recettes', statusPaused: 'En pause', statusActive: 'Active', statusUnavailable: 'Indisponible',
    nextSlots: 'Prochaines publications', nextEmpty: 'Rien de planifié pour le moment.', publishedToday: 'Publiées aujourd’hui', failures: 'À vérifier',
    failuresNone: 'Aucune', failuresDetail: '{failed} en échec, {uncertain} à contrôler', pool: 'Recettes restantes', poolUnknown: 'Indisponible pour le moment',
    poolLow: 'Bientôt épuisées', poolOk: 'Suffisantes', poolDays: '{days} jours restants', poolCount: '{count} recettes', lastRun: 'Dernière vérification', never: 'Pas encore',
    emptyHeading: 'Prochains créneaux', slotAt: '{when} — {channel}',
  },
} as const;
export type OriginCopyKey = keyof (typeof recipeOriginCopy)['en'];

export function originText(locale: OriginLocale, key: OriginCopyKey, values: Record<string, string | number> = {}): string {
  return Object.entries(values).reduce((text: string, [name, value]) => text.replaceAll(`{${name}}`, String(value)), recipeOriginCopy[locale][key]);
}
