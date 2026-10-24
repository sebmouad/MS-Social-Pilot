import type { NextRequest } from 'next/server';
import type { PlatformHost, ConnectionViewer } from '@/server/platforms/host';
import { finishTokenOAuth, startTokenOAuth, type TokenOAuthFlow } from '@/server/platforms/token-connection';
import { ProviderHttpError } from '@/server/platforms/provider-http';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { configuredYoutubeApi, configuredYoutubePolicy } from './runtime';

/** Google's authorization-code flow with an offline refresh token. Discovery lists every managed channel. */
export const youtubeFlow: TokenOAuthFlow = {
  provider: 'youtube', pkce: false,
  stateTtlSeconds: async () => (await configuredYoutubePolicy()).oauthStateMinutes * 60,
  async authorizationUrl({ redirectUri, state }) {
    const configured = await configuredYoutubeApi();
    return configured ? configured.api.authorizationUrl({ redirectUri, state }) : null;
  },
  async complete({ code, redirectUri, signal }) {
    const configured = await configuredYoutubeApi('en', signal);
    if (!configured) throw new Error('YouTube is not configured.');
    const { api, policy } = configured;
    const token = await api.exchange({ code, redirectUri, signal });
    const { items } = await api.channels(token.accessToken, signal);
    if (!items.length) throw new ProviderHttpError(policy.copy.noChannel.en, 'rejected');
    const first = items[0]!;
    return {
      providerUserId: first.id, name: first.title, pictureUrl: first.pictureUrl,
      accessToken: token.accessToken, refreshToken: token.refreshToken, accessExpiresAt: token.accessExpiresAt, grantExpiresAt: null,
      // Google reports what the customer actually granted; fall back to the request only if it omitted the list.
      scopes: token.scopes.length ? token.scopes : policy.connectScopes,
      destinations: items.map(item => ({ providerId: item.id, name: item.title, pictureUrl: item.pictureUrl })),
    };
  },
};

export const youtubeConnection: PlatformHost['connection'] = {
  isReady: async () => Boolean(await runtimeConfig('youtube.clientId') && await runtimeSecret('youtube.clientSecret')),
  start: (request: Request, viewer: ConnectionViewer) => startTokenOAuth(youtubeFlow, request, viewer),
  callback: (request: NextRequest, viewer: ConnectionViewer) => finishTokenOAuth(youtubeFlow, request, viewer),
  async renewToken(input) {
    if (!input.refreshToken) return null;
    const configured = await configuredYoutubeApi('en', input.signal);
    if (!configured) return null;
    const renewed = await configured.api.refresh(input.refreshToken, input.signal);
    // Root stores the access end in meta and the grant end as the grant expiry; Google refresh tokens do not expire.
    // Destinations hold copies of the account token, so Root rotates them with the account.
    return { accessToken: renewed.accessToken, refreshToken: renewed.refreshToken, expiresAt: renewed.accessExpiresAt, grantExpiresAt: renewed.grantExpiresAt ?? null, rotateDestinationCopies: true };
  },
  async grantHealth({ scopes, locale = 'en' }) {
    const policy = await configuredYoutubePolicy();
    const granted = scopes?.split(/[\s,]+/).filter(Boolean);
    return [
      { id: 'publishing', label: policy.copy.publishing[locale], required: policy.publishScopes },
      { id: 'manage', label: policy.copy.manage[locale], required: policy.deleteScopes },
    ].map(({ id, label, required }) => ({ id, label, state: !granted?.length ? 'unknown' as const : required.every(scope => granted.includes(scope)) ? 'granted' as const : 'missing' as const }));
  },
};
