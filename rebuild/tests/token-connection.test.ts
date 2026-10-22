import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const tx = {
    membership: { findUnique: vi.fn() },
    socialAccount: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    target: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $executeRaw: vi.fn(),
  };
  return {
    membership: vi.fn(), access: vi.fn(), permissions: vi.fn(), enabled: vi.fn(), origin: vi.fn(),
    tx, audit: vi.fn(), lock: vi.fn(),
    prisma: {
      $transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
      membership: { findUnique: vi.fn() },
      $queryRaw: vi.fn(), $executeRaw: vi.fn(),
      socialAccount: { updateMany: vi.fn(), findMany: vi.fn() }, target: { findFirst: vi.fn() },
    },
  };
});
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.origin }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.access, canUseFeature: () => true, hasPlatformCapability: () => true }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('../src/server/platforms/registry', () => ({ isPlatformEnabled: mocks.enabled }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: vi.fn(), withWorkspaceOperation: async (_id: string, run: () => unknown) => run() }));
vi.mock('../src/server/connection-mutations', () => ({ auditConnectionEvent: mocks.audit }));
vi.mock('../src/server/platforms/resource-lock', () => ({ lockSelectedResources: mocks.lock }));

import { decryptSecret, encryptSecret } from '../src/server/secret-crypto';
import {
  createTokenOAuthState, finishTokenOAuth, freshStoredAccessToken, openTokenOAuthState, persistTokenConnection, pkceChallenge,
  renewStoredConnection, startTokenOAuth, tokenCallbackPath, tokenOAuthCookie, type StoredToken, type TokenOAuthFlow,
} from '../src/server/platforms/token-connection';
import { ProviderHttpError } from '../src/server/platforms/provider-http';

const viewer = { user: { id: 'user-1' }, workspaceId: 'ws-1' };
const result = {
  providerUserId: 'acct-1', name: 'Example', pictureUrl: null, accessToken: 'access-1', refreshToken: 'refresh-1',
  accessExpiresAt: new Date('2026-10-22T11:00:00Z'), grantExpiresAt: null, scopes: ['one', 'two'],
  destinations: [{ providerId: 'dest-1', name: 'Destination one', pictureUrl: null }],
};

beforeEach(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  vi.clearAllMocks();
  mocks.origin.mockResolvedValue('https://app.example.test');
  mocks.prisma.membership.findUnique.mockResolvedValue({ role: 'owner' });
  mocks.access.mockResolvedValue({ workspaceId: 'ws-1' });
  mocks.permissions.mockResolvedValue({});
  mocks.enabled.mockResolvedValue(true);
  mocks.prisma.$transaction.mockImplementation(async (run: (client: typeof mocks.tx) => unknown) => run(mocks.tx));
});

