import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ values: {} as Record<string, unknown>, send: vi.fn(), resolve: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: state.resolve }));
vi.mock('node:https', () => ({ request: state.request }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn(async (key: string) => state.values[key]), runtimeSecret: vi.fn(async (key: string) => state.values[key]) }));
vi.mock('@/server/platforms/token-connection', () => ({ startTokenOAuth: vi.fn(), finishTokenOAuth: vi.fn() }));
vi.mock('@/server/platforms/request-locale', () => ({ requestLocale: async () => 'fr' }));
vi.mock('@/server/platforms/token-renewal-job', () => ({ renewProviderTokens: vi.fn() }));
import { mastodonTransport, isMastodonPublicAddress } from '@/platforms/mastodon/transport';
import { MASTODON_CONFIG } from '@/platforms/mastodon/config';
import { THREADS_CONFIG } from '@/platforms/threads/config';
import { X_CONFIG } from '@/platforms/x/config';
import { threadsOAuthFlow, threadsConnection } from '@/platforms/threads/connection';
import { xOAuthFlow, xConnection } from '@/platforms/x/connection';
import { mastodonOAuthFlow, encodeMastodonCredential, decodeMastodonCredential } from '@/platforms/mastodon/connection';
import { threadsHost } from '@/platforms/threads/host';
import { xHost } from '@/platforms/x/host';
import { mastodonHost } from '@/platforms/mastodon/host';

beforeEach(() => {
  vi.clearAllMocks(); state.values = Object.fromEntries([...MASTODON_CONFIG, ...THREADS_CONFIG, ...X_CONFIG].map(entry => [entry.key, entry.defaultValue]));
  Object.assign(state.values, { 'threads.appId': 'app', 'threads.appSecret': 'secret', 'x.clientId': 'client', 'x.clientSecret': 'secret', 'mastodon.clientId': 'client', 'mastodon.clientSecret': 'secret' });
  vi.stubGlobal('fetch', state.send);
});
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
describe('installed OAuth providers', () => {
  it('keeps every provider off by default and consumes configurable state bounds', async () => {
    for (const name of ['mastodon', 'threads', 'x']) expect(state.values[`platforms.${name}.enabled`]).toBe(false);
    for (const flow of [mastodonOAuthFlow, threadsOAuthFlow, xOAuthFlow]) {
      state.values[`${flow.provider}.connectionPolicy`] = { stateTtlSeconds: 123, codeMaxLength: 77 };
      expect(await flow.stateTtlSeconds()).toBe(123); expect(await flow.codeMaxLength!()).toBe(77);
    }
  });
  it('uses callback from shared host and PKCE S256 for X', async () => {
    const url = new URL((await xOAuthFlow.authorizationUrl({ redirectUri: 'https://pilot.example/api/connections/x/callback', state: 'bound', challenge: 'challenge' }))!);
    expect(url.searchParams.get('redirect_uri')).toBe('https://pilot.example/api/connections/x/callback');
    expect(url.searchParams.get('code_challenge')).toBe('challenge'); expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    await expect(xOAuthFlow.complete({ code: 'code', redirectUri: 'https://pilot.example', verifier: null })).rejects.toThrow('PKCE');
  });
  it('exchanges Threads for long-lived token and leaves discovery unselected for shared persistence', async () => {
    state.send.mockResolvedValueOnce(json({ access_token: 'short', user_id: '42' })).mockResolvedValueOnce(json({ access_token: 'long', expires_in: 1234 })).mockResolvedValueOnce(json({ id: '42', username: 'synthetic' }));
    const result = await threadsOAuthFlow.complete({ code: 'code', redirectUri: 'https://pilot.example/callback', verifier: null });
    expect(result.accessToken).toBe('long'); expect(result.refreshToken).toBe('long'); expect(result.accessExpiresAt).toBeInstanceOf(Date);
    expect(result.destinations).toEqual([{ providerId: '42', name: 'synthetic', pictureUrl: null }]);
  });
  it('rejects mismatched Threads account identity', async () => {
    state.send.mockResolvedValueOnce(json({ access_token: 'short', user_id: '42' })).mockResolvedValueOnce(json({ access_token: 'long', expires_in: 1234 })).mockResolvedValueOnce(json({ id: '99', username: 'other' }));
    await expect(threadsOAuthFlow.complete({ code: 'code', redirectUri: 'https://pilot.example', verifier: null })).rejects.toThrow('mismatch');
  });
  it('persists actual X granted scopes and rotated refresh token', async () => {
    state.send.mockResolvedValueOnce(json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'tweet.write users.read' })).mockResolvedValueOnce(json({ data: { id: '42', username: 'synthetic' } }));
    const result = await xOAuthFlow.complete({ code: 'code', verifier: 'verifier', redirectUri: 'https://pilot.example/callback' });
    expect(result.refreshToken).toBe('refresh'); expect(result.scopes).toEqual(['tweet.write', 'users.read']);
    state.send.mockResolvedValueOnce(json({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 }));
    expect(await xConnection.renewToken!({ accessToken: 'old', refreshToken: 'refresh', signal: AbortSignal.timeout(1000) })).toMatchObject({ accessToken: 'new', refreshToken: 'rotated' });
  });
  it('classifies refused X refresh grants for neutral invalidation', async () => {
    state.send.mockResolvedValueOnce(new Response('{}', { status: 401 }));
    await expect(xConnection.renewToken!({ accessToken: 'old', refreshToken: 'bad', signal: AbortSignal.timeout(1000) })).rejects.toMatchObject({ status: 401 });
  });
  it('refreshes Threads using its access token', async () => {
    state.send.mockResolvedValueOnce(json({ access_token: 'next', expires_in: 3600 }));
    expect(await threadsConnection.renewToken!({ accessToken: 'old', refreshToken: 'old', signal: AbortSignal.timeout(1000) })).toMatchObject({ accessToken: 'next', refreshToken: 'next' });
  });
  it('binds Mastodon tokens to their original instance', () => {
    expect(decodeMastodonCredential(encodeMastodonCredential('https://mastodon.social', 'token'))).toEqual({ instance: 'https://mastodon.social', token: 'token' });
    expect(() => decodeMastodonCredential('{"instance":"https://localhost","token":"token"}')).toThrow();
  });
  it('provides French configured publishing descriptors and stored target kinds', async () => {
    for (const [name, host] of [['mastodon', mastodonHost], ['threads', threadsHost], ['x', xHost]] as const) {
      const adapter = await host.adapter(); expect(adapter.publishingFormats?.[0].label).toBe('Publication'); expect(adapter.supportsTargetKind?.(name, 'publishing')).toBe(true);
      const token = name === 'mastodon' ? encodeMastodonCredential('https://mastodon.social', 'token') : 'token';
      expect(adapter.canUseCredential?.({ accessToken: token, grantedScopes: [] }, 'publishing')).toBe(false);
      const policy = state.values[`${name}.policy`] as { scopes: string[] };
      expect(adapter.canUseCredential?.({ accessToken: token, grantedScopes: policy.scopes }, 'publishing')).toBe(true);
    }
  });
});

