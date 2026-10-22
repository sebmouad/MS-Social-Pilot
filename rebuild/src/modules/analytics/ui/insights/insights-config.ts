import { z } from 'zod';
import { entry } from '@/lib/config/entry';

type Message = { en: string; fr: string };
const m = (en: string, fr: string): Message => ({ en, fr });
const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort().join('|');

/** Root may rewrite the copy but each message keeps the named data placeholders it needs. */
function bilingualCatalogSchema<T extends Record<string, Message>>(defaults: T) {
  const shape = Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key,
    z.object({ en: z.string().min(1), fr: z.string().min(1) }).strict().superRefine((message, context) => {
      for (const locale of ['en', 'fr'] as const) {
        if (placeholders(message[locale]) !== placeholders(value[locale])) context.addIssue({ code: z.ZodIssueCode.custom, path: [locale], message: 'Keep the existing named placeholders.' });
      }
    }),
  ])) as unknown as Record<keyof T & string, z.ZodType<Message>>;
  return z.object(shape).strict();
}

/**
 * Customer copy of the Insights area (design v2 B5): Overview, Explore, Audience, Posts, Compare and Reports
 * frames. One flat English/French catalog edited in Root under `analytics.insightsCopy`. Named placeholders such
 * as {count} must stay in every edit. Caveats live in the ⓘ blocks, so each has its own message.
 */
