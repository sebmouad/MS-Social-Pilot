import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const m = vi.hoisted(() => ({ session: vi.fn(), usable: vi.fn(), membership: vi.fn(), permissions: vi.fn(), entitlements: vi.fn(), allowed: vi.fn(), feature: vi.fn(), capability: vi.fn(), config: vi.fn(), flow: vi.fn(), start: vi.fn(), ready: vi.fn(), lock: vi.fn(), audit: vi.fn(), tx: vi.fn() }));
vi.mock('@/server/data', () => ({ getSessionByTokenHash: m.session, prisma: { membership: { findUnique: m.membership }, $transaction: m.tx } }));
vi.mock('@/server/auth', () => ({ isUsableLegacySession: m.usable }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: m.permissions }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: m.allowed }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: m.entitlements, canUseFeature: m.feature, hasPlatformCapability: m.capability }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/account-settings', () => ({ auditAccountMutation: m.audit }));
vi.mock('@/server/platforms/registry', () => ({ connectionFlow: m.flow }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: m.lock }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://app.example.test' }));
import { startConnection } from '@/modules/settings/server/connection-start';
const actor = { userId: 'user', workspaceId: 'workspace', sessionTokenHash: 'hash' };
const input = { platform: 'example', confirmation: 'START CONNECTION example' };
const request = () => new Request('http://untrusted-proxy.test/api/oauth/connections/example/start', { method: 'POST', headers: { origin: 'https://app.example.test' } });
beforeEach(() => {
  vi.clearAllMocks(); m.usable.mockReturnValue(true); m.allowed.mockReturnValue(true); m.feature.mockReturnValue(true); m.capability.mockReturnValue(true);
  m.membership.mockResolvedValue({ role: 'admin' }); m.permissions.mockResolvedValue({}); m.entitlements.mockResolvedValue({ workspaceId: 'workspace' });
  m.config.mockResolvedValue('https://app.example.test'); m.flow.mockResolvedValue({ start: m.start, isReady: m.ready }); m.ready.mockResolvedValue(true);
  m.lock.mockImplementation(async (_id, run) => run()); m.tx.mockImplementation(async run => run({}));
  m.start.mockImplementation(async () => { const response = NextResponse.json({ authorizationUrl: 'https://provider.example.test/authorize?state=public-csrf', secret: 'NEVER RETURN' }); response.cookies.set('provider-state', 'private-envelope', { httpOnly: true, secure: true, sameSite: 'lax', path: '/callback' }); return response; });
});
describe('shared OAuth startup', () => {
  it('returns only the authorization URL, preserves private cookies and audits no URL/state/secret', async () => {
    const response = await startConnection(actor, input, request());
    expect(await response.json()).toEqual({ authorizationUrl: 'https://provider.example.test/authorize?state=public-csrf' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.cookies.get('provider-state')).toMatchObject({ value: 'private-envelope', httpOnly: true, secure: true, path: '/callback' });
    expect(m.start.mock.calls[0]![0].url).toBe('https://app.example.test/api/oauth/connections/example/start');
    expect(m.start.mock.calls[0]![1]).toEqual({ user: { id: 'user' }, workspaceId: 'workspace' });
    expect(m.audit).toHaveBeenCalledWith(expect.anything(), 'user', 'connection.authorization_started', { workspaceId: 'workspace', platform: 'example' });
    expect(JSON.stringify(m.audit.mock.calls)).not.toMatch(/private-envelope|public-csrf|NEVER RETURN/);
  });
  it.each([{ apiKeyId: 'key' }, { sessionTokenHash: '' }])('refuses non-session actors %j', async patch => {
    await expect(startConnection({ ...actor, ...patch }, input, request())).rejects.toMatchObject({ code: 'forbidden' }); expect(m.start).not.toHaveBeenCalled();
  });
  it('rejects stale sessions and exact-confirmation mismatches before starting a flow', async () => {
    m.usable.mockReturnValue(false); await expect(startConnection(actor, input, request())).rejects.toMatchObject({ code: 'unauthorized' });
    m.usable.mockReturnValue(true); await expect(startConnection(actor, { ...input, confirmation: 'START CONNECTION other' }, request())).rejects.toMatchObject({ code: 'invalid_request' }); expect(m.start).not.toHaveBeenCalled();
  });
  it.each(['membership', 'permissions', 'entitlements', 'capability', 'feature', 'ready'])('rechecks current %s authority', async kind => {
    if (kind === 'membership') m.membership.mockResolvedValue({ role: 'editor' });
    else if (kind === 'permissions') m.allowed.mockReturnValue(false);
    else if (kind === 'entitlements') m.entitlements.mockResolvedValue({ workspaceId: 'other' });
    else m[kind as 'capability' | 'feature' | 'ready'].mockReturnValue(false);
    await expect(startConnection(actor, input, request())).rejects.toBeDefined(); expect(m.start).not.toHaveBeenCalled();
  });
  it('fails closed on purge/suspension and untrusted Origin', async () => {
    m.lock.mockRejectedValueOnce(new Error('purge')); await expect(startConnection(actor, input, request())).rejects.toThrow('purge'); expect(m.start).not.toHaveBeenCalled();
    await expect(startConnection(actor, input, new Request('https://app.example.test/start', { headers: { origin: 'https://evil.test' } }))).rejects.toMatchObject({ code: 'forbidden' }); expect(m.start).not.toHaveBeenCalled();
  });
  it('does not expose provider failures or unexpected fields', async () => {
    m.start.mockResolvedValue(NextResponse.json({ error: 'private provider payload', secret: 'token' }, { status: 503 }));
    await expect(startConnection(actor, input, request())).rejects.toMatchObject({ code: 'upstream_failure', message: 'Connection unavailable. Try again or contact support.' }); expect(m.audit).not.toHaveBeenCalled();
  });
  it.each(['javascript:alert(1)', 'https://name:password@provider.test/'])('rejects unsafe authorization URL %s', async authorizationUrl => {
    m.start.mockResolvedValue(NextResponse.json({ authorizationUrl })); await expect(startConnection(actor, input, request())).rejects.toMatchObject({ code: 'upstream_failure' });
  });
});
