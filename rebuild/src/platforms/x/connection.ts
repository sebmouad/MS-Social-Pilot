import type { PlatformHost } from '@/server/platforms/host';
import { startTokenOAuth, finishTokenOAuth, type TokenOAuthFlow } from '@/server/platforms/token-connection';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { configuredXAdapter } from './runtime';
import { xPolicySchema } from './config';

async function settings() {
  const [raw, clientId, secret] = await Promise.all([runtimeConfig('x.policy'), runtimeSecret('x.clientId'), runtimeSecret('x.clientSecret')]);
  if (!clientId || !secret) throw new Error('X unavailable');
  return { policy: xPolicySchema.parse(raw), clientId };
}
export const xOAuthFlow: TokenOAuthFlow = {
  provider: 'x', pkce: true,
  async codeMaxLength() { return ((await runtimeConfig('x.connectionPolicy')) as { codeMaxLength: number }).codeMaxLength; },
  async stateTtlSeconds() { return ((await runtimeConfig('x.connectionPolicy')) as { stateTtlSeconds: number }).stateTtlSeconds; },
  async authorizationUrl(input) {
    const { policy, clientId } = await settings(); if (!input.challenge) throw new Error('PKCE required');
    const url = new URL(policy.authorizationUrl); url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: input.redirectUri, scope: policy.scopes.join(' '), state: input.state, code_challenge: input.challenge, code_challenge_method: 'S256' }).toString(); return url.href;
  },
  async complete(input) {
    if (!input.verifier) throw new Error('PKCE required');
    const adapter = await configuredXAdapter(), token = await adapter.exchangeCode({ ...input, verifier: input.verifier });
    const found = await adapter.discover!({ credential: { accessToken: token.accessToken } });
    const account = found.targets[0]; if (!account) throw new Error('X account missing');
    return { providerUserId: account.id, name: account.name, pictureUrl: null, accessToken: token.accessToken, refreshToken: token.refreshToken ?? null,
      accessExpiresAt: token.expiresAt, grantExpiresAt: null, scopes: token.grantedScopes,
      destinations: found.targets.map(target => ({ providerId: target.id, name: target.name, pictureUrl: null })) };
  },
};
export const xConnection: PlatformHost['connection'] = {
  isReady: () => settings().then(() => true, () => false), start: (request, viewer) => startTokenOAuth(xOAuthFlow, request, viewer), callback: (request, viewer) => finishTokenOAuth(xOAuthFlow, request, viewer),
  async renewToken({ accessToken, refreshToken }) {
    if (!refreshToken) return null;
    const next = await (await configuredXAdapter()).refreshToken(refreshToken);
    return { accessToken: next.accessToken, expiresAt: next.expiresAt, refreshToken: next.refreshToken ?? refreshToken };
  },
};
