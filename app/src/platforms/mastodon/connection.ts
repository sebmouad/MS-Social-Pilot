import type { PlatformHost } from '@/server/platforms/host';
import { startTokenOAuth, finishTokenOAuth, type TokenOAuthFlow } from '@/server/platforms/token-connection';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { createMastodonAdapter, normaliseInstance } from './adapter';
import { mastodonPolicySchema } from './config';
import { mastodonTransport } from './transport';

export const encodeMastodonCredential = (instance: string, token: string) => JSON.stringify({ instance, token });
export function decodeMastodonCredential(raw: string): { instance: string; token: string } {
  const value = JSON.parse(raw) as { instance: unknown; token: unknown };
  if (typeof value.instance !== 'string' || typeof value.token !== 'string' || !value.token) throw new Error('Mastodon reconnect required');
  return { instance: normaliseInstance(value.instance), token: value.token };
}
export async function mastodonSettings() {
  const [raw, instance, clientId, clientSecret, maxBytes] = await Promise.all([runtimeConfig('mastodon.policy'), runtimeConfig('mastodon.instanceUrl'), runtimeSecret('mastodon.clientId'), runtimeSecret('mastodon.clientSecret'), runtimeConfig('mastodon.maxResponseBytes')]);
  if (typeof instance !== 'string' || !clientId || !clientSecret) throw new Error('Mastodon unavailable');
  const policy = mastodonPolicySchema.parse(raw);
  return { policy, instance: normaliseInstance(instance), clientId, clientSecret, maxBytes: maxBytes as number };
}
export const mastodonOAuthFlow: TokenOAuthFlow = {
  provider: 'mastodon', pkce: false,
  async codeMaxLength() { return ((await runtimeConfig('mastodon.connectionPolicy')) as { codeMaxLength: number }).codeMaxLength; },
  async stateTtlSeconds() { return ((await runtimeConfig('mastodon.connectionPolicy')) as { stateTtlSeconds: number }).stateTtlSeconds; },
  async authorizationUrl(input) { const s = await mastodonSettings(); return createMastodonAdapter(s.policy, { instance: s.instance, transport: mastodonTransport(s.maxBytes) }).getAuthorizationUrl({ ...input, appId: s.clientId, scopes: s.policy.scopes }); },
  async complete(input) {
    const s = await mastodonSettings(), adapter = createMastodonAdapter(s.policy, { instance: s.instance, transport: mastodonTransport(s.maxBytes) });
    const token = await adapter.exchangeCode({ ...input, appId: s.clientId, appSecret: s.clientSecret });
    const found = await adapter.discover({ credential: { accessToken: token.accessToken } }), account = found.targets[0];
    if (!account) throw new Error('Mastodon account missing');
    return { providerUserId: account.id, name: account.name, pictureUrl: null, accessToken: encodeMastodonCredential(s.instance, token.accessToken), refreshToken: null,
      accessExpiresAt: null, grantExpiresAt: null, scopes: token.grantedScopes,
      destinations: found.targets.map(target => ({ providerId: target.id, name: target.name, pictureUrl: null })) };
  },
};
export const mastodonConnection: PlatformHost['connection'] = {
  isReady: () => mastodonSettings().then(() => true, () => false),
  start: (request, viewer) => startTokenOAuth(mastodonOAuthFlow, request, viewer),
  callback: (request, viewer) => finishTokenOAuth(mastodonOAuthFlow, request, viewer),
  // Mastodon tokens have no expiry or refresh grant; disconnection removes the local credential.
};
