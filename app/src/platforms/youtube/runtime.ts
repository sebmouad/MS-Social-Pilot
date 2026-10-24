import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { freshStoredAccessToken } from '@/server/platforms/token-connection';
import { ProviderHttpError } from '@/server/platforms/provider-http';
import { youtubePolicySchema } from './config';
import { createYoutubeAdapter } from './adapter';
import { createYoutubeApi } from './api';

export async function configuredYoutubePolicy() {
  return youtubePolicySchema.parse(await runtimeConfig('youtube.policy'));
}

function withSignal(signal?: AbortSignal): typeof fetch | undefined {
  return signal ? (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }) : undefined;
}

/** Null until Root has filled in the Google OAuth client. */
export async function configuredYoutubeApi(locale: 'en' | 'fr' = 'en', signal?: AbortSignal) {
  const [policy, clientId, clientSecret] = await Promise.all([configuredYoutubePolicy(), runtimeConfig('youtube.clientId'), runtimeSecret('youtube.clientSecret')]);
  if (!clientId || !clientSecret) return null;
  const fetchWithSignal = withSignal(signal);
  return { policy, api: createYoutubeApi(policy, { clientId, clientSecret, locale, ...(fetchWithSignal ? { fetch: fetchWithSignal } : {}) }) };
}

export async function configuredYoutubeAdapter(locale: 'en' | 'fr' = 'en', signal?: AbortSignal) {
  const policy = await configuredYoutubePolicy();
  const configured = await configuredYoutubeApi(locale, signal);
  const fetchWithSignal = withSignal(signal);
  return createYoutubeAdapter(policy, {
    locale, ...(fetchWithSignal ? { fetch: fetchWithSignal } : {}), ...(configured ? { api: configured.api } : {}),
    freshToken: async (publication, accessToken) => {
      if (!configured) return accessToken;
      const result = await freshStoredAccessToken({
        workspaceId: publication.workspaceId, targetId: publication.targetId, provider: 'youtube', leadMs: policy.renewLeadSeconds * 1000, fallback: accessToken,
        refresh: refreshToken => configured.api.refresh(refreshToken, signal),
      });
      if (result.outcome === 'revoked') throw new ProviderHttpError(policy.copy.permission[locale], 'rejected');
      return result.accessToken;
    },
  });
}
