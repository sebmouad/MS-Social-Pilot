import { ProviderHttpError } from '../src/server/platforms/provider-http';
import { ProviderError as LinkedinError } from '../src/platforms/linkedin/transport';
import { ProviderError as PinterestError } from '../src/platforms/pinterest/transport';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POLICY_DEFAULTS as linkedin } from '../src/platforms/linkedin/config';
import { POLICY_DEFAULTS as pinterest } from '../src/platforms/pinterest/config';
import { createLinkedinAdapter } from '../src/platforms/linkedin/adapter';
import { linkedinModule } from '../src/platforms/linkedin/module';
import { pinterestModule } from '../src/platforms/pinterest/module';
const mocks = vi.hoisted(() => ({ role: 'owner' as string | null, workspaceId: 'workspace', enabled: true, renewal: vi.fn(), job: vi.fn(), metadata: vi.fn(), account: vi.fn(), runtime: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { $transaction: async (fn: (tx: unknown) => unknown) => fn({ membership: { findUnique: async () => ({ role: mocks.role }) }, socialAccount: { findUnique: async () => null, upsert: mocks.account }, target: { findMany: async () => [], updateMany: async () => ({ count: 0 }) }, $executeRaw: mocks.metadata }), membership: { findUnique: vi.fn(async () => mocks.role ? { role: mocks.role } : null) } } }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: vi.fn(async () => ({ workspaceId: mocks.workspaceId })), canUseFeature: () => true, hasPlatformCapability: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({}) }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/platforms/registry', () => ({ isPlatformEnabled: async () => mocks.enabled }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: async (_id: string, fn: () => unknown) => fn() }));
vi.mock('@/server/platforms/resource-lock', () => ({ lockSelectedResources: vi.fn() }));
vi.mock('@/modules/settings/server/connection-mutations', () => ({ auditConnectionEvent: vi.fn() }));
vi.mock('@/server/platforms/token-renewal-job', () => ({ renewProviderTokens: mocks.job }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.runtime }));
vi.mock('../src/platforms/linkedin/runtime', () => ({ configuredPolicy: async () => linkedin, configuredCredentials: async () => ({ appId: 'synthetic', appSecret: 'synthetic' }), configuredEngine: async () => ({ adapter: createLinkedinAdapter(linkedin).adapter, renew: mocks.renewal }) }));
vi.mock('../src/platforms/pinterest/runtime', () => ({ configuredPolicy: async () => pinterest, configuredCredentials: async () => ({ appId: 'synthetic', appSecret: 'synthetic' }), configuredEngine: async () => ({ adapter: { getAuthorizationUrl: ({ redirectUri }: { redirectUri: string }) => `https://provider.example.test/?redirect_uri=${encodeURIComponent(redirectUri)}` }, renew: mocks.renewal }) }));
import { renewLinkedinTokens } from '../src/platforms/linkedin/jobs';
import { renewPinterestTokens } from '../src/platforms/pinterest/jobs';
import { persistDiscovery as persistLinkedin } from '../src/platforms/linkedin/connection';
import { persistDiscovery as persistPinterest } from '../src/platforms/pinterest/connection';
import { linkedinConnection } from '../src/platforms/linkedin/connection';
import { pinterestConnection } from '../src/platforms/pinterest/connection';
const viewer = { user: { id: 'user' }, workspaceId: 'workspace' } as Parameters<NonNullable<typeof linkedinConnection.start>>[1];
beforeEach(() => {
  mocks.role = 'owner'; mocks.workspaceId = 'workspace'; mocks.enabled = true;
  mocks.runtime.mockResolvedValue('https://app.example.test');
  mocks.renewal.mockReset(); mocks.account.mockReset().mockResolvedValue({ id: 'account' }); mocks.metadata.mockClear();
  vi.stubEnv('ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
});
describe('installed LinkedIn/Pinterest shared connection hosts', () => {
  it.each([[linkedinModule, linkedinConnection], [pinterestModule, pinterestConnection]] as const)('uses the Root origin for %s OAuth, ignoring request forwarding headers', async (module, connection) => {
    const response = await connection.start!(new NextRequest('http://internal:3100/api/start', { headers: { origin: 'https://attacker.example.test', 'x-forwarded-host': 'attacker.example.test' } }), viewer);
    const url = new URL((await response.json()).authorizationUrl);
    expect(url.searchParams.get('redirect_uri')).toBe(`https://app.example.test/api/connections/${module.id}/callback`);
    expect(response.headers.get('set-cookie')).toContain('Secure');
    expect(mocks.runtime).toHaveBeenCalledWith('app.publicOrigin');
  });
  it.each([linkedinConnection, pinterestConnection])('redirects invalid callbacks to the configured public origin', async connection => {
    const response = await connection.callback!(new NextRequest('http://internal:3100/api/callback?code=synthetic&state=invalid'), viewer);
    expect(response.headers.get('location')).toBe('https://app.example.test/settings/connections?notice=oauth_invalid_state');
  });
  it.each([linkedinConnection, pinterestConnection])('refuses member, viewer, removed membership, foreign workspace and disabled module before OAuth', async connection => {
    const request = new NextRequest('https://app.example.test/api/start');
    for (const role of ['member', 'viewer', null]) {
      mocks.role = role;
      await expect(connection.start!(request, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    }
    mocks.role = 'owner'; mocks.workspaceId = 'another-workspace';
    await expect(connection.start!(request, viewer)).rejects.toMatchObject({ code: 'forbidden' });
    mocks.workspaceId = 'workspace'; mocks.enabled = false;
    await expect(connection.start!(request, viewer)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it.each([linkedinConnection, pinterestConnection])('renews only with a refresh token and retains it when the provider does not rotate', async connection => {
    expect(await connection.renewToken!({ accessToken: 'old', refreshToken: null, signal: new AbortController().signal })).toBeNull();
    const expiresAt = new Date('2030-01-01');
    mocks.renewal.mockResolvedValue({ accessToken: 'fresh', refreshToken: null, expiresAt });
    expect(await connection.renewToken!({ accessToken: 'old', refreshToken: 'refresh', signal: new AbortController().signal })).toEqual({ accessToken: 'fresh', refreshToken: 'refresh', expiresAt });
  });
  it.each([[renewLinkedinTokens, 'linkedin', linkedin], [renewPinterestTokens, 'pinterest', pinterest]] as const)('wires automatic renewal through shared authorization and rotation', async (run, provider, policy) => {
    const result = { examined: 1, updated: 1, skipped: 0, failed: 0 };
    mocks.job.mockResolvedValue(result);
    const now = new Date('2030-01-01');
    expect(await run(now, 2)).toEqual(result);
    const input = mocks.job.mock.lastCall![0];
    expect(input).toMatchObject({ provider, leadSeconds: policy.renewLeadSeconds, now, retryLimit: 2 });
    mocks.renewal.mockResolvedValue({ accessToken: 'fresh', expiresAt: now });
    await input.refresh('refresh');
    expect(mocks.renewal).toHaveBeenCalledWith('synthetic', 'synthetic', 'refresh', undefined);
  });
  it.each([persistLinkedin, persistPinterest])('keeps access expiry separate from renewable grant expiry in persistence', async persist => {
    const expiresAt = new Date('2030-01-01');
    await persist(viewer, { user: { id: 'synthetic', name: 'Example', pictureUrl: null }, accessToken: 'synthetic', refreshToken: 'refresh', expiresAt, scopes: [], targets: [] });
    expect(mocks.account.mock.lastCall![0].create.tokenExpiresAt).toBeNull();
    expect(mocks.metadata.mock.lastCall!.slice(1)).toEqual([JSON.stringify({ accessTokenExpiresAt: expiresAt.toISOString() }), 'account', 'workspace']);
    await persist(viewer, { user: { id: 'synthetic', name: 'Example', pictureUrl: null }, accessToken: 'synthetic', refreshToken: null, expiresAt, scopes: [], targets: [] });
    expect(mocks.account.mock.lastCall![0].create.tokenExpiresAt).toEqual(expiresAt);
  });
  it.each([[renewLinkedinTokens, LinkedinError], [renewPinterestTokens, PinterestError]] as const)('bridges rejected refresh grants but preserves transient and unknown failures', async (run, ProviderError) => {
    mocks.job.mockResolvedValue({ examined: 0, updated: 0, skipped: 0, failed: 0 });
    await run();
    const refresh = mocks.job.mock.lastCall![0].refresh;
    for (const status of [400, 401]) {
      mocks.renewal.mockRejectedValue(new ProviderError(status, true));
      const error = await refresh('synthetic').catch((failure: unknown) => failure);
      expect(error).toBeInstanceOf(ProviderHttpError);
      expect(error).toMatchObject({ status, outcome: 'rejected', retryable: false });
    }
    for (const failure of [new ProviderError(429, false), new ProviderError(500, false), new Error('synthetic timeout')]) {
      mocks.renewal.mockRejectedValue(failure);
      await expect(refresh('synthetic')).rejects.toBe(failure);
    }
  });
  it('uses LinkedIn refresh grant and records actual returned expiry and scopes', async () => {
    const fetcher = vi.fn(async () => Response.json({ access_token: 'fresh', refresh_token: 'rotated', expires_in: 3600, scope: 'w_member_social' }));
    const token = await createLinkedinAdapter(linkedin, fetcher).renew('app', 'secret', 'old');
    expect(token).toMatchObject({ accessToken: 'fresh', refreshToken: 'rotated', scopes: ['w_member_social'] });
    expect(token.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const init = (fetcher.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]![1];
    expect((init.body as URLSearchParams).get('grant_type')).toBe('refresh_token');
    expect((init.body as URLSearchParams).get('refresh_token')).toBe('old');
  });
});
