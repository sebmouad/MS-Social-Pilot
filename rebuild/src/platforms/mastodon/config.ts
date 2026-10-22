import { z } from 'zod';
import { entry } from '@/lib/config/entry';
const bilingual = z.object({ en: z.string().min(1), fr: z.string().min(1) });
const path = z.string().regex(/^\/[a-zA-Z0-9_/-]+$/).refine(value => !value.startsWith('//'), 'Use an absolute local path.');
export const mastodonPolicySchema = z.object({
  copy: z.object({ unavailable: bilingual, invalid: bilingual }),
  callbackPath: z.literal('/api/connections/mastodon/callback'),
  appName: z.string().min(1), scopes: z.array(z.string().min(1)).min(1),
  paths: z.object({ apps: path, authorize: path, token: path, account: path, statuses: path, mediaUpload: path, mediaStatus: path }),
  timeoutMs: z.number().int().positive().max(120000), maxCharacters: z.number().int().positive(), maxImages: z.number().int().positive(), maxVideos: z.number().int().positive(),
  maxMediaBytes: z.number().int().positive(), pollAttempts: z.number().int().positive().max(300), pollIntervalMs: z.number().int().positive().max(60000),
  visibility: z.enum(['public', 'unlisted', 'private']), maxAltCharacters: z.number().int().positive(),
});
export type MastodonPolicy = z.infer<typeof mastodonPolicySchema>;
export const MASTODON_POLICY_DEFAULTS: MastodonPolicy = {
  copy: { unavailable: { en: 'Mastodon could not complete this request. Check your account before trying again.', fr: 'Mastodon n’a pas pu terminer cette demande. Vérifiez votre compte avant de réessayer.' }, invalid: { en: 'Check the selected account, content and media before trying again.', fr: 'Vérifiez le compte, le contenu et les médias avant de réessayer.' } },
  callbackPath: '/api/connections/mastodon/callback',
  appName: 'MS Social Pilot', scopes: ['read:accounts', 'write:statuses', 'write:media', 'read:statuses'],
  paths: { apps: '/api/v1/apps', authorize: '/oauth/authorize', token: '/oauth/token', account: '/api/v1/accounts/verify_credentials', statuses: '/api/v1/statuses', mediaUpload: '/api/v2/media', mediaStatus: '/api/v1/media' },
  timeoutMs: 15000, maxCharacters: 500, maxImages: 4, maxVideos: 1, maxMediaBytes: 40000000, pollAttempts: 30, pollIntervalMs: 2000, visibility: 'public', maxAltCharacters: 1500,
};
export const MASTODON_CONFIG = [
  entry({ key: 'mastodon.instanceUrl', group: 'Mastodon · Credentials', label: 'Server URL', kind: 'text', description: 'Single Mastodon server for this installation. Credentials must belong to this server.', defaultValue: 'https://mastodon.social', schema: z.string().url(), consumption: 'active' }),
  ...['clientId', 'clientSecret'].map(key => entry({ key: `mastodon.${key}`, group: 'Mastodon · Credentials', label: key, kind: 'secret', description: 'OAuth application registered on the configured server.', defaultValue: '', schema: z.string(), consumption: 'active' })),
  entry({ key: 'mastodon.maxResponseBytes', group: 'Mastodon · Engine', label: 'Response size limit', kind: 'number', description: 'Maximum JSON response size for pinned server requests.', defaultValue: 1048576, schema: z.number().int().positive(), consumption: 'active' }),
  entry({ key: 'mastodon.connectionPolicy', group: 'Mastodon · Connection', label: 'Connection policy', kind: 'json', description: 'OAuth state lifetime and callback size limit.', defaultValue: { stateTtlSeconds: 600, codeMaxLength: 4096, postLabel: { en: 'Post', fr: 'Publication' } }, schema: z.object({ stateTtlSeconds: z.number().int().min(60).max(3600), codeMaxLength: z.number().int().min(1).max(16384), postLabel: z.object({ en: z.string().min(1), fr: z.string().min(1) }) }), consumption: 'active' }),
  entry({ key: 'platforms.mastodon.enabled', group: 'Mastodon · Engine', label: 'Mastodon enabled', kind: 'boolean', description: 'Installed connector; enable after live verification.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.mastodon.includedByDefault', group: 'Mastodon · Engine', label: 'Included by default', kind: 'boolean', description: 'Default workspace access.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.mastodon.planFeatures', group: 'Mastodon · Engine', label: 'Plan access keys', kind: 'json', description: 'Plan access keys.', defaultValue: ['platform_mastodon'], schema: z.array(z.string().min(1)), consumption: 'active' }),
  entry({ key: 'mastodon.policy', group: 'Mastodon · Engine', label: 'Mastodon policy', kind: 'json', description: 'Server API paths, registration identity, permissions and delivery limits.', defaultValue: MASTODON_POLICY_DEFAULTS, schema: mastodonPolicySchema, consumption: 'configured' }),
].map(value => ({ ...value, owner: { kind: 'platform' as const, id: 'mastodon' } }));
