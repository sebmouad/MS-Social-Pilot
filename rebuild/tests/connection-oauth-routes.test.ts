import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createFacebookOAuthState, FACEBOOK_OAUTH_STATE_COOKIE } from '../src/server/connection-oauth-state';
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: vi.fn() }));

const mocks = vi.hoisted(() => ({
  requireViewer: vi.fn(),
  runtimeConfig: vi.fn(),
  configuredFacebookEngine: vi.fn(),
  configuredFacebookOAuth: vi.fn(),
  configuredFacebookAdapter: vi.fn(),
  persistFacebookDiscovery: vi.fn(),
  recordFacebookConnectionFailure: vi.fn(),
  engine: {
    getAuthorizationUrl: vi.fn(), exchangeCode: vi.fn(), exchangeForLongLivedToken: vi.fn(), getCurrentUser: vi.fn(),
    discoverPages: vi.fn(), discoverAdAccounts: vi.fn(),
  },
}));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.requireViewer }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.runtimeConfig }));
vi.mock('../src/server/platforms/facebook', () => ({
  configuredFacebookEngine: mocks.configuredFacebookEngine,
  configuredFacebookOAuth: mocks.configuredFacebookOAuth,
  configuredFacebookAdapter: mocks.configuredFacebookAdapter,
}));
vi.mock('../src/server/connection-mutations', () => ({ persistFacebookDiscovery: mocks.persistFacebookDiscovery, recordFacebookConnectionFailure: mocks.recordFacebookConnectionFailure }));

import { GET } from '../src/app/api/connections/facebook/callback/route';
import { POST } from '../src/app/api/connections/facebook/start/route';

const originalKey = process.env.ENCRYPTION_KEY;
const validKey = Buffer.alloc(32, 5).toString('base64');
const callbackUrl = 'https://social.example.test/api/connections/facebook/callback';
const startUrl = 'https://social.example.test/api/connections/facebook/start';

afterEach(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
  vi.clearAllMocks();
});

beforeEach(() => {
  process.env.ENCRYPTION_KEY = validKey;
  mocks.requireViewer.mockResolvedValue({ user: { id: 'user-1' }, workspaceId: 'workspace-1', membership: { role: 'owner' } });
  mocks.runtimeConfig.mockImplementation((key: string) => Promise.resolve(key === 'meta.adsReadScopes' ? ['ads_read'] : key === 'meta.oauthStateMinutes' ? 10 : key === 'platforms.facebook.enabled' ? true : undefined));
  mocks.configuredFacebookAdapter.mockResolvedValue({ id: 'facebook', capabilities: { connection: 'supported' }, getAuthorizationUrl: vi.fn() });
  mocks.engine.getAuthorizationUrl.mockImplementation((input: { state: string; scopes: string[] }) => `https://www.facebook.com/dialog/oauth?state=${input.state}&scope=${input.scopes.join(',')}`);
  mocks.configuredFacebookOAuth.mockResolvedValue({ appId: 'app-id', appSecret: 'app-secret', redirectUri: callbackUrl, scopes: ['pages_show_list'] });
  mocks.engine.exchangeCode.mockResolvedValue({ accessToken: 'short-token', expiresAt: null });
  mocks.engine.exchangeForLongLivedToken.mockResolvedValue({ accessToken: 'long-token', expiresAt: new Date('2027-01-01T00:00:00Z') });
  mocks.engine.getCurrentUser.mockResolvedValue({ id: 'meta-user', name: 'Meta User', pictureUrl: null });
  mocks.engine.discoverPages.mockResolvedValue([{ id: 'page-1', name: 'Page One', category: null, accessToken: 'page-token' }]);
  mocks.engine.discoverAdAccounts.mockResolvedValue([{ id: 'act_1', name: 'Ads One', currency: 'USD', status: 1 }]);
  mocks.configuredFacebookEngine.mockResolvedValue(mocks.engine);
  mocks.persistFacebookDiscovery.mockResolvedValue({ pages: 1, adAccounts: 1, skippedPages: 0, skippedAdAccounts: 0 });
});

