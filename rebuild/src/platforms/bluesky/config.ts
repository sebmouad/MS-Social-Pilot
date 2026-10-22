import { z } from 'zod';
import { entry } from '@/lib/config/entry';
export const policySchema = z.object({
  baseUrl: z.string().url().refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/'; }),
  requestTimeoutMs: z.number().int().min(1).max(120000),
  maxTextCharacters: z.number().int().min(1).max(300),
  unavailable: z.object({ en: z.string().min(1), fr: z.string().min(1) }),
});
export type Policy = z.infer<typeof policySchema>;
export const POLICY_DEFAULTS: Policy = { baseUrl: 'https://bsky.social', requestTimeoutMs: 15000, maxTextCharacters: 300, unavailable: { en: 'Bluesky could not complete this request. Check your connection before trying again.', fr: 'Bluesky n’a pas pu terminer cette demande. Vérifiez votre connexion avant de réessayer.' } };
export const BLUESKY_CONFIG = [
  entry({ key: 'bluesky.policy', group: 'Bluesky · API', label: 'Bluesky transport policy', kind: 'json', description: 'Staged transport: HTTPS endpoint, timeout, text bound and bilingual failure copy. No customer operations until shared host integration.', defaultValue: POLICY_DEFAULTS, schema: policySchema, consumption: 'active' }),
].map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: 'bluesky' } }));
