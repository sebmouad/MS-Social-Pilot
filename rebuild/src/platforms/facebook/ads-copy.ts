import { z } from 'zod';
import type { AdsOperationId } from '@/modules/ads/management/types';

/** Templates bind all reviewed identities and spend effects; Root may translate their wording. */
export const FACEBOOK_ADS_COPY = {
  nameInvalid: { en: 'Names must contain 1 to {max} printable characters.', fr: 'Les noms doivent contenir de 1 à {max} caractères imprimables.' },
  statusLabel: { en: 'Pause or resume', fr: 'Suspendre ou reprendre' },
  pause: { en: 'Pause', fr: 'Suspendre' }, resume: { en: 'Resume', fr: 'Reprendre' },
  budgetLabel: { en: 'Change budget', fr: 'Modifier le budget' },
  renameLabel: { en: 'Rename', fr: 'Renommer' },
  assignLabel: { en: 'Assign an existing creative', fr: 'Associer un visuel existant' },
  deleteLabel: { en: 'Delete', fr: 'Supprimer' },
  creativeCreateLabel: { en: 'Create unattached creative', fr: 'Créer un visuel non associé' },
  campaignCreateLabel: { en: 'Create paused campaign', fr: 'Créer une campagne en pause' },
  adCreateLabel: { en: 'Create paused ad', fr: 'Créer une publicité en pause' },
  adSetCreateLabel: { en: 'Create paused ad set', fr: 'Créer un ensemble de publicités en pause' },
  objectAdSet: { en: 'AD SET', fr: 'ENSEMBLE DE PUBLICITÉS' }, objectCampaign: { en: 'CAMPAIGN', fr: 'CAMPAGNE' },
  objectAd: { en: 'AD', fr: 'PUBLICITÉ' }, objectCreative: { en: 'CREATIVE', fr: 'VISUEL' },
  formatImage: { en: 'IMAGE', fr: 'IMAGE' }, formatLink: { en: 'LINK', fr: 'LIEN' },
  budgetDaily: { en: 'DAILY', fr: 'QUOTIDIEN' }, budgetLifetime: { en: 'LIFETIME', fr: 'TOTAL' },
  confirmCreativeCreate: {
    en: 'CREATE UNATTACHED FACEBOOK {format} CREATIVE {nameJson} IN ACCOUNT {adAccountId} AS CHANNEL {targetId} FROM MEDIA {mediaId} WITH CONTENT {content} WITHOUT DELIVERY OR SPEND',
    fr: 'CRÉER UN VISUEL FACEBOOK {format} NON ASSOCIÉ {nameJson} DANS LE COMPTE {adAccountId} POUR LE CANAL {targetId} DEPUIS LE MÉDIA {mediaId} AVEC LE CONTENU {content} SANS DIFFUSION NI DÉPENSE',
  },
  confirmCampaignCreate: {
    en: 'CREATE PAUSED FACEBOOK CAMPAIGN {nameJson} IN ACCOUNT {adAccountId} WITH OBJECTIVE {objective}',
    fr: 'CRÉER UNE CAMPAGNE FACEBOOK EN PAUSE {nameJson} DANS LE COMPTE {adAccountId} AVEC L’OBJECTIF {objective}',
  },
  confirmAdSetCreate: {
    en: 'CREATE PAUSED FACEBOOK AD SET {nameJson} UNDER CAMPAIGN {parentId} IN ACCOUNT {adAccountId} WITH DAILY BUDGET {dailyBudgetMinor} MINOR UNITS{currencySuffix} TARGETING {countryCode} OPTIMIZED FOR {optimizationGoal}',
    fr: 'CRÉER UN ENSEMBLE FACEBOOK EN PAUSE {nameJson} DANS LA CAMPAGNE {parentId} DU COMPTE {adAccountId} AVEC UN BUDGET QUOTIDIEN DE {dailyBudgetMinor} UNITÉS MINEURES{currencySuffix} CIBLANT {countryCode} OPTIMISÉ POUR {optimizationGoal}',
  },
  confirmAdCreate: {
    en: 'CREATE PAUSED FACEBOOK AD {nameJson} UNDER AD SET {parentId} IN ACCOUNT {adAccountId} WITH CREATIVE {creativeId}',
    fr: 'CRÉER UNE PUBLICITÉ FACEBOOK EN PAUSE {nameJson} DANS L’ENSEMBLE {parentId} DU COMPTE {adAccountId} AVEC LE VISUEL {creativeId}',
  },
  confirmResume: { en: 'RESUME FACEBOOK {objectType} {objectId} ALLOWING DELIVERY AND SPEND IN ACCOUNT {adAccountId}', fr: 'REPRENDRE FACEBOOK {objectType} {objectId} EN AUTORISANT DIFFUSION ET DÉPENSE DANS LE COMPTE {adAccountId}' },
  confirmPause: { en: 'PAUSE FACEBOOK {objectType} {objectId} IN ACCOUNT {adAccountId}', fr: 'SUSPENDRE FACEBOOK {objectType} {objectId} DANS LE COMPTE {adAccountId}' },
  confirmBudget: { en: 'SET FACEBOOK {objectType} {objectId} {budgetKind} BUDGET TO {minor} MINOR UNITS{currencySuffix} IN ACCOUNT {adAccountId}', fr: 'FIXER LE BUDGET {budgetKind} FACEBOOK {objectType} {objectId} À {minor} UNITÉS MINEURES{currencySuffix} DANS LE COMPTE {adAccountId}' },
  confirmRename: { en: 'RENAME FACEBOOK {objectType} {objectId} TO {nameJson} IN ACCOUNT {adAccountId}', fr: 'RENOMMER FACEBOOK {objectType} {objectId} EN {nameJson} DANS LE COMPTE {adAccountId}' },
  confirmAssign: { en: 'ASSIGN FACEBOOK CREATIVE {creativeId} TO FACEBOOK {objectType} {objectId} IN ACCOUNT {adAccountId}', fr: 'ASSOCIER LE VISUEL FACEBOOK {creativeId} À FACEBOOK {objectType} {objectId} DANS LE COMPTE {adAccountId}' },
  confirmDelete: { en: 'DELETE FACEBOOK {objectType} {objectId} PERMANENTLY IN ACCOUNT {adAccountId}', fr: 'SUPPRIMER DÉFINITIVEMENT FACEBOOK {objectType} {objectId} DANS LE COMPTE {adAccountId}' },
};
export type FacebookAdsCopy = typeof FACEBOOK_ADS_COPY;
export type FacebookAdsText = (key: keyof FacebookAdsCopy, values?: Record<string, string | number>) => string;
const tokens = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
export const FACEBOOK_ADS_COPY_SCHEMA = z.object(Object.fromEntries(Object.entries(FACEBOOK_ADS_COPY).map(([key, defaults]) => [key, z.object({ en: z.string().trim().min(1).max(4000), fr: z.string().trim().min(1).max(4000) }).strict().superRefine((value, ctx) => {
  for (const locale of ['en', 'fr'] as const) if (tokens(value[locale]) !== tokens(defaults.en)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [locale], message: 'Keep every template placeholder exactly once.' });
})])) as unknown as { [K in keyof FacebookAdsCopy]: z.ZodType<{ en: string; fr: string }> }).strict();
export function facebookAdsText(copy: FacebookAdsCopy = FACEBOOK_ADS_COPY, locale: 'en' | 'fr' = 'en'): FacebookAdsText {
  return (key, values = {}) => copy[key][locale].replace(/\{(\w+)\}/g, (whole, name: string) => Object.hasOwn(values, name) ? String(values[name]) : whole);
}
export const defaultFacebookAdsText = facebookAdsText();
export const operationLabelKeys = {
  'status.set': 'statusLabel', 'budget.set': 'budgetLabel', rename: 'renameLabel', 'creative.assign': 'assignLabel', delete: 'deleteLabel', 'creative.create': 'creativeCreateLabel', 'campaign.create': 'campaignCreateLabel', 'ad.create': 'adCreateLabel', 'adset.create': 'adSetCreateLabel',
} as const satisfies Record<AdsOperationId, keyof FacebookAdsCopy>;
