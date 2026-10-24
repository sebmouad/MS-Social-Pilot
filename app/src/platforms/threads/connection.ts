import type { PlatformHost } from '@/server/platforms/host';
import { startTokenOAuth, finishTokenOAuth, type TokenOAuthFlow } from '@/server/platforms/token-connection';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { configuredThreadsAdapter } from './runtime';
import { threadsPolicySchema } from './config';

async function settings() {
  const [raw, appId, appSecret] = await Promise.all([runtimeConfig('threads.policy'), runtimeConfig('threads.appId'), runtimeSecret('threads.appSecret')]);
  if (typeof appId !== 'string' || !appId || !appSecret) throw new Error('Threads unavailable');
  return { policy: threadsPolicySchema.parse(raw), appId, appSecret };
}
export const threadsOAuthFlow: TokenOAuthFlow = {
  provider: 'threads', pkce: false,
  async codeMaxLength() { return ((await runtimeConfig('threads.connectionPolicy')) as { codeMaxLength: number }).codeMaxLength; },
  async stateTtlSeconds() { return ((await runtimeConfig('threads.connectionPolicy')) as { stateTtlSeconds: number }).stateTtlSeconds; },
  async authorizationUrl(input) { const { policy, appId } = await settings(); return (await configuredThreadsAdapter()).getAuthorizationUrl({ ...input, appId, scopes: policy.scopes }); },
  async complete(input) {
    const { policy, appId, appSecret } = await settings(), adapter = await configuredThreadsAdapter();
    const token = await adapter.exchangeCode({ ...input, appId, appSecret });
    const found = await adapter.discover({ credential: { accessToken: token.accessToken } });
    const account = found.targets[0]; if (!account || account.id !== token.userId) throw new Error('Threads account mismatch');
    return { providerUserId: account.id, name: account.name, pictureUrl: null, accessToken: token.accessToken, refreshToken: token.accessToken,
      accessExpiresAt: token.expiresAt, grantExpiresAt: null, scopes: policy.scopes,
      destinations: found.targets.map(target => ({ providerId: target.id, name: target.name, pictureUrl: null })) };
  },
};
export const threadsConnection: PlatformHost['connection'] = {
  isReady: () => settings().then(() => true, () => false),
  start: (request, viewer) => startTokenOAuth(threadsOAuthFlow, request, viewer),
  callback: (request, viewer) => finishTokenOAuth(threadsOAuthFlow, request, viewer),
  async renewToken({ accessToken }) { const next = await (await configuredThreadsAdapter()).refreshToken(accessToken); return { ...next, refreshToken: next.accessToken, rotateDestinationCopies: true }; },
};
