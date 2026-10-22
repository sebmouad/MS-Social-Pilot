import { z } from 'zod';
import { entry } from '@/lib/config/entry';
const https = z.string().url().refine(value => { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; });
const bilingual = z.object({ en: z.string().min(1), fr: z.string().min(1) });
export const policySchema = z.object({
  apiBaseUrl: https, authorizationUrl: https, tokenUrl: https, publicPostUrl: https,
  scopes: z.array(z.string().min(1)).min(1), requestTimeoutMs: z.number().int().min(1).max(120000),
  pageSize: z.number().int().min(1).max(100), maxPages: z.number().int().min(1).max(1000),
  stateTtlSeconds: z.number().int().min(60).max(3600), codeMaxLength: z.number().int().min(1).max(16384),
  maxImages: z.number().int().min(1).max(9), textLength: z.number().int().min(1).max(3000),
  memberPublishScopes: z.array(z.string().min(1)).min(1), organizationPublishScopes: z.array(z.string().min(1)).min(1), memberReadScopes: z.array(z.string().min(1)).min(1), organizationReadScopes: z.array(z.string().min(1)).min(1), version: z.string().regex(/^\d{6}$/), organizationScopes: z.array(z.string().min(1)), organizationsEnabled: z.boolean(), uploadHosts: z.array(z.string().min(1)), maxUploadBytes: z.number().int().positive(), uploadMimeTypes: z.array(z.string().min(1)),
  copy: z.object({ invalid: bilingual, unavailable: bilingual, permission: bilingual, uncertain: bilingual, format: bilingual, publishing: bilingual }),
});
export type Policy = z.infer<typeof policySchema>;
export const POLICY_DEFAULTS: Policy = {
  apiBaseUrl: 'https://api.linkedin.com', authorizationUrl: 'https://www.linkedin.com/oauth/v2/authorization', tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
  publicPostUrl: 'https://www.linkedin.com/feed/update/',
  scopes: ['openid', 'profile', 'w_member_social'], requestTimeoutMs: 15000, pageSize: 100, maxPages: 20,
  stateTtlSeconds: 600, codeMaxLength: 4096, maxImages: 9, textLength: 3000,
  memberPublishScopes: ['w_member_social'], organizationPublishScopes: ['w_organization_social'], memberReadScopes: ['r_member_social'], organizationReadScopes: ['r_organization_social'], version: '202608', organizationScopes: ['r_organization_social', 'w_organization_social', 'rw_organization_admin'], organizationsEnabled: false, uploadHosts: ['www.linkedin.com', 'api.linkedin.com'], maxUploadBytes: 10485760, uploadMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
  copy: {
    invalid: { en: 'Check the selected channel, text and pictures before trying again.', fr: 'Vérifiez le canal, le texte et les images avant de réessayer.' },
    unavailable: { en: 'LinkedIn could not complete this request. Please try again later.', fr: 'LinkedIn n’a pas pu terminer cette demande. Réessayez plus tard.' },
    permission: { en: 'Reconnect this account to allow this action.', fr: 'Reconnectez ce compte pour autoriser cette action.' },
    uncertain: { en: 'The publication could not be confirmed. Check the account before sending it again.', fr: 'La publication n’a pas pu être confirmée. Vérifiez le compte avant de la renvoyer.' },
    format: { en: 'Feed post', fr: 'Publication du fil' },
    publishing: { en: 'Publishing', fr: 'Publication' },
  },
};
export const LINKEDIN_CONFIG = [
  entry({ key: 'platforms.linkedin.enabled', group: 'LinkedIn · Engine', label: 'LinkedIn enabled', kind: 'boolean', description: 'Enable the installed module after live verification.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.linkedin.includedByDefault', group: 'LinkedIn · Access', label: 'Included by default', kind: 'boolean', description: 'Workspace platform access policy.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'platforms.linkedin.planFeatures', group: 'LinkedIn · Access', label: 'Plan access keys', kind: 'json', description: 'Plan features granting platform access.', defaultValue: ['platform_linkedin'], schema: z.array(z.string().min(1)), consumption: 'active' }),
  entry({ key: 'linkedin.clientId', group: 'LinkedIn · Credentials', label: 'Client ID', kind: 'text', description: 'Provider application client identifier.', defaultValue: '', schema: z.string().max(2048), consumption: 'active' }),
  entry({ key: 'linkedin.clientSecret', group: 'LinkedIn · Credentials', label: 'Client secret', kind: 'secret', description: 'Encrypted provider application secret.', defaultValue: '', schema: z.string().max(4096), consumption: 'active' }),
  entry({ key: 'linkedin.policy', group: 'LinkedIn · Operations', label: 'API and publishing policy', kind: 'json', description: 'Endpoints, scopes, bounded discovery, media limits and English/French copy.', defaultValue: POLICY_DEFAULTS, schema: policySchema, consumption: 'active' }),
].map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: 'linkedin' } }));