export const insightsCopyDefaults = {
  // ---- Frame ----
  overviewTitle: m('Overview', 'Vue d’ensemble'),
  overviewInfo: m('Your key numbers for the channels selected in the sidebar. Numbers come from stored measurements, so a day without data is shown as unknown, not zero.', 'Vos chiffres clés pour les canaux sélectionnés dans la barre latérale. Les chiffres viennent de mesures enregistrées : un jour sans donnée est affiché comme inconnu, pas comme zéro.'),
  exploreTitle: m('Explore', 'Explorer'),
  exploreInfo: m('Every stored metric with its source, type and the channels it covers.', 'Chaque indicateur enregistré avec sa source, son type et les canaux couverts.'),
  compareChannels: m('Channels', 'Canaux'),
  compareAdAccounts: m('Ad accounts', 'Comptes publicitaires'),
  compareKind: m('Compare', 'Comparer'),
  // ---- Header controls ----
  downloadReport: m('Download report', 'Télécharger le rapport'),
  filtersTitle: m('Filters', 'Filtres'),
  datePeriod: m('Period', 'Période'),
  compareToggle: m('Compare with the previous period', 'Comparer avec la période précédente'),
  searchMetrics: m('Search metrics', 'Rechercher un indicateur'),
  searchMetricsPlaceholder: m('Name or source', 'Nom ou source'),
  resetFilters: m('Reset filters', 'Réinitialiser les filtres'),
  activeFilters: m('Active filters', 'Filtres actifs'),
  removeFilter: m('Remove filter', 'Retirer le filtre'),
  // ---- Info blocks (ⓘ) ----
  infoPeriod: m('Stored calendar dates from {start} to {end}, in UTC.', 'Dates enregistrées du {start} au {end}, en UTC.'),
  infoCoverage: m('{covered} of {selected} selected {resources} have data.', '{covered} sur {selected} {resources} sélectionnés ont des données.'),
  infoResourceChannels: m('channels', 'canaux'),
  infoMissing: m('A missing value is unknown, not zero.', 'Une valeur manquante est inconnue, pas nulle.'),
  infoAudienceOverlap: m('Audience counts are added across channels. People who follow more than one channel are counted more than once.', 'Les audiences sont additionnées entre canaux. Une personne qui suit plusieurs canaux est comptée plusieurs fois.'),
  infoAudienceLatest: m('Each channel contributes its latest stored audience count.', 'Chaque canal apporte son dernier chiffre d’audience enregistré.'),
  infoLatest: m('Latest data: {date}.', 'Dernières données : {date}.'),
  infoSynced: m('Last synced: {date}.', 'Dernière synchronisation : {date}.'),
  infoSource: m('Source: {source}.', 'Source : {source}.'),
  infoBasis: m('How it is counted: {basis}', 'Mode de calcul : {basis}'),
  infoPartial: m('Some channels have no data for this number, so it may be incomplete.', 'Certains canaux n’ont pas de données pour ce chiffre : il peut être incomplet.'),
  infoCompareMissing: m('There is no comparable previous period for this number.', 'Il n’existe pas de période précédente comparable pour ce chiffre.'),
  infoCompareCoverage: m('Channel coverage changed since the previous period, so the change is not shown.', 'La couverture des canaux a changé depuis la période précédente : la variation n’est pas affichée.'),
  // ---- Tiles ----
  tileUnavailable: m('No data for this selection yet', 'Pas encore de données pour cette sélection'),
  tilesLabel: m('Key numbers', 'Chiffres clés'),
  tilesShowAll: m('Show all {count}', 'Tout afficher ({count})'),
  tilesShowLess: m('Show fewer', 'Afficher moins'),
  tileVsPrevious: m('vs previous period', 'vs période précédente'),
  tilePoints: m('{value} pts', '{value} pts'),
  pinsManage: m('Manage pinned metrics', 'Gérer les indicateurs épinglés'),
  // ---- Main chart ----
  chartMetrics: m('Metric shown in the chart', 'Indicateur affiché dans le graphique'),
  chartLabel: m('{metric} over time', '{metric} dans le temps'),
  chartNoSeries: m('No dated series is stored for this metric.', 'Aucune série datée n’est enregistrée pour cet indicateur.'),
  chartScrollHint: m('Scroll sideways to see the whole range.', 'Faites défiler horizontalement pour voir toute la période.'),
  chartOpenExplore: m('Open in Explore', 'Ouvrir dans Explorer'),
  chartPrevious: m('previous period', 'période précédente'),
  chartInfo: m('Stored values per day. The dashed line is the previous period, lined up by date offset.', 'Valeurs enregistrées par jour. La ligne en pointillés est la période précédente, alignée sur le décalage de dates.'),
  // ---- Top posts ----
  topPostsTitle: m('Top posts', 'Meilleures publications'),
  topPostsInfo: m('Ranked by {measure} among the {count} most recent published posts that have stored measures. Measures are snapshots from the last sync.', 'Classées par {measure} parmi les {count} publications les plus récentes qui ont des mesures enregistrées. Les mesures sont des instantanés de la dernière synchronisation.'),
  topPostsInfoRecent: m('The most recent published posts that have stored measures. Measures are snapshots from the last sync.', 'Les publications les plus récentes qui ont des mesures enregistrées. Les mesures sont des instantanés de la dernière synchronisation.'),
  topPostsEmpty: m('No measured posts yet', 'Aucune publication mesurée'),
  topPostsEmptyBody: m('Post measures appear after published posts are synced.', 'Les mesures apparaissent après la synchronisation des publications.'),
  topPostsAll: m('All posts', 'Toutes les publications'),
  topPostsUnavailable: m('Post performance is not available for this selection.', 'La performance des publications n’est pas disponible pour cette sélection.'),
  topPostsNoText: m('Post without text', 'Publication sans texte'),
  postViewOnChannel: m('Open post', 'Ouvrir la publication'),
  // ---- Publishing activity ----
  activityTitle: m('Publishing activity', 'Activité de publication'),
  activityInfo: m('Published posts use their publish date, scheduled posts their scheduled date, and failed posts their creation date. Only the channels selected in the sidebar are counted.', 'Les publications publiées utilisent leur date de publication, les programmées leur date de programmation et les échecs leur date de création. Seuls les canaux sélectionnés dans la barre latérale sont comptés.'),
  activityPublished: m('Published', 'Publiées'),
  activityScheduled: m('Scheduled', 'Programmées'),
  activityFailed: m('Failed or partial', 'Échouées ou partielles'),
  activityOpen: m('See in Content', 'Voir dans Contenu'),
  moreInsights: m('Best times to post and interactions by channel', 'Meilleurs moments pour publier et interactions par canal'),
  // ---- Goals ----
  goalsSectionTitle: m('Goals this month', 'Objectifs du mois'),
  goalsAll: m('All goals', 'Tous les objectifs'),
  goalsProgress: m('{label}: {percent}%', '{label} : {percent} %'),
  // ---- States ----
  loadFailedTitle: m('Insights could not be loaded', 'Les statistiques n’ont pas pu être chargées'),
  loadFailedBody: m('Try again, or reset the filters.', 'Réessayez, ou réinitialisez les filtres.'),
  retry: m('Try again', 'Réessayer'),
  noChannelsTitle: m('No channels to report on yet', 'Aucun canal à analyser pour le moment'),
  noChannelsBody: m('Connect a channel and choose it in Settings to see its numbers here.', 'Connectez un canal et sélectionnez-le dans les réglages pour voir ses chiffres ici.'),
  noChannelsAction: m('Manage channels', 'Gérer les canaux'),
  noDataTitle: m('No numbers for this selection', 'Aucun chiffre pour cette sélection'),
  noDataBody: m('Change the period or the channels in the sidebar.', 'Modifiez la période ou les canaux dans la barre latérale.'),
  // ---- Explore ----
  exploreList: m('Metrics', 'Indicateurs'),
  exploreListEmpty: m('No metric matches your search.', 'Aucun indicateur ne correspond à votre recherche.'),
  exploreChoose: m('Choose a metric to see its series and the channels behind it.', 'Choisissez un indicateur pour voir sa série et les canaux concernés.'),
  exploreBack: m('All metrics', 'Tous les indicateurs'),
  exploreAvailable: m('Data available', 'Données disponibles'),
  exploreUnavailable: m('No data stored', 'Aucune donnée enregistrée'),
} as const satisfies Record<string, Message>;

export type InsightsCopyKey = keyof typeof insightsCopyDefaults;
export type InsightsCopy = Record<InsightsCopyKey, string>;
export const insightsCopySchema = bilingualCatalogSchema(insightsCopyDefaults as unknown as Record<string, Message>);

