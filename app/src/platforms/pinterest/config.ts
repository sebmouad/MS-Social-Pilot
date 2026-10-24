import { z } from 'zod';
import { entry } from '@/lib/config/entry';
const https = z.string().url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; });
const bilingual = z.object({ en: z.string().min(1), fr: z.string().min(1) });
export const policySchema = z.object({
  apiBaseUrl: https, authorizationUrl: https, tokenUrl: https, publicPostUrl: https,
  scopes: z.array(z.string().min(1)).min(1), requestTimeoutMs: z.number().int().min(1).max(120000),
  pageSize: z.number().int().min(1).max(100), maxPages: z.number().int().min(1).max(1000),
  renewLeadSeconds: z.number().int().min(1).max(2592000).default(86400),
  stateTtlSeconds: z.number().int().min(60).max(3600), codeMaxLength: z.number().int().min(1).max(16384),
  maxImages: z.number().int().min(1).max(5), textLength: z.number().int().min(1).max(500),
  publishScopes: z.array(z.string().min(1)).min(1), readScopes: z.array(z.string().min(1)).min(1), titleLength: z.number().int().min(1).max(100), altTextLength: z.number().int().min(1).max(500),
  copy: z.object({ invalid: bilingual, unavailable: bilingual, permission: bilingual, uncertain: bilingual, format: bilingual, publishing: bilingual }),
});
export type Policy = z.infer<typeof policySchema>;
export const POLICY_DEFAULTS: Policy = {
  apiBaseUrl: 'https://api.pinterest.com/v5', authorizationUrl: 'https://www.pinterest.com/oauth/', tokenUrl: 'https://api.pinterest.com/v5/oauth/token',
  publicPostUrl: 'https://www.pinterest.com/pin/',
  scopes: ['boards:read', 'boards:write', 'pins:read', 'pins:write', 'user_accounts:read'], requestTimeoutMs: 15000, pageSize: 100, maxPages: 20,
  renewLeadSeconds: 86400, stateTtlSeconds: 600, codeMaxLength: 4096, maxImages: 5, textLength: 500,
  publishScopes: ['pins:write'], readScopes: ['pins:read'], titleLength: 100, altTextLength: 500,
  copy: {
    invalid: { en: 'Check the selected channel, text and pictures before trying again.', fr: 'Vérifiez le canal, le texte et les images avant de réessayer.' },
    unavailable: { en: 'Pinterest could not complete this request. Please try again later.', fr: 'Pinterest n’a pas pu terminer cette demande. Réessayez plus tard.' },
    permission: { en: 'Reconnect this account to allow this action.', fr: 'Reconnectez ce compte pour autoriser cette action.' },
    uncertain: { en: 'The publication could not be confirmed. Check the account before sending it again.', fr: 'La publication n’a pas pu être confirmée. Vérifiez le compte avant de la renvoyer.' },
    format: { en: 'Image Pin', fr: 'Épingle image' },
    publishing: { en: 'Publishing', fr: 'Publication' },
  },
};
export const PINTEREST_CONFIG = [
  entry({ key: 'platforms.pinterest.enabled', group: 'Pinterest · Engine', label: 'Pinterest enabled', kind: 'boolean', description: 'Enable the installed module after live verification.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.pinterest.includedByDefault', group: 'Pinterest · Access', label: 'Included by default', kind: 'boolean', description: 'Workspace platform access policy.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.pinterest.planFeatures', group: 'Pinterest · Access', label: 'Plan access keys', kind: 'json', description: 'Plan features granting platform access.', defaultValue: ['platform_pinterest'], schema: z.array(z.string().min(1)), consumption: 'active' }),
  entry({ key: 'pinterest.clientId', group: 'Pinterest · Credentials', label: 'Client ID', kind: 'text', description: 'Provider application client identifier.', defaultValue: '', schema: z.string().max(2048), consumption: 'active' }),
  entry({ key: 'pinterest.clientSecret', group: 'Pinterest · Credentials', label: 'Client secret', kind: 'secret', description: 'Encrypted provider application secret.', defaultValue: '', schema: z.string().max(4096), consumption: 'active' }),
  entry({ key: 'pinterest.policy', group: 'Pinterest · Operations', label: 'API and publishing policy', kind: 'json', description: 'Endpoints, scopes, bounded discovery, media limits and English/French copy.', defaultValue: POLICY_DEFAULTS, schema: policySchema, consumption: 'active' }),
].map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: 'pinterest' } }));