describe('OAuth state', () => {
  it('seals state to the initiating user and workspace and carries a PKCE verifier only when asked', () => {
    const now = 1_800_000_000_000;
    const plain = createTokenOAuthState({ userId: 'user-1', workspaceId: 'ws-1', ttlSeconds: 300, pkce: false, now });
    expect(plain.verifier).toBeNull();
    expect(plain.cookieValue).not.toContain(plain.state);
    expect(openTokenOAuthState(plain.cookieValue, plain.state, 'user-1', 'ws-1', now + 299_000)).toEqual({ verifier: null });
    expect(openTokenOAuthState(plain.cookieValue, plain.state, 'user-2', 'ws-1', now)).toBeNull();
    expect(openTokenOAuthState(plain.cookieValue, plain.state, 'user-1', 'ws-2', now)).toBeNull();
    expect(openTokenOAuthState(plain.cookieValue, `${plain.state}x`, 'user-1', 'ws-1', now)).toBeNull();
    expect(openTokenOAuthState(plain.cookieValue, plain.state, 'user-1', 'ws-1', now + 300_000)).toBeNull();
    expect(openTokenOAuthState(undefined, plain.state, 'user-1', 'ws-1', now)).toBeNull();
    expect(openTokenOAuthState('not-a-cookie', plain.state, 'user-1', 'ws-1', now)).toBeNull();
    const pkce = createTokenOAuthState({ userId: 'user-1', workspaceId: 'ws-1', ttlSeconds: 300, pkce: true, now });
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(openTokenOAuthState(pkce.cookieValue, pkce.state, 'user-1', 'ws-1', now)).toEqual({ verifier: pkce.verifier });
    expect(pkceChallenge(pkce.verifier!)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it('names cookie and callback per provider', () => {
    expect(tokenOAuthCookie('youtube')).toBe('msp_youtube_oauth');
    expect(tokenCallbackPath('tiktok')).toBe('/api/connections/tiktok/callback');
  });
});

describe('connection start and finish', () => {
  const flow = (patch: Partial<TokenOAuthFlow> = {}): TokenOAuthFlow => ({
    provider: 'youtube', pkce: true, stateTtlSeconds: async () => 600,
    authorizationUrl: async ({ redirectUri, state, challenge }) => `https://auth.example.test/?r=${encodeURIComponent(redirectUri)}&s=${state}&c=${challenge}`,
    complete: vi.fn(async () => result), ...patch,
  });
  it('sets a short-lived httpOnly state cookie scoped to the callback and uses the public origin', async () => {
    const response = await startTokenOAuth(flow(), new Request('http://localhost:3100/api/connections/youtube/start', { method: 'POST' }), viewer);
    const body = await response.json();
    const url = new URL(body.authorizationUrl);
    expect(decodeURIComponent(url.searchParams.get('r')!)).toBe('https://app.example.test/api/connections/youtube/callback');
    const cookie = response.cookies.get('msp_youtube_oauth')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/api/connections/youtube/callback', maxAge: 600, secure: true });
    expect(openTokenOAuthState(cookie.value, url.searchParams.get('s'), 'user-1', 'ws-1')).not.toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it.each(['member', 'viewer', 'editor'])('refuses %s before contacting the provider', async role => {
    mocks.prisma.membership.findUnique.mockResolvedValue({ role });
    const authorizationUrl = vi.fn();
    const response = await startTokenOAuth(flow({ authorizationUrl }), new Request('https://internal.invalid/start'), viewer);
    expect(response.status).toBe(503);
    expect(authorizationUrl).not.toHaveBeenCalled();
  });
  it('refuses a cross-workspace entitlement before contacting the provider', async () => {
    mocks.access.mockResolvedValue({ workspaceId: 'another-workspace' });
    const authorizationUrl = vi.fn();
    expect((await startTokenOAuth(flow({ authorizationUrl }), new Request('https://internal.invalid/start'), viewer)).status).toBe(503);
    expect(authorizationUrl).not.toHaveBeenCalled();
  });
  it('answers 503 without a cookie when the module is not configured', async () => {
    const response = await startTokenOAuth(flow({ authorizationUrl: async () => null }), new Request('https://app.example.test/x', { method: 'POST' }), viewer);
    expect(response.status).toBe(503);
    expect(response.cookies.get('msp_youtube_oauth')).toBeUndefined();
  });
  const callback = (query: string, cookie?: string) => ({ url: `https://localhost:3100/api/connections/youtube/callback?${query}`, cookies: { get: (name: string) => (cookie && name === 'msp_youtube_oauth' ? { value: cookie } : undefined) } }) as unknown as NextRequest;
  it('refuses a callback whose state does not match this user, and never exchanges the code', async () => {
    const complete = vi.fn(async () => result);
    const started = createTokenOAuthState({ userId: 'other', workspaceId: 'ws-1', ttlSeconds: 60, pkce: false });
    const response = await finishTokenOAuth(flow({ complete }), callback(`code=c&state=${started.state}`, started.cookieValue), viewer);
    expect(response.headers.get('location')).toContain('notice=oauth_invalid_state');
    expect(complete).not.toHaveBeenCalled();
  });
  it.each(['member', 'viewer'])('rechecks %s authority before exchanging a valid callback', async role => {
    const started = createTokenOAuthState({ userId: 'user-1', workspaceId: 'ws-1', ttlSeconds: 60, pkce: false });
    mocks.prisma.membership.findUnique.mockResolvedValue({ role });
    const complete = vi.fn(async () => result);
    const response = await finishTokenOAuth(flow({ complete }), callback(`code=c&state=${started.state}`, started.cookieValue), viewer);
    expect(response.headers.get('location')).toContain('notice=connect_failed');
    expect(complete).not.toHaveBeenCalled();
  });
  it('treats a provider error as a cancellation and clears the state cookie', async () => {
    const started = createTokenOAuthState({ userId: 'user-1', workspaceId: 'ws-1', ttlSeconds: 60, pkce: false });
    const response = await finishTokenOAuth(flow(), callback(`error=access_denied&state=${started.state}`, started.cookieValue), viewer);
    expect(response.headers.get('location')).toContain('notice=oauth_cancelled');
    expect(response.cookies.get('msp_youtube_oauth')).toMatchObject({ value: '', maxAge: 0 });
  });
  it('persists the connection and opens destination selection', async () => {
    const started = createTokenOAuthState({ userId: 'user-1', workspaceId: 'ws-1', ttlSeconds: 60, pkce: true });
    const complete = vi.fn(async () => result);
    mocks.tx.membership.findUnique.mockResolvedValue({ role: 'owner' });
    mocks.tx.socialAccount.findUnique.mockResolvedValue(null);
    mocks.tx.target.findMany.mockResolvedValue([]);
    mocks.tx.socialAccount.upsert.mockResolvedValue({ id: 'sa-1' });
    mocks.tx.target.findUnique.mockResolvedValue(null);
    const response = await finishTokenOAuth(flow({ complete }), callback(`code=abc&state=${started.state}`, started.cookieValue), viewer);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ code: 'abc', redirectUri: 'https://app.example.test/api/connections/youtube/callback', verifier: started.verifier }));
    expect(response.headers.get('location')).toBe('https://app.example.test/settings/connections?notice=connected&select=1');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it('reports a failed exchange without provider text and audits only the stage', async () => {
    const started = createTokenOAuthState({ userId: 'user-1', workspaceId: 'ws-1', ttlSeconds: 60, pkce: false });
    const complete = vi.fn(async () => { throw new Error('secret=abc leaked'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await finishTokenOAuth(flow({ complete }), callback(`code=abc&state=${started.state}`, started.cookieValue), viewer);
    expect(response.headers.get('location')).toContain('notice=connect_failed');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('leaked');
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, { userId: 'user-1', workspaceId: 'ws-1' }, 'connection.youtube_failed', { stage: 'exchange' });
    warn.mockRestore();
  });
});

describe('persistTokenConnection', () => {
  const actor = { userId: 'user-1', workspaceId: 'ws-1' };
  beforeEach(() => {
    mocks.tx.membership.findUnique.mockResolvedValue({ role: 'admin' });
    mocks.tx.socialAccount.findUnique.mockResolvedValue(null);
    mocks.tx.target.findMany.mockResolvedValue([]);
    mocks.tx.socialAccount.upsert.mockResolvedValue({ id: 'sa-1' });
  });
  it('refuses anyone who is not a current owner or admin', async () => {
    mocks.tx.membership.findUnique.mockResolvedValue({ role: 'editor' });
    await expect(persistTokenConnection(actor, 'youtube', result)).rejects.toThrow();
    mocks.tx.membership.findUnique.mockResolvedValue(null);
    await expect(persistTokenConnection(actor, 'youtube', result)).rejects.toThrow();
    expect(mocks.tx.socialAccount.upsert).not.toHaveBeenCalled();
  });
  it('disables destinations missing on reconnect without deleting their retained data', async () => {
    await persistTokenConnection(actor, 'youtube', result);
    expect(mocks.tx.target.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', socialAccountId: 'sa-1', type: 'youtube', providerId: { notIn: ['dest-1'] } },
      data: { enabled: false, canPublish: false },
    });
  });
  it('stores credentials encrypted and creates new destinations switched off', async () => {
    mocks.tx.target.findUnique.mockResolvedValue(null);
    expect(await persistTokenConnection(actor, 'youtube', result)).toEqual({ saved: 1, skipped: 0 });
    const upsert = mocks.tx.socialAccount.upsert.mock.calls[0]![0];
    expect(upsert.create).toMatchObject({ workspaceId: 'ws-1', provider: 'youtube', providerUserId: 'acct-1', scopes: 'one,two', tokenExpiresAt: null });
    expect(upsert.create.accessToken).not.toBe('access-1');
    expect(decryptSecret(upsert.create.accessToken)).toBe('access-1');
    expect(decryptSecret(upsert.create.refreshToken)).toBe('refresh-1');
    const created = mocks.tx.target.create.mock.calls[0]![0].data;
    expect(created).toMatchObject({ workspaceId: 'ws-1', providerId: 'dest-1', type: 'youtube', socialAccountId: 'sa-1', enabled: false });
    expect(decryptSecret(created.accessToken)).toBe('access-1');
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, actor, 'connection.youtube_connected', expect.objectContaining({ destinations: 1, skipped: 0 }));
    // The access token's end is recorded for renewal, in the same transaction.
    expect(JSON.stringify(mocks.tx.$executeRaw.mock.calls[0])).toContain('2026-10-22T11:00:00.000Z');
  });
  it('keeps the customer’s selection when reconnecting the same connection', async () => {
    mocks.tx.target.findUnique.mockResolvedValue({ id: 't-1', socialAccountId: 'sa-1', type: 'youtube' });
    await persistTokenConnection(actor, 'youtube', result);
    expect(mocks.tx.target.update.mock.calls[0]![0].data).not.toHaveProperty('enabled');
  });
  it('never takes a destination owned by another connection or another module', async () => {
    mocks.tx.target.findUnique.mockResolvedValue({ id: 't-1', socialAccountId: 'sa-other', type: 'youtube' });
    expect(await persistTokenConnection(actor, 'youtube', result)).toEqual({ saved: 0, skipped: 1 });
    mocks.tx.target.findUnique.mockResolvedValue({ id: 't-2', socialAccountId: null, type: 'page' });
    expect(await persistTokenConnection(actor, 'youtube', result)).toEqual({ saved: 0, skipped: 1 });
    expect(mocks.tx.target.update).not.toHaveBeenCalled();
    expect(mocks.tx.target.create).not.toHaveBeenCalled();
  });
});

describe('renewal', () => {
  const stored = (patch: Partial<StoredToken> = {}): StoredToken => ({
    socialAccountId: 'sa-1', accessToken: 'old-access', storedAccessToken: encryptSecret('old-access'), refreshToken: 'old-refresh',
    accessExpiresAt: new Date(Date.now() + 60_000), grantExpiresAt: null, scopes: [], ...patch,
  });
  it('is not renewable without a refresh token', async () => {
    expect(await renewStoredConnection('ws-1', stored({ refreshToken: null }), vi.fn())).toEqual({ outcome: 'not_renewable', accessToken: 'old-access' });
  });
  it('saves a renewed token on the connection and every destination copy', async () => {
    mocks.tx.socialAccount.updateMany.mockResolvedValue({ count: 1 });
    const refresh = vi.fn(async () => ({ accessToken: 'new-access', refreshToken: 'new-refresh', accessExpiresAt: new Date('2026-10-22T12:00:00Z') }));
    const previous = encryptSecret('old-access');
    expect(await renewStoredConnection('ws-1', stored({ storedAccessToken: previous }), refresh)).toEqual({ outcome: 'renewed', accessToken: 'new-access' });
    expect(refresh).toHaveBeenCalledWith('old-refresh');
    const update = mocks.tx.socialAccount.updateMany.mock.calls[0]![0];
    expect(update.where).toMatchObject({ id: 'sa-1', workspaceId: 'ws-1', invalidatedAt: null, accessToken: previous });
    expect(decryptSecret(update.data.accessToken)).toBe('new-access');
    expect(decryptSecret(update.data.refreshToken)).toBe('new-refresh');
    expect(update.data).not.toHaveProperty('tokenExpiresAt');
    expect(mocks.tx.target.updateMany.mock.calls[0]![0].where).toEqual({ workspaceId: 'ws-1', socialAccountId: 'sa-1' });
  });
  it('writes the grant’s end only when the module reports one', async () => {
    mocks.tx.socialAccount.updateMany.mockResolvedValue({ count: 1 });
    const end = new Date('2027-10-22T00:00:00Z');
    await renewStoredConnection('ws-1', stored(), async () => ({ accessToken: 'n', accessExpiresAt: null, grantExpiresAt: end }));
    expect(mocks.tx.socialAccount.updateMany.mock.calls[0]![0].data.tokenExpiresAt).toEqual(end);
  });
  it('reports a lost race when another renewal already replaced the token, and writes nothing else', async () => {
    mocks.tx.socialAccount.updateMany.mockResolvedValue({ count: 0 });
    const outcome = await renewStoredConnection('ws-1', stored(), async () => ({ accessToken: 'n', accessExpiresAt: null }));
    expect(outcome.outcome).toBe('raced');
    expect(mocks.tx.target.updateMany).not.toHaveBeenCalled();
  });
  it('marks the connection for reconnection when the provider rejects the refresh grant', async () => {
    const outcome = await renewStoredConnection('ws-1', stored(), async () => { throw new ProviderHttpError('x', 'rejected', false, 400); });
    expect(outcome.outcome).toBe('revoked');
    expect(mocks.prisma.socialAccount.updateMany).toHaveBeenCalledWith({ where: { id: 'sa-1', workspaceId: 'ws-1', invalidatedAt: null }, data: expect.objectContaining({ invalidReason: 'refresh_rejected' }) });
  });
  it('leaves the credential alone on a transient failure', async () => {
    const outcome = await renewStoredConnection('ws-1', stored(), async () => { throw new ProviderHttpError('x', 'rejected', true, 503); });
    expect(outcome.outcome).toBe('unavailable');
    expect(mocks.prisma.socialAccount.updateMany).not.toHaveBeenCalled();
    expect((await renewStoredConnection('ws-1', stored(), async () => { throw new Error('network'); })).outcome).toBe('unavailable');
  });
});

describe('freshStoredAccessToken', () => {
  const account = (accessExpiresAt: string | null) => {
    mocks.prisma.target.findFirst.mockResolvedValue({ socialAccount: { id: 'sa-1', accessToken: encryptSecret('stored-access'), refreshToken: encryptSecret('stored-refresh'), tokenExpiresAt: null, scopes: 'a' } });
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: 'sa-1', expires: accessExpiresAt }]);
  };
  const input = (refresh = vi.fn(async () => ({ accessToken: 'renewed', accessExpiresAt: null }))) => ({ workspaceId: 'ws-1', targetId: 't-1', provider: 'youtube', leadMs: 20 * 60_000, fallback: 'caller-token', refresh, now: new Date('2026-10-22T10:00:00Z') });
  it('uses the caller’s token when the destination has no usable stored connection', async () => {
    mocks.prisma.target.findFirst.mockResolvedValue(null);
    expect(await freshStoredAccessToken(input())).toEqual({ accessToken: 'caller-token', outcome: 'fresh' });
  });
  it('uses the stored token while it has more than the lead time left', async () => {
    account('2026-10-22T11:00:00Z');
    const request = input();
    expect(await freshStoredAccessToken(request)).toEqual({ accessToken: 'stored-access', outcome: 'fresh' });
    expect(request.refresh).not.toHaveBeenCalled();
  });
  it('does not renew blindly when the token’s end is unknown', async () => {
    account(null);
    const request = input();
    expect((await freshStoredAccessToken(request)).accessToken).toBe('stored-access');
    expect(request.refresh).not.toHaveBeenCalled();
  });
  it('renews inside the lead time', async () => {
    account('2026-10-22T10:05:00Z');
    mocks.tx.socialAccount.updateMany.mockResolvedValue({ count: 1 });
    const request = input();
    expect(await freshStoredAccessToken(request)).toEqual({ accessToken: 'renewed', outcome: 'renewed' });
    expect(request.refresh).toHaveBeenCalledWith('stored-refresh');
  });
  it('rereads the stored token after losing a renewal race', async () => {
    account('2026-10-22T10:05:00Z');
    mocks.tx.socialAccount.updateMany.mockResolvedValue({ count: 0 });
    expect((await freshStoredAccessToken(input())).accessToken).toBe('stored-access');
  });
});
