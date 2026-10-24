import { z } from 'zod';
import { entry } from '@/lib/config/entry';
const endpoint = z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash; });
const bilingual = z.object({ en: z.string().min(1), fr: z.string().min(1) });
export const threadsPolicySchema = z.object({
  graphUrl: endpoint, authorizationUrl: endpoint, tokenUrl: endpoint, exchangeUrl: endpoint, refreshUrl: endpoint,
  callbackPath: z.literal('/api/connections/threads/callback'),
  scopes: z.array(z.string().regex(/^threads_[a-z_]+$/)).min(1), timeoutMs: z.number().int().min(1).max(120000),
  maxTextCharacters: z.number().int().min(1).max(500), maxMedia: z.number().int().min(1).max(20),
  pollAttempts: z.number().int().min(1).max(300), pollIntervalMs: z.number().int().min(1).max(60000),
  copy: z.object({ unavailable: bilingual, invalid: bilingual, uncertain: bilingual, processing: bilingual }),
});
export type ThreadsPolicy = z.infer<typeof threadsPolicySchema>;
export const THREADS_POLICY_DEFAULTS: ThreadsPolicy = {
  graphUrl: 'https://graph.threads.net/v1.0', authorizationUrl: 'https://threads.net/oauth/authorize', tokenUrl: 'https://graph.threads.net/oauth/access_token',
  exchangeUrl: 'https://graph.threads.net/access_token', refreshUrl: 'https://graph.threads.net/refresh_access_token', callbackPath: '/api/connections/threads/callback',
  scopes: ['threads_basic', 'threads_content_publish'], timeoutMs: 15000, maxTextCharacters: 500, maxMedia: 20, pollAttempts: 40, pollIntervalMs: 3000,
  copy: {
    unavailable: { en: 'Threads could not complete this request.', fr: 'Threads n’a pas pu terminer cette demande.' },
    invalid: { en: 'Check the text and media before trying again.', fr: 'Vérifiez le texte et les médias avant de réessayer.' },
    uncertain: { en: 'Check your Threads account before sending this publication again.', fr: 'Vérifiez votre compte Threads avant de renvoyer cette publication.' },
    processing: { en: 'The media is still processing.', fr: 'Le média est toujours en cours de préparation.' },
  },
};
export const THREADS_CONFIG = [
  entry({ key: 'threads.connectionPolicy', group: 'Threads · Connection', label: 'Connection policy', kind: 'json', description: 'OAuth state lifetime and callback size limit.', defaultValue: { renewLeadSeconds: 3600, stateTtlSeconds: 600, codeMaxLength: 4096, postLabel: { en: 'Post', fr: 'Publication' } }, schema: z.object({ renewLeadSeconds: z.number().int().min(1).max(86400), stateTtlSeconds: z.number().int().min(60).max(3600), codeMaxLength: z.number().int().min(1).max(16384), postLabel: z.object({ en: z.string().min(1), fr: z.string().min(1) }) }), consumption: 'active' }),
  entry({ key: 'platforms.threads.enabled', group: 'Threads · Engine', label: 'Threads enabled', kind: 'boolean', description: 'Installed connector; enable after live verification.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.threads.includedByDefault', group: 'Threads · Access', label: 'Included by default', kind: 'boolean', description: 'Default workspace access.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.threads.planFeatures', group: 'Threads · Access', label: 'Plan feature keys', kind: 'json', description: 'Plan access keys.', defaultValue: ['platform_threads'], schema: z.array(z.string().min(1)), consumption: 'active' }),
  entry({ key: 'threads.policy', group: 'Threads · API', label: 'Threads policy', kind: 'json', description: 'Endpoints, scopes, polling, media limits and bilingual feedback.', defaultValue: THREADS_POLICY_DEFAULTS, schema: threadsPolicySchema, consumption: 'active' }),
  entry({ key: 'threads.appId', group: 'Threads · Credentials', label: 'Application ID', kind: 'text', description: 'Threads application identifier.', defaultValue: '', schema: z.string(), consumption: 'active' }),
  entry({ key: 'threads.appSecret', group: 'Threads · Credentials', label: 'Application secret', kind: 'secret', description: 'Threads application secret.', defaultValue: '', schema: z.string(), consumption: 'active' }),
].map(value => ({ ...value, owner: { kind: 'platform' as const, id: 'threads' } }));
