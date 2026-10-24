import { z } from 'zod';
import { entry } from '@/lib/config/entry';

type Message = { en: string; fr: string };
const m = (en: string, fr: string): Message => ({ en, fr });
const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort().join('|');

/** Root may rewrite the copy but each message keeps the named data placeholders it needs. */
function catalogSchema<T extends Record<string, Message>>(defaults: T) {
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
 * Customer copy of Ads › Accounts (design v2 S12): the one-table Accounts view. The long existing
 * Ads catalogs (`ads.customerCopy`) keep their own text; this catalog holds only what the v2 frame added.
 */
export const adsInsightsCopyDefaults = {
  info: m('Paid results for your ad accounts. Amounts are shown per currency and never added across currencies.', 'Résultats payants de vos comptes publicitaires. Les montants sont affichés par devise et jamais additionnés entre devises.'),
  tabs: m('Ads sections', 'Sections publicité'),
  tabAccounts: m('Accounts', 'Comptes'),
  tabCampaigns: m('Campaigns', 'Campagnes'),
  tabManage: m('Manage', 'Gérer'),
  tabAnalysis: m('Analysis', 'Analyse'),
  caption: m('Ad accounts with their results for the selected period', 'Comptes publicitaires et leurs résultats pour la période sélectionnée'),
  colAccount: m('Account', 'Compte'),
  colStatus: m('Status', 'Statut'),
  colSpend: m('Spend', 'Dépenses'),
  colImpressions: m('Impressions', 'Impressions'),
  colClicks: m('Clicks', 'Clics'),
  colCtr: m('Click rate', 'Taux de clic'),
  colCpc: m('Cost per click', 'Coût par clic'),
  colSynced: m('Last synced', 'Dernière synchro.'),
  statusActive: m('Active', 'Actif'),
  statusOff: m('Off', 'Désactivé'),
  neverSynced: m('Not synced yet', 'Pas encore synchronisé'),
  noResults: m('No results stored for this period', 'Aucun résultat enregistré pour cette période'),
  openDetails: m('Details for {name}', 'Détails de {name}'),
  detailsClose: m('Close details', 'Fermer les détails'),
  detailsActions: m('Actions reported', 'Actions signalées'),
  detailsNoActions: m('No actions are stored for this account and period.', 'Aucune action n’est enregistrée pour ce compte et cette période.'),
  detailsCampaigns: m('See campaigns', 'Voir les campagnes'),
  totalsNote: m('Spend is shown per currency. Totals are never added across currencies.', 'Les dépenses sont affichées par devise. Les totaux ne sont jamais additionnés entre devises.'),
  accountFilter: m('Ad accounts', 'Comptes publicitaires'),
  accountAll: m('All ad accounts', 'Tous les comptes publicitaires'),
  emptyTitle: m('No ad accounts yet', 'Aucun compte publicitaire pour le moment'),
  emptyBody: m('Connect a channel with an ad account and select it in Settings.', 'Connectez un canal doté d’un compte publicitaire et sélectionnez-le dans les réglages.'),
  emptyAction: m('Manage channels', 'Gérer les canaux'),
} as const satisfies Record<string, Message>;

export type AdsInsightsKey = keyof typeof adsInsightsCopyDefaults;
export type AdsInsightsCopy = Record<AdsInsightsKey, string>;
export const adsInsightsCopySchema = catalogSchema(adsInsightsCopyDefaults as unknown as Record<string, Message>);

export function resolveAdsInsightsCopy(catalog: Record<string, Message>, locale: 'en' | 'fr'): AdsInsightsCopy {
  return Object.fromEntries(Object.entries(catalog).map(([key, value]) => [key, value[locale]])) as AdsInsightsCopy;
}

export const fillAds = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (token, key: string) => String(values[key] ?? token));

/** Rows per page, periods and limits of the Accounts table come from the existing Ads read and report policies. */
export const ADS_INSIGHTS_CONFIG = [
  entry({ key: 'ads.insightsCopy', group: 'Ads · Customer copy', label: 'Ads › Accounts copy', kind: 'json', description: 'English and French text of the Ads area Accounts tab: the one-table Accounts view. Keep named placeholders such as {name}.', defaultValue: adsInsightsCopyDefaults, schema: adsInsightsCopySchema, consumption: 'active' }),
] as const;
