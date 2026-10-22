import { z } from 'zod';
import { entry } from '@/lib/config/entry';
const endpoint = z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; });
export const xPolicySchema = z.object({
  apiUrl: endpoint, authorizationUrl: endpoint, publicUrl: endpoint,
  scopes: z.array(z.string().min(1)).min(1), requestTimeoutMs: z.number().int().positive().max(120000),
  maxCharacters: z.number().int().positive(), maxImages: z.number().int().min(1).max(4), maxImageBytes: z.number().int().positive(),
  imageMimeTypes: z.array(z.string().min(1)).min(1), refreshBeforeExpiryMs: z.number().int().nonnegative(),
  callbackPath: z.literal('/api/connections/x/callback'),
  copy: z.object({ unavailable: z.object({ en: z.string(), fr: z.string() }), invalid: z.object({ en: z.string(), fr: z.string() }) }),
});
export type XPolicy = z.infer<typeof xPolicySchema>;
export const X_POLICY_DEFAULTS: XPolicy = { apiUrl: 'https://api.x.com/2', authorizationUrl: 'https://x.com/i/oauth2/authorize', publicUrl: 'https://x.com',
  scopes: ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'], requestTimeoutMs: 15000,
  maxCharacters: 280, maxImages: 4, maxImageBytes: 5242880, imageMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], refreshBeforeExpiryMs: 300000,
  callbackPath: '/api/connections/x/callback', copy: { unavailable: { en: 'X could not complete this request. Check the account before trying again.', fr: 'X n’a pas pu terminer cette demande. Vérifiez le compte avant de réessayer.' }, invalid: { en: 'Check the text and images before sending.', fr: 'Vérifiez le texte et les images avant l’envoi.' } } };
export const X_CONFIG = [
  entry({ key: 'x.connectionPolicy', group: 'X · Connection', label: 'Connection policy', kind: 'json', description: 'OAuth state lifetime and callback size limit.', defaultValue: { renewLeadSeconds: 3600, stateTtlSeconds: 600, codeMaxLength: 4096, postLabel: { en: 'Post', fr: 'Publication' } }, schema: z.object({ renewLeadSeconds: z.number().int().min(1).max(86400), stateTtlSeconds: z.number().int().min(60).max(3600), codeMaxLength: z.number().int().min(1).max(16384), postLabel: z.object({ en: z.string().min(1), fr: z.string().min(1) }) }), consumption: 'active' }),
  entry({ key: 'platforms.x.enabled', group: 'X · Engine', label: 'X enabled', kind: 'boolean', description: 'Installed connector; enable after live verification.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.x.includedByDefault', group: 'X · Access', label: 'Included by default', kind: 'boolean', description: 'Default workspace access.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.x.planFeatures', group: 'X · Access', label: 'Plan access keys', kind: 'json', description: 'Plan access keys.', defaultValue: ['platform_x'], schema: z.array(z.string().min(1)), consumption: 'active' }),
  entry({ key: 'x.policy', group: 'X · API', label: 'X adapter policy', kind: 'json', description: 'Endpoints, scopes, request bounds, image constraints and bilingual copy.', defaultValue: X_POLICY_DEFAULTS, schema: xPolicySchema, consumption: 'active' }),
  ...['clientId', 'clientSecret'].map(key => entry({ key: `x.${key}`, group: 'X · Credentials', label: key, kind: 'secret', description: 'OAuth application credential; server only.', defaultValue: '', schema: z.string(), consumption: 'active' })),
].map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: 'x' } }));
