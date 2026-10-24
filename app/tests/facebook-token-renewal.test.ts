import { beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ engine: vi.fn(), oauth: vi.fn(), fetch: vi.fn() }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: h.engine, configuredFacebookOAuth: h.oauth }));
import { createFacebookEngine } from '../src/platforms/facebook/publishing';
import { renewFacebookConnectionToken } from '../src/platforms/facebook/token-renewal';
const config = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 1024, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false,
};
beforeEach(() => {
  vi.resetAllMocks();
  h.oauth.mockResolvedValue({ appId: 'synthetic-app', appSecret: 'synthetic-secret' });
  h.engine.mockImplementation(async () => createFacebookEngine(config, h.fetch));
});
it('calls the existing Facebook exchange hook through mocked transport', async () => {
  h.fetch.mockResolvedValue(Response.json({ access_token: 'renewed-user-token', expires_in: 3600 }));
  const signal = new AbortController().signal;
  const result = await renewFacebookConnectionToken({ accessToken: 'old-user-token', refreshToken: null, signal });
  expect(h.engine).toHaveBeenCalledWith({ signal });
  const url = new URL(String(h.fetch.mock.calls[0]![0]));
  expect(url.pathname).toBe('/v99.0/oauth/access_token');
  expect(url.searchParams.get('grant_type')).toBe('fb_exchange_token');
  expect(url.searchParams.get('fb_exchange_token')).toBe('old-user-token');
  expect(url.searchParams.get('client_id')).toBe('synthetic-app');
  expect(url.searchParams.get('client_secret')).toBe('synthetic-secret');
  expect(result?.accessToken).toBe('renewed-user-token');
  expect(result?.expiresAt?.getTime()).toBeGreaterThan(Date.now());
  expect(h.fetch).toHaveBeenCalledOnce(); // No Page rediscovery or credential replacement.
});
it.each([{ error: { message: 'secret transport error', code: 190 } }, { access_token: 'token', expires_in: 0 }, { expires_in: 3600 }])('rejects provider denial or malformed renewal without inventing success', async payload => {
  h.fetch.mockResolvedValue(Response.json(payload));
  await expect(renewFacebookConnectionToken({ accessToken: 'old', refreshToken: null, signal: new AbortController().signal })).rejects.toThrow();
});
it('declines empty credentials before constructing transport', async () => {
  expect(await renewFacebookConnectionToken({ accessToken: '', refreshToken: null, signal: new AbortController().signal })).toBeNull();
  expect(h.engine).not.toHaveBeenCalled();
});
