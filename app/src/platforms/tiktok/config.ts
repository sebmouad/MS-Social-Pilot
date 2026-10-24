import { z } from 'zod';
import { entry } from '@/lib/config/entry';

const bilingual = z.object({ en: z.string().min(1), fr: z.string().min(1) });
const httpsUrl = z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.hash; }, 'Use an HTTPS URL without credentials.');
const scopeList = z.array(z.string().regex(/^[a-z_.]+$/)).min(1);

const copy = {
  video: { en: 'Video', fr: 'Vidéo' },
  account: { en: 'TikTok account', fr: 'Compte TikTok' },
  publishing: { en: 'Publishing', fr: 'Publication' },
  unavailable: { en: 'TikTok could not complete this request. Please try again later.', fr: 'TikTok n’a pas pu terminer cette demande. Réessayez plus tard.' },
  invalid: { en: 'Check that the post has one video and try again.', fr: 'Vérifiez que la publication contient une vidéo, puis réessayez.' },
  videoRequired: { en: 'A TikTok post needs a video.', fr: 'Une publication TikTok nécessite une vidéo.' },
  tooLarge: { en: 'TikTok videos up to the size allowed here are supported.', fr: 'Les vidéos TikTok sont acceptées jusqu’à la taille autorisée ici.' },
  permission: { en: 'Reconnect this account to allow this action.', fr: 'Reconnectez ce compte pour autoriser cette action.' },
  uncertain: { en: 'The upload could not be confirmed. Check the account before sending it again.', fr: 'L’envoi n’a pas pu être confirmé. Vérifiez le compte avant de le renvoyer.' },
  processingFailed: { en: 'TikTok could not process this video. Check the file before trying again.', fr: 'TikTok n’a pas pu traiter cette vidéo. Vérifiez le fichier avant de réessayer.' },
};

export const tiktokPolicySchema = z.object({
  authorizeUrl: httpsUrl,
  /** Content Posting and Login Kit API root; request paths below are protocol invariants of the adapter. */
  apiBaseUrl: httpsUrl,
  connectScopes: scopeList, publishScopes: scopeList,
  requestTimeoutMs: z.number().int().min(1).max(120000),
  uploadTimeoutMs: z.number().int().min(1000).max(7200000),
  mediaFetchTimeoutMs: z.number().int().min(1000).max(7200000),
  /** Videos are sent as one chunk, so this is also TikTok's single-chunk ceiling. */
  maxVideoBytes: z.number().int().min(1).max(68719476736),
  captionMaxCharacters: z.number().int().min(1).max(2200),
  /** Most open level first. The first one the creator's account allows is used; unaudited apps only get the private level. */
  privacyPreference: z.array(z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'])).min(1),
  statusPollAttempts: z.number().int().min(0).max(60), statusPollIntervalMs: z.number().int().min(100).max(60000),
  oauthStateMinutes: z.number().int().min(1).max(60),
  renewLeadSeconds: z.number().int().min(60).max(86400),
  copy: z.object(Object.fromEntries(Object.keys(copy).map(key => [key, bilingual.default(copy[key as keyof typeof copy])])) as { [K in keyof typeof copy]: z.ZodDefault<typeof bilingual> }),
});
export type TiktokPolicy = z.infer<typeof tiktokPolicySchema>;

export const TIKTOK_POLICY_DEFAULTS: TiktokPolicy = {
  authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/', apiBaseUrl: 'https://open.tiktokapis.com/v2',
  connectScopes: ['user.info.basic', 'video.publish'], publishScopes: ['user.info.basic', 'video.publish'],
  requestTimeoutMs: 30000, uploadTimeoutMs: 900000, mediaFetchTimeoutMs: 900000, maxVideoBytes: 67108864, captionMaxCharacters: 2200,
  privacyPreference: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'],
  statusPollAttempts: 6, statusPollIntervalMs: 5000, oauthStateMinutes: 10, renewLeadSeconds: 7200, copy,
};

export const TIKTOK_CONFIG = [
  entry({ key: 'platforms.tiktok.enabled', group: 'TikTok · Engine', label: 'TikTok enabled', kind: 'boolean', description: 'Make TikTok available to workspaces. When off, customers cannot see or connect TikTok; connected data remains stored.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.tiktok.includedByDefault', group: 'TikTok · Access', label: 'Included by default', kind: 'boolean', description: 'Give every workspace TikTok without a plan feature.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.tiktok.planFeatures', group: 'TikTok · Access', label: 'Plan access keys', kind: 'json', description: 'Plan feature keys that grant TikTok access.', defaultValue: ['platform_tiktok'], schema: z.array(z.string().min(1)), consumption: 'active' }),
  entry({ key: 'tiktok.policy', group: 'TikTok · API and operations', label: 'TikTok adapter policy', kind: 'json', description: 'TikTok endpoints, requested and required scopes, timeouts, upload size, caption limit, privacy preference, processing check bounds, token renewal lead time and English/French copy. Does not grant provider permissions; TikTok only allows private posts until it has audited the app.', defaultValue: TIKTOK_POLICY_DEFAULTS, schema: tiktokPolicySchema, consumption: 'active' }),
  entry({ key: 'tiktok.clientKey', group: 'TikTok · Credentials', label: 'TikTok client key', kind: 'text', description: 'Client key of the TikTok developer app with Login Kit and Content Posting API. The redirect URI to register is the public origin plus /api/connections/tiktok/callback.', defaultValue: '', schema: z.string().max(512), consumption: 'active' }),
  entry({ key: 'tiktok.clientSecret', group: 'TikTok · Credentials', label: 'TikTok client secret', kind: 'secret', description: 'Client secret for the client key above.', defaultValue: '', schema: z.string().max(2048), consumption: 'active' }),
].map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: 'tiktok' } }));