describe('Meta OAuth start route', () => {
  it('enforces same-origin and sets a short-lived HttpOnly callback state cookie', async () => {
    const request = new Request(startUrl, { method: 'POST', headers: { origin: 'https://social.example.test' } });
    const response = await POST(request);
    const body = await response.json();
    const state = new URL(body.authorizationUrl).searchParams.get('state');
    expect(response.status).toBe(200);
    expect(new URL(body.authorizationUrl).searchParams.get('scope')).toBe('pages_show_list,ads_read');
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get('set-cookie')).toContain(`${FACEBOOK_OAUTH_STATE_COOKIE}=`);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('SameSite=lax');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=600');
    expect(response.headers.get('set-cookie')).not.toContain(state);
  });

  it('rejects cross-origin start requests before reading the session', async () => {
    const request = new Request(startUrl, { method: 'POST', headers: { origin: 'https://attacker.example.test' } });
    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(mocks.requireViewer).not.toHaveBeenCalled();
  });
});

describe('Meta OAuth callback route', () => {
  it('exchanges, discovers, and persists only the long-lived token, then opens selections', async () => {
    const pending = createFacebookOAuthState('user-1', 'workspace-1', ['pages_show_list', 'ads_read'], 600);
    const request = new NextRequest(`${callbackUrl}?code=oauth-code&state=${pending.state}`, {
      headers: { cookie: `${FACEBOOK_OAUTH_STATE_COOKIE}=${pending.cookieValue}` },
    });
    const response = await GET(request);

    expect(mocks.engine.exchangeCode).toHaveBeenCalledWith({ appId: 'app-id', appSecret: 'app-secret', redirectUri: callbackUrl, code: 'oauth-code' });
    expect(mocks.engine.exchangeForLongLivedToken).toHaveBeenCalledWith({ accessToken: 'short-token', appId: 'app-id', appSecret: 'app-secret' });
    expect(mocks.engine.getCurrentUser).toHaveBeenCalledWith('long-token');
    expect(mocks.engine.discoverPages).toHaveBeenCalledWith('long-token');
    expect(mocks.engine.discoverAdAccounts).toHaveBeenCalledWith('long-token');
    expect(mocks.persistFacebookDiscovery).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'workspace-1' }, expect.objectContaining({
      accessToken: 'long-token', scopes: ['pages_show_list', 'ads_read'],
    }));
    expect(response.headers.get('location')).toBe('https://social.example.test/settings/connections?notice=connected&select=1');
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.headers.get('location')).not.toContain('token');
  });

  it('rejects mismatched state before calling Meta or persisting', async () => {
    const pending = createFacebookOAuthState('user-1', 'workspace-1', ['pages_show_list'], 600);
    const request = new NextRequest(`${callbackUrl}?code=oauth-code&state=attacker-state`, {
      headers: { cookie: `${FACEBOOK_OAUTH_STATE_COOKIE}=${pending.cookieValue}` },
    });
    const response = await GET(request);
    expect(mocks.engine.exchangeCode).not.toHaveBeenCalled();
    expect(mocks.persistFacebookDiscovery).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toContain('notice=oauth_invalid_state');
  });

  it('keeps Graph failure details out of the redirect and records only a safe category', async () => {
    const pending = createFacebookOAuthState('user-1', 'workspace-1', ['pages_show_list'], 600);
    mocks.engine.exchangeCode.mockRejectedValueOnce(new Error('private-provider-detail-with-token'));
    const request = new NextRequest(`${callbackUrl}?code=oauth-code&state=${pending.state}`, {
      headers: { cookie: `${FACEBOOK_OAUTH_STATE_COOKIE}=${pending.cookieValue}` },
    });
    const response = await GET(request);
    expect(response.headers.get('location')).toBe('https://social.example.test/settings/connections?notice=connect_failed');
    expect(response.headers.get('location')).not.toContain('private-provider-detail-with-token');
    expect(mocks.recordFacebookConnectionFailure).toHaveBeenCalledWith({ userId: 'user-1', workspaceId: 'workspace-1' }, 'exchange', 'internal_error');
    expect(mocks.persistFacebookDiscovery).not.toHaveBeenCalled();
  });
});
