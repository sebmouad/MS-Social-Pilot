import { bilingualCatalog } from './catalog';
import { z } from 'zod';
import { copySchema } from '@/lib/config/copy-schema';
import type { AuthLocale } from './auth/copy';

const en = {
  homeUnavailable: 'Home is unavailable in this workspace.', supportedAction: 'Choose a supported Home action.',
  eyebrow: 'Workspace overview', lead: 'How your channels are doing, and what comes next.', metrics: 'Workspace figures',
  channels: 'Connected channels', adAccounts: 'Linked ad accounts', published: 'Published posts', scheduled: 'Scheduled posts',
  firstStep: 'First step', startTitle: 'Choose the channels you want to manage',
  startBody: 'Connect a platform, then select the channels and ad accounts to add to this workspace. Only selected sources appear in publishing and reports.', startAction: 'Connect channels',
  continueTitle: 'Continue your work', posts: 'Browse posts', connections: 'View connections', analytics: 'Explore analytics', ads: 'View ad accounts',
  greeting: 'Welcome back', period: 'Last {n} days (UTC; today so far)', openModule: 'Open {name}',
  moduleNames: { publishing: 'Publishing', inbox: 'Inbox', analytics: 'Insights', ads: 'Ads' },
  unavailableTitle: 'Not available right now', unavailableBody: 'This figure could not be loaded. Try again in a moment.',
  audience: 'Audience', audienceOf: '{covered} of {selected} channels have a count', audienceAsOf: 'Most recent count: {date}; other channels may be older',
  audienceNote: 'Added across channels; a person who follows several may be counted more than once.',
  audienceTrend: 'Audience over the last {n} days',
  audienceEmptyTitle: 'No audience counts yet', audienceEmptyBody: 'Counts appear once your channels have been synced.', audienceEmptyAction: 'Open analytics',
  views: 'Views', engagements: 'Engagements', vsPrevious: 'vs the previous {n} days', noComparison: 'No comparison yet',
  comparableNote: 'Compared over {comparable} of {covered} channels with figures in both periods.',
  unknownFigure: 'Not available', channelsNote: 'Showing {covered} of {channels} channels', truncatedNote: 'Showing the first {n} channels only.',
  perfEmptyTitle: 'No performance figures yet', perfEmptyBody: 'Views and engagements appear after your channels publish and sync.', perfEmptyAction: 'Open analytics',
  topChannels: 'Top channels', topChannelsLabel: 'Engagements by channel, last {n} days', topChannelsSeries: 'Engagements',
  topEmpty: 'No channel has engagement figures yet.',
  interactions: 'Interaction mix', interactionsLabel: 'Interactions by type, last {n} days', interactionsTotal: 'Interactions', interactionsEmpty: 'No interaction breakdown is stored yet.',
  bestTimes: 'Best times to post', bestTimesLabel: 'Typical engagement by weekday and hour', bestTimesValue: 'Compared with a typical post',
  bestTimesNote: 'Each channel is compared with its own typical post, then averaged. A pattern from past posts, not a promise.',
  bestTimesEmptyTitle: 'Not enough history yet', bestTimesEmptyBody: 'Publish a few more posts and the best days and hours will show here.', bestTimesEmptyAction: 'Write a post',
  upcoming: 'Coming up', upcomingMore: '{n} scheduled in total', viewQueue: 'See all scheduled posts',
  modeApp: 'Sent by the app', modePlatform: 'Held on the platform', modeMixed: 'App and platform',
  upcomingEmptyTitle: 'Nothing scheduled', upcomingEmptyBody: 'Schedule a post and it will appear here with the time it goes out.', upcomingEmptyAction: 'Create a post',
  inbox: 'Inbox', inboxOpen: 'conversations waiting', inboxZero: 'You are all caught up.', inboxAction: 'Open inbox',
  adSpend: 'Ad spend', adSpendNote: '{from}–{to} (UTC). Stored results on {recorded} of {n} days. Latest stored day: {latest}. Missing results are not zero spend; account coverage may vary.', adSpendTrend: 'Stored daily ad spend, last {n} days',
  adsEmptyTitle: 'No ad spend yet', adsEmptyBody: 'Spend shows here once your ad accounts have stored results.', adsEmptyAction: 'Open ads',
  attention: 'Needs attention', attentionFailed: 'Failed posts: {n}', attentionPartial: 'Partly failed posts: {n}',
  attentionApprovals: 'Waiting for your approval: {n}', attentionReconnect: 'Reconnect {name}', attentionReconnectMany: '{n} connections need reconnecting',
  attentionConversations: 'Waiting conversations: {n}', attentionReview: 'Review', attentionPartialNote: 'Some counts could not be loaded.',
  linkClicks: 'Link clicks', openCalendar: 'Open calendar', retry: 'Retry', audienceDeltaSince: 'since {date}',
};

