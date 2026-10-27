import { z } from 'zod';
import type { AdsOperationId } from '@/modules/ads/management/types';

/** Templates bind all reviewed identities and spend effects; Root may translate their wording. */
export const FACEBOOK_ADS_COPY = {
  objectiveInvalid: { en: "Choose a supported campaign objective.", fr: "Choisissez un objectif de campagne pris en charge." },
  objectInvalid: { en: "Invalid ad object.", fr: "Choisissez un élément publicitaire valide." },
  parentCampaignInvalid: { en: "Choose a valid parent campaign.", fr: "Choisissez une campagne parente valide." },
  dailyBudgetInvalid: { en: "Daily budgets must be positive whole minor currency units.", fr: "Le budget quotidien doit être un entier positif dans la plus petite unité de la devise." },
  budgetLimitExceeded: { en: "This budget is above the limit allowed for a single change.", fr: "Ce budget dépasse la limite autorisée pour une seule modification." },
  countryCodeInvalid: { en: 'Country code must be a two-letter uppercase code.', fr: 'Le code pays doit contenir deux lettres majuscules.' },
  countryOptimizationInvalid: { en: 'Choose a valid country code and optimization goal.', fr: 'Choisissez un code pays et un objectif d’optimisation valides.' },
  countryInvalid: { en: "Choose a valid country.", fr: "Choisissez un pays valide." },
  optimizationInvalid: { en: "Choose a valid optimization goal.", fr: "Choisissez un objectif d’optimisation valide." },
  changeUnavailable: { en: "This change is not available.", fr: "Cette modification n’est pas disponible." },
  parentAdSetInvalid: { en: "Choose a valid parent ad set.", fr: "Choisissez un ensemble de publicités parent valide." },
  creativeInvalid: { en: "Choose a valid creative.", fr: "Choisissez un visuel valide." },
  creativeDetailsInvalid: { en: "Enter valid creative details.", fr: "Saisissez des informations valides pour le visuel." },
  destinationInvalid: { en: "Enter an HTTPS destination.", fr: "Saisissez une destination HTTPS." },
  destinationCredentialsInvalid: { en: "Enter an HTTPS destination without credentials.", fr: "Saisissez une destination HTTPS sans identifiants de connexion." },
  imageTextOnly: { en: "Image creatives use message text only.", fr: "Les visuels de type image utilisent uniquement le texte du message." },
  budgetInvalid: { en: "Budgets must be positive whole minor currency units.", fr: "Le budget doit être un entier positif dans la plus petite unité de la devise." },
  creationPolicyUnavailable: { en: "Creation policy is unavailable.", fr: "La création est temporairement indisponible. Réessayez plus tard." },
  creationOptionInvalid: { en: "Choose a current creation option and valid name.", fr: "Choisissez une option de création disponible et un nom valide." },
  accountInvalid: { en: "Invalid ad account.", fr: "Choisissez un compte publicitaire valide." },
  ownershipAdSetMismatch: { en: 'This ad set does not belong to the selected ad account.', fr: 'Cet ensemble de publicités n’appartient pas au compte publicitaire sélectionné.' },
  ownershipCampaignMismatch: { en: 'This campaign does not belong to the selected ad account.', fr: 'Cette campagne n’appartient pas au compte publicitaire sélectionné.' },
  ownershipMismatch: { en: "This item does not belong to the selected ad account.", fr: "Cet élément n’appartient pas au compte publicitaire sélectionné." },
  creationUnconfirmed: { en: "Facebook did not confirm the new object.", fr: "Facebook n’a pas confirmé la création. Vérifiez le compte avant de réessayer." },
  changeUnconfirmed: { en: "Facebook did not confirm the change.", fr: "Facebook n’a pas confirmé la modification. Vérifiez le compte avant de réessayer." },
  creativeSourceInvalid: { en: "Choose an available Page identity and stored image.", fr: "Choisissez une Page disponible et une image enregistrée." },
  imageUnsupported: { en: "Choose a supported stored image within the upload limit.", fr: "Choisissez une image enregistrée compatible qui respecte la limite de taille." },
  creativeUnconfirmed: { en: "Creative creation is unconfirmed; an uploaded image may remain. Check the ad account before trying again.", fr: "La création du visuel n’est pas confirmée et une image peut avoir été ajoutée. Vérifiez le compte publicitaire avant de réessayer." },
  connectionUnavailable: { en: "Facebook could not be reached.", fr: "Impossible de joindre Facebook. Réessayez plus tard." },
  responseUnreadable: { en: "Facebook returned an unreadable response.", fr: "La réponse de Facebook n’a pas pu être lue. Vérifiez le compte avant de réessayer." },
  providerFailure: { en: "Facebook could not complete this request.", fr: "Facebook n’a pas pu terminer cette demande. Vérifiez le compte avant de réessayer." },
  cancelledBeforeDispatch: { en: "The operation was cancelled before dispatch.", fr: "L’opération a été annulée avant son envoi." },
  signingUnavailable: { en: "Facebook connection is temporarily unavailable.", fr: "La connexion Facebook est temporairement indisponible. Réessayez plus tard." },
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
  confirmCreativeFromPost: {
    en: 'CREATE UNATTACHED FACEBOOK CREATIVE {nameJson} IN ACCOUNT {adAccountId} FROM POST {postId} OF CHANNEL {targetId} WITHOUT DELIVERY OR SPEND',
    fr: 'CRÉER UN VISUEL FACEBOOK NON ASSOCIÉ {nameJson} DANS LE COMPTE {adAccountId} DEPUIS LA PUBLICATION {postId} DU CANAL {targetId} SANS DIFFUSION NI DÉPENSE',
  },
  confirmAdSetTargeting: {
    en: 'ALSO IN {countries} FOR AGES {ages} UNTIL {endDate}',
    fr: 'AUSSI EN {countries} POUR LES ÂGES {ages} JUSQU’AU {endDate}',
  },
  targetingAny: { en: 'NONE', fr: 'AUCUN' }, targetingAllAges: { en: 'ALL', fr: 'TOUS' }, targetingNoEnd: { en: 'NO END DATE', fr: 'SANS DATE DE FIN' },
  targetingInvalid: { en: 'Choose valid countries, ages 18 to 65 (minimum not above maximum) and an end date after today.', fr: 'Choisissez des pays valides, des âges de 18 à 65 ans (minimum inférieur au maximum) et une date de fin après aujourd’hui.' },
  copyLabel: { en: 'Duplicate (paused)', fr: 'Dupliquer (en pause)' },
  confirmCopy: {
    en: 'DUPLICATE FACEBOOK {objectType} {objectId} IN ACCOUNT {adAccountId} AS A PAUSED COPY',
    fr: 'DUPLIQUER {objectType} FACEBOOK {objectId} DANS LE COMPTE {adAccountId} EN COPIE EN PAUSE',
  },
  copyUnconfirmed: { en: 'The copy was requested but Facebook did not confirm it. Check Ads Manager before trying again.', fr: 'La copie a été demandée mais Facebook ne l’a pas confirmée. Vérifiez le Gestionnaire de publicités avant de réessayer.' },
  postInvalid: { en: 'Choose a published post of this Page.', fr: 'Choisissez une publication de cette Page.' },
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
  'status.set': 'statusLabel', 'budget.set': 'budgetLabel', rename: 'renameLabel', 'creative.assign': 'assignLabel', delete: 'deleteLabel', 'creative.create': 'creativeCreateLabel', 'campaign.create': 'campaignCreateLabel', 'ad.create': 'adCreateLabel', 'adset.create': 'adSetCreateLabel', 'object.copy': 'copyLabel',
} as const satisfies Record<AdsOperationId, keyof FacebookAdsCopy>;