export function resolveInsightsCopy(catalog: Record<string, Message>, locale: 'en' | 'fr'): InsightsCopy {
  return Object.fromEntries(Object.entries(catalog).map(([key, value]) => [key, value[locale]])) as InsightsCopy;
}

/** Fills named placeholders such as {count}; an unknown name stays visible instead of vanishing. */
export const fillInsights = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (token, key: string) => String(values[key] ?? token));

const messageSchema = z.object({ en: z.string().min(1).max(60), fr: z.string().min(1).max(60) }).strict();
const slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,23}$/);

/** Behaviour of the Insights area that Root can tune. Labels in here are customer-visible and bilingual. */
export const insightsPolicySchema = z.object({
  /** Period choices of the date-range picker. `days` ends today (UTC); `month` is the current month so far; `lastMonth` the previous full month. */
  rangePresets: z.array(z.object({ id: slug, label: messageSchema, days: z.number().int().min(1).max(366).optional(), span: z.enum(['month', 'lastMonth']).optional() }).strict().refine(item => (item.days === undefined) !== (item.span === undefined), 'Use days or span.')).min(1).max(8),
  /** Period used when the address carries no dates; must be one of the presets. */
  defaultPreset: slug,
  /** The key numbers. `audience` is the summed latest audience; others pick the first stored channel metric whose label contains one of the words. */
  tiles: z.array(z.object({ id: slug, label: messageSchema, source: z.enum(['audience', 'metric']), words: z.array(z.string().min(2).max(40)).max(12) }).strict()).min(1).max(8),
  /** Tiles shown before "Show all"; pinned metrics follow the tiles. */
  tilesVisible: z.number().int().min(2).max(12),
  /** Most tiles in total (tiles plus pinned metrics). */
  tilesMax: z.number().int().min(2).max(24),
  /** Metrics offered by the main chart's switcher (the tiles first, then the largest series). */
  chartMetricsMax: z.number().int().min(1).max(12),
  /** Rows of the Top posts card, and how many recent posts are ranked to find them. */
  topPostsRows: z.number().int().min(1).max(10),
  topPostsPool: z.number().int().min(1).max(100),
  /** Words of a post measure label used to rank Top posts, first match wins. */
  topPostsRankWords: z.array(z.string().min(2).max(40)).max(12),
  /** Goal bars shown on the Overview. */
  goalsShown: z.number().int().min(1).max(12),
}).strict();
export type InsightsPolicy = z.infer<typeof insightsPolicySchema>;

export const insightsPolicyDefaults: InsightsPolicy = {
  rangePresets: [
    { id: '7', label: { en: 'Last 7 days', fr: '7 derniers jours' }, days: 7 },
    { id: '28', label: { en: 'Last 28 days', fr: '28 derniers jours' }, days: 28 },
    { id: '90', label: { en: 'Last 90 days', fr: '90 derniers jours' }, days: 90 },
    { id: 'month', label: { en: 'This month', fr: 'Ce mois-ci' }, span: 'month' },
    { id: 'last-month', label: { en: 'Last month', fr: 'Mois dernier' }, span: 'lastMonth' },
  ],
  defaultPreset: '28',
  tiles: [
    { id: 'audience', label: { en: 'Audience', fr: 'Audience' }, source: 'audience', words: [] },
    { id: 'views', label: { en: 'Views', fr: 'Vues' }, source: 'metric', words: ['views', 'impressions', 'vues'] },
    { id: 'engagements', label: { en: 'Engagements', fr: 'Interactions' }, source: 'metric', words: ['engage', 'interaction', 'reactions'] },
    { id: 'clicks', label: { en: 'Link clicks', fr: 'Clics sur les liens' }, source: 'metric', words: ['link click', 'clicks', 'clics'] },
  ],
  tilesVisible: 4,
  tilesMax: 8,
  chartMetricsMax: 6,
  topPostsRows: 5,
  topPostsPool: 25,
  topPostsRankWords: ['views', 'impressions', 'vues', 'engage', 'interaction'],
  goalsShown: 4,
};

export const INSIGHTS_CONFIG = [
  entry({ key: 'analytics.insightsCopy', group: 'Analytics · Customer copy', label: 'Insights area copy', kind: 'json', description: 'English and French text of the Insights tabs: Overview, Explore, Audience, Posts, Compare and Reports frames, info (ⓘ) blocks and states. Keep named placeholders such as {count}.', defaultValue: insightsCopyDefaults, schema: insightsCopySchema, consumption: 'active' }),
  entry({ key: 'analytics.insightsPolicy', group: 'Analytics · Insights', label: 'Insights behaviour', kind: 'json', description: 'Period choices and default, the key-number tiles (with the label words that pick each metric), tiles and chart metrics shown, Top posts size and ranking words, and goal bars.', defaultValue: insightsPolicyDefaults, schema: insightsPolicySchema, consumption: 'active' }),
] as const;
