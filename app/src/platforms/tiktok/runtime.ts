import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { freshStoredAccessToken } from '@/server/platforms/token-connection';
import { ProviderHttpError } from '@/server/platforms/provider-http';
import { tiktokPolicySchema } from './config';
import { createTiktokAdapter } from './adapter';
import { createTiktokApi } from './api';

export async function configuredTiktokPolicy() {
  return tiktokPolicySchema.parse(await runtimeConfig('tiktok.policy'));
}

function withSignal(signal?: AbortSignal): typeof fetch | undefined {
  return signal ? (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }) : undefined;
}

/** Null until Root has filled in the TikTok client key and secret. */
export async function configuredTiktokApi(locale: 'en' | 'fr' = 'en', signal?: AbortSignal) {
  const [policy, clientKey, clientSecret] = await Promise.all([configuredTiktokPolicy(), runtimeConfig('tiktok.clientKey'), runtimeSecret('tiktok.clientSecret')]);
  if (!clientKey || !clientSecret) return null;
  const fetchWithSignal = withSignal(signal);
  return { policy, api: createTiktokApi(policy, { clientKey, clientSecret, locale, ...(fetchWithSignal ? { fetch: fetchWithSignal } : {}) }) };
}

export async function configuredTiktokAdapter(locale: 'en' | 'fr' = 'en', signal?: AbortSignal) {
  const policy = await configuredTiktokPolicy();
  const configured = await configuredTiktokApi(locale, signal);
  const fetchWithSignal = withSignal(signal);
  return createTiktokAdapter(policy, {
    locale, ...(fetchWithSignal ? { fetch: fetchWithSignal } : {}), ...(configured ? { api: configured.api } : {}),
    freshToken: async (publication, accessToken) => {
      if (!configured) return accessToken;
      const result = await freshStoredAccessToken({
        workspaceId: publication.workspaceId, targetId: publication.targetId, provider: 'tiktok', leadMs: policy.renewLeadSeconds * 1000, fallback: accessToken,
        refresh: refreshToken => configured.api.refresh(refreshToken, signal),
      });
      if (result.outcome === 'revoked') throw new ProviderHttpError(policy.copy.permission[locale], 'rejected');
      return result.accessToken;
    },
  });
}