describe('Mastodon pinned transport safety', () => {
  it('rejects private and encoded mapped IPv6 answers before connecting', async () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '::ffff:7f00:1', '::ffff:127.0.0.1', 'fc00::1', '2001:db8::1']) {
      expect(isMastodonPublicAddress(address)).toBe(false);
      state.resolve.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }]);
      await expect(mastodonTransport(100)('https://mastodon.social/api', { timeoutMs: 1000 })).rejects.toThrow();
    }
    expect(state.request).not.toHaveBeenCalled();
  });
  it('pins the validated DNS answer and refuses redirects', async () => {
    state.resolve.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const destroyed = vi.fn();
    state.request.mockImplementation((_url, options, complete) => {
      const lookedUp = vi.fn(); options.lookup('mastodon.social', {}, lookedUp);
      expect(lookedUp).toHaveBeenCalledWith(null, '93.184.216.34', 4);
      const req = Object.assign(new EventEmitter(), { end: () => complete(Object.assign(new EventEmitter(), { statusCode: 302, destroy: destroyed })) });
      return req;
    });
    await expect(mastodonTransport(100)('https://mastodon.social/api', { timeoutMs: 1000 })).rejects.toThrow();
    expect(destroyed).toHaveBeenCalledOnce(); expect(state.resolve).toHaveBeenCalledOnce();
  });
  it('caps response bytes and accepts bounded JSON without another lookup', async () => {
    state.resolve.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    state.request.mockImplementation((_url, _options, complete) => {
      const emitter = new EventEmitter();
      const response = Object.assign(emitter, { statusCode: 200, destroy: (error: Error) => emitter.emit('error', error) });
      return Object.assign(new EventEmitter(), { end() { complete(response); response.emit('data', Buffer.from('{"id":"42"}')); response.emit('end'); } });
    });
    await expect(mastodonTransport(100)('https://mastodon.social/api', { timeoutMs: 1000 })).resolves.toEqual({ id: '42' });
    await expect(mastodonTransport(2)('https://mastodon.social/api', { timeoutMs: 1000 })).rejects.toThrow('Response too large');
  });
});
