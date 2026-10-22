import { z } from 'zod';
import { entry } from '@/lib/config/entry';

const bilingual = z.object({ en: z.string().min(1), fr: z.string().min(1) });
const httpsUrl = z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.hash; }, 'Use an HTTPS URL without credentials.');
const scopeList = z.array(z.string().url()).min(1);

const copy = {
  video: { en: 'Video', fr: 'Vidéo' },
  channel: { en: 'YouTube channel', fr: 'Chaîne YouTube' },
  defaultTitle: { en: 'Video', fr: 'Vidéo' },
  publishing: { en: 'Publishing', fr: 'Publication' },
  manage: { en: 'Deleting videos', fr: 'Suppression de vidéos' },
  unavailable: { en: 'YouTube could not complete this request. Please try again later.', fr: 'YouTube n’a pas pu terminer cette demande. Réessayez plus tard.' },
  invalid: { en: 'Check that the post has one video and try again.', fr: 'Vérifiez que la publication contient une vidéo, puis réessayez.' },
  videoRequired: { en: 'A YouTube post needs a video.', fr: 'Une publication YouTube nécessite une vidéo.' },
  tooLarge: { en: 'This video is larger than the size YouTube publishing allows here.', fr: 'Cette vidéo dépasse la taille autorisée pour la publication YouTube.' },
  permission: { en: 'Reconnect this channel to allow this action.', fr: 'Reconnectez cette chaîne pour autoriser cette action.' },
  uncertain: { en: 'The upload could not be confirmed. Check the channel before sending it again.', fr: 'L’envoi n’a pas pu être confirmé. Vérifiez la chaîne avant de le renvoyer.' },
  noChannel: { en: 'This Google account has no YouTube channel.', fr: 'Ce compte Google n’a aucune chaîne YouTube.' },
};

export const youtubePolicySchema = z.object({
  authorizeUrl: httpsUrl, tokenUrl: httpsUrl, apiBaseUrl: httpsUrl, uploadUrl: httpsUrl,
  /** Requested at connection. `publishScopes` and `deleteScopes` are what each operation needs granted. */
  connectScopes: scopeList, publishScopes: scopeList, deleteScopes: scopeList,
  requestTimeoutMs: z.number().int().min(1).max(120000),
  uploadStartTimeoutMs: z.number().int().min(1).max(300000),
  uploadTimeoutMs: z.number().int().min(1000).max(7200000),
  mediaFetchTimeoutMs: z.number().int().min(1000).max(7200000),
  maxVideoBytes: z.number().int().min(1).max(137438953472),
  titleMaxCharacters: z.number().int().min(1).max(100),
  descriptionMaxCharacters: z.number().int().min(1).max(5000),
  channelPageSize: z.number().int().min(1).max(50), channelMaxPages: z.number().int().min(1).max(50),
  privacyStatus: z.enum(['public', 'unlisted', 'private']),
  selfDeclaredMadeForKids: z.boolean(),
  oauthStateMinutes: z.number().int().min(1).max(60),
  /** Renew the access token this long before it ends (publishing and the background renewal). */
  renewLeadSeconds: z.number().int().min(60).max(3600),
  copy: z.object(Object.fromEntries(Object.keys(copy).map(key => [key, bilingual.default(copy[key as keyof typeof copy])])) as { [K in keyof typeof copy]: z.ZodDefault<typeof bilingual> }),
});
export type YoutubePolicy = z.infer<typeof youtubePolicySchema>;

export const YOUTUBE_POLICY_DEFAULTS: YoutubePolicy = {
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth', tokenUrl: 'https://oauth2.googleapis.com/token',
  apiBaseUrl: 'https://www.googleapis.com/youtube/v3', uploadUrl: 'https://www.googleapis.com/upload/youtube/v3/videos',
  connectScopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube.force-ssl'],
  publishScopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'],
  deleteScopes: ['https://www.googleapis.com/auth/youtube.force-ssl'],
  requestTimeoutMs: 30000, uploadStartTimeoutMs: 30000, uploadTimeoutMs: 900000, mediaFetchTimeoutMs: 900000,
  maxVideoBytes: 2147483648, titleMaxCharacters: 100, descriptionMaxCharacters: 5000, channelPageSize: 50, channelMaxPages: 5,
  privacyStatus: 'public', selfDeclaredMadeForKids: false, oauthStateMinutes: 10, renewLeadSeconds: 1200, copy,
};

export const YOUTUBE_CONFIG = [
  entry({ key: 'platforms.youtube.enabled', group: 'YouTube · Engine', label: 'YouTube enabled', kind: 'boolean', description: 'Make YouTube available to workspaces. When off, customers cannot see or connect YouTube; connected data remains stored.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.youtube.includedByDefault', group: 'YouTube · Access', label: 'Included by default', kind: 'boolean', description: 'Give every workspace YouTube without a plan feature.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.youtube.planFeatures', group: 'YouTube · Access', label: 'Plan access keys', kind: 'json', description: 'Plan feature keys that grant YouTube access.', defaultValue: ['platform_youtube'], schema: z.array(z.string().min(1)), consumption: 'active' }),
  entry({ key: 'youtube.policy', group: 'YouTube · API and operations', label: 'YouTube adapter policy', kind: 'json', description: 'Google endpoints, requested and required scopes, timeouts, upload size, title and description limits, visibility of published videos, token renewal lead time and English/French copy. Does not grant provider permissions.', defaultValue: YOUTUBE_POLICY_DEFAULTS, schema: youtubePolicySchema, consumption: 'active' }),
  entry({ key: 'youtube.clientId', group: 'YouTube · Credentials', label: 'Google OAuth client ID', kind: 'text', description: 'OAuth client ID of the Google Cloud project with the YouTube Data API enabled. The redirect URI to register is the public origin plus /api/connections/youtube/callback.', defaultValue: '', schema: z.string().max(512), consumption: 'active' }),
  entry({ key: 'youtube.clientSecret', group: 'YouTube · Credentials', label: 'Google OAuth client secret', kind: 'secret', description: 'OAuth client secret for the client ID above.', defaultValue: '', schema: z.string().max(2048), consumption: 'active' }),
].map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: 'youtube' } }));