const fr: typeof en = {
  homeUnavailable: 'L’accueil est indisponible dans cet espace.', supportedAction: 'Choisissez une action d’accueil prise en charge.',
  eyebrow: 'Vue d’ensemble de l’espace', lead: 'Comment vont vos canaux, et ce qui arrive ensuite.', metrics: 'Chiffres de l’espace',
  channels: 'Canaux connectés', adAccounts: 'Comptes publicitaires liés', published: 'Publications publiées', scheduled: 'Publications planifiées',
  firstStep: 'Première étape', startTitle: 'Choisissez les canaux à gérer',
  startBody: 'Connectez une plateforme, puis sélectionnez les canaux et comptes publicitaires à ajouter à cet espace. Seules les sources sélectionnées apparaissent dans la publication et les rapports.', startAction: 'Connecter des canaux',
  continueTitle: 'Reprenez votre travail', posts: 'Parcourir les publications', connections: 'Voir les connexions', analytics: 'Explorer les statistiques', ads: 'Voir les comptes publicitaires',
  greeting: 'Bon retour', period: '{n} derniers jours (UTC ; aujourd’hui en cours)', openModule: 'Ouvrir {name}',
  moduleNames: { publishing: 'Publication', inbox: 'Boîte de réception', analytics: 'Statistiques', ads: 'Publicités' },
  unavailableTitle: 'Indisponible pour le moment', unavailableBody: 'Ce chiffre n’a pas pu être chargé. Réessayez dans un instant.',
  audience: 'Audience', audienceOf: '{covered} canaux sur {selected} ont un chiffre', audienceAsOf: 'Chiffre le plus récent : {date} ; d’autres canaux peuvent être plus anciens',
  audienceNote: 'Additionnée entre les canaux ; une personne qui en suit plusieurs peut être comptée plusieurs fois.',
  audienceTrend: 'Audience sur les {n} derniers jours',
  audienceEmptyTitle: 'Pas encore d’audience', audienceEmptyBody: 'Les chiffres apparaissent dès que vos canaux sont synchronisés.', audienceEmptyAction: 'Ouvrir les statistiques',
  views: 'Vues', engagements: 'Interactions', vsPrevious: 'par rapport aux {n} jours précédents', noComparison: 'Pas encore de comparaison',
  comparableNote: 'Comparé sur {comparable} canaux sur {covered} ayant des chiffres aux deux périodes.',
  unknownFigure: 'Non disponible', channelsNote: '{covered} canaux affichés sur {channels}', truncatedNote: 'Seuls les {n} premiers canaux sont affichés.',
  perfEmptyTitle: 'Pas encore de performances', perfEmptyBody: 'Les vues et interactions apparaissent après les publications et la synchronisation de vos canaux.', perfEmptyAction: 'Ouvrir les statistiques',
  topChannels: 'Meilleurs canaux', topChannelsLabel: 'Interactions par canal, {n} derniers jours', topChannelsSeries: 'Interactions',
  topEmpty: 'Aucun canal n’a encore de chiffres d’interactions.',
  interactions: 'Répartition des interactions', interactionsLabel: 'Interactions par type, {n} derniers jours', interactionsTotal: 'Interactions', interactionsEmpty: 'Aucune répartition des interactions n’est encore enregistrée.',
  bestTimes: 'Meilleurs moments pour publier', bestTimesLabel: 'Interactions habituelles par jour et par heure', bestTimesValue: 'Par rapport à une publication habituelle',
  bestTimesNote: 'Chaque canal est comparé à sa propre publication habituelle, puis les résultats sont moyennés. Une tendance passée, pas une promesse.',
  bestTimesEmptyTitle: 'Pas encore assez d’historique', bestTimesEmptyBody: 'Publiez encore quelques posts et les meilleurs jours et heures s’afficheront ici.', bestTimesEmptyAction: 'Écrire une publication',
  upcoming: 'À venir', upcomingMore: '{n} planifiées au total', viewQueue: 'Voir toutes les publications planifiées',
  modeApp: 'Envoyée par l’application', modePlatform: 'Conservée sur la plateforme', modeMixed: 'Application et plateforme',
  upcomingEmptyTitle: 'Rien de planifié', upcomingEmptyBody: 'Planifiez une publication : elle apparaîtra ici avec son heure d’envoi.', upcomingEmptyAction: 'Créer une publication',
  inbox: 'Boîte de réception', inboxOpen: 'conversations en attente', inboxZero: 'Tout est à jour.', inboxAction: 'Ouvrir la boîte de réception',
  adSpend: 'Dépenses publicitaires', adSpendNote: '{from}–{to} (UTC). Résultats enregistrés pour {recorded} jours sur {n}. Dernier jour enregistré : {latest}. Les résultats manquants ne sont pas des dépenses nulles ; la couverture des comptes peut varier.', adSpendTrend: 'Dépenses quotidiennes enregistrées, {n} derniers jours',
  adsEmptyTitle: 'Pas encore de dépenses', adsEmptyBody: 'Les dépenses apparaissent dès que vos comptes publicitaires ont des résultats enregistrés.', adsEmptyAction: 'Ouvrir les publicités',
  attention: 'À traiter', attentionFailed: 'Publications en échec : {n}', attentionPartial: 'Publications partiellement en échec : {n}',
  attentionApprovals: 'En attente de votre approbation : {n}', attentionReconnect: 'Reconnecter {name}', attentionReconnectMany: '{n} connexions à reconnecter',
  attentionConversations: 'Conversations en attente : {n}', attentionReview: 'Voir', attentionPartialNote: 'Certains chiffres n’ont pas pu être chargés.',
  linkClicks: 'Clics sur les liens', openCalendar: 'Ouvrir le calendrier', retry: 'Réessayer', audienceDeltaSince: 'depuis le {date}',
};

/** Replace `{name}` placeholders in a copy string. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}

export const homeCopyDefaults = { en, fr };
export type HomeCopy = typeof en;
/** Browser-safe defaults; server screens supply the current Root catalog. */
export const homeCopy = (locale: AuthLocale, catalog: typeof homeCopyDefaults = homeCopyDefaults): HomeCopy => catalog[locale];

const homeCatalog = bilingualCatalog(homeCopyDefaults);
export const homeCopyCatalogDefaults = homeCatalog.catalog;
export const homeCopySchema = homeCatalog.schema;
export const homeLocaleCopy = homeCatalog.view;
