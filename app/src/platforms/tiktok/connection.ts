import type { NextRequest } from 'next/server';
import type { PlatformHost, ConnectionViewer } from '@/server/platforms/host';
import { finishTokenOAuth, startTokenOAuth, type TokenOAuthFlow } from '@/server/platforms/token-connection';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { ProviderHttpError } from '@/server/platforms/provider-http';
import { configuredTiktokApi, configuredTiktokPolicy } from './runtime';

/** TikTok Login Kit with PKCE. One account is one destination. */
export const tiktokFlow: TokenOAuthFlow = {
  provider: 'tiktok', pkce: true,
  stateTtlSeconds: async () => (await configuredTiktokPolicy()).oauthStateMinutes * 60,
  async authorizationUrl({ redirectUri, state, challenge }) {
    const configured = await configuredTiktokApi();
    return configured && challenge ? configured.api.authorizationUrl({ redirectUri, state, challenge }) : null;
  },
  async complete({ code, redirectUri, verifier, signal }) {
    const configured = await configuredTiktokApi('en', signal);
    if (!configured || !verifier) throw new Error('TikTok is not configured.');
    const { api, policy } = configured;
    const token = await api.exchange({ code, redirectUri, verifier, signal });
    const user = await api.user(token.accessToken, signal);
    if (token.openId && token.openId !== user.openId) throw new ProviderHttpError(policy.copy.unavailable.en, 'rejected');
    return {
      providerUserId: user.openId, name: user.name, pictureUrl: user.pictureUrl,
      accessToken: token.accessToken, refreshToken: token.refreshToken, accessExpiresAt: token.accessExpiresAt, grantExpiresAt: token.grantExpiresAt,
      scopes: token.scopes.length ? token.scopes : policy.connectScopes,
      destinations: [{ providerId: user.openId, name: user.name, pictureUrl: user.pictureUrl }],
    };
  },
};

export const tiktokConnection: PlatformHost['connection'] = {
  isReady: async () => Boolean(await runtimeConfig('tiktok.clientKey') && await runtimeSecret('tiktok.clientSecret')),
  start: (request: Request, viewer: ConnectionViewer) => startTokenOAuth(tiktokFlow, request, viewer),
  callback: (request: NextRequest, viewer: ConnectionViewer) => finishTokenOAuth(tiktokFlow, request, viewer),
  async renewToken(input) {
    if (!input.refreshToken) return null;
    const configured = await configuredTiktokApi('en', input.signal);
    if (!configured) return null;
    const renewed = await configured.api.refresh(input.refreshToken, input.signal);
    // Root stores the access end in meta and the grant's end (the refresh token's life) as the grant expiry.
    // Destinations hold copies of the account token, so Root rotates them with the account.
    return { accessToken: renewed.accessToken, refreshToken: renewed.refreshToken, expiresAt: renewed.accessExpiresAt, grantExpiresAt: renewed.grantExpiresAt ?? null, rotateDestinationCopies: true };
  },
  async grantHealth({ scopes, locale = 'en' }) {
    const policy = await configuredTiktokPolicy();
    const granted = scopes?.split(/[\s,]+/).filter(Boolean);
    return [{ id: 'publishing', label: policy.copy.publishing[locale], required: policy.publishScopes }]
      .map(({ id, label, required }) => ({ id, label, state: !granted?.length ? 'unknown' as const : required.every(scope => granted.includes(scope)) ? 'granted' as const : 'missing' as const }));
  },
};
