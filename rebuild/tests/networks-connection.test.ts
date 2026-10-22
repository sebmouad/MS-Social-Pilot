import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POLICY_DEFAULTS as linkedinPolicy } from '../src/platforms/linkedin/config';
import { POLICY_DEFAULTS as pinterestPolicy } from '../src/platforms/pinterest/config';
const m = vi.hoisted(() => ({ membership: vi.fn(), permissions: vi.fn(), access: vi.fn(), enabled: vi.fn(), existing: vi.fn(), findTargets: vi.fn(), target: vi.fn(), upsert: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), audit: vi.fn(), lock: vi.fn(), exchange: vi.fn(), currentUser: vi.fn(), discover: vi.fn(), authUrl: vi.fn(), renew: vi.fn(), raw: vi.fn(), runtime: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: {
  membership: { findUnique: m.membership },
  $transaction: (run: (tx: unknown) => unknown) => run({ $executeRaw: m.raw, membership: { findUnique: m.membership }, socialAccount: { findUnique: m.existing, upsert: m.upsert }, target: { findMany: m.findTargets, findUnique: m.target, create: m.create, update: m.update, updateMany: m.updateMany } }),
} }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: m.access, canUseFeature: (access: { feature: boolean }) => access.feature, hasPlatformCapability: (access: { platform: boolean }) => access.platform }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: m.permissions }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: (permissions: { write: boolean }) => permissions.write }));
vi.mock('@/server/platforms/registry', () => ({ isPlatformEnabled: m.enabled }));
vi.mock('@/server/platforms/resource-lock', () => ({ lockSelectedResources: m.lock }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_workspaceId: string, run: () => unknown) => run() }));
vi.mock('@/modules/settings/server/connection-mutations', () => ({ auditConnectionEvent: m.audit }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.runtime }));
vi.mock('@/platforms/linkedin/runtime', async () => {
  const { POLICY_DEFAULTS } = await import('../src/platforms/linkedin/config');
  return { configuredPolicy: async () => POLICY_DEFAULTS, configuredCredentials: async () => ({ appId: 'app', appSecret: 'synthetic-secret' }), configuredEngine: async () => ({ exchange: m.exchange, currentUser: m.currentUser, adapter: { discover: m.discover, getAuthorizationUrl: m.authUrl } }) };
});
vi.mock('@/platforms/pinterest/runtime', async () => {
  const { POLICY_DEFAULTS } = await import('../src/platforms/pinterest/config');
  return { configuredPolicy: async () => POLICY_DEFAULTS, configuredCredentials: async () => ({ appId: 'app', appSecret: 'synthetic-secret' }), configuredEngine: async () => ({ exchange: m.exchange, renew: m.renew, currentUser: m.currentUser, adapter: { discover: m.discover, getAuthorizationUrl: m.authUrl } }) };
});
import { authorizeConnection as liAuthorize, persistDiscovery as liPersist, linkedinConnection } from '../src/platforms/linkedin/connection';
import { authorizeConnection as pinAuthorize, persistDiscovery as pinPersist, pinterestConnection } from '../src/platforms/pinterest/connection';
import { decryptSecret } from '../src/server/secret-crypto';

const viewer = { user: { id: 'owner' }, workspaceId: 'workspace' };
const lanes = [
  { id: 'linkedin', authorize: liAuthorize, persist: liPersist, connection: linkedinConnection, policy: linkedinPolicy, remoteId: 'urn:li:person:member' },
  { id: 'pinterest', authorize: pinAuthorize, persist: pinPersist, connection: pinterestConnection, policy: pinterestPolicy, remoteId: 'board-one' },
];
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ENCRYPTION_KEY', Buffer.alloc(32, 4).toString('base64'));
  m.runtime.mockResolvedValue('https://app.example.test');
  m.membership.mockResolvedValue({ role: 'owner' }); m.permissions.mockResolvedValue({ write: true });
  m.access.mockResolvedValue({ workspaceId: 'workspace', feature: true, platform: true }); m.enabled.mockResolvedValue(true);
  m.findTargets.mockResolvedValue([]); m.existing.mockResolvedValue(null); m.target.mockResolvedValue(null); m.upsert.mockResolvedValue({ id: 'source' });
  m.authUrl.mockReturnValue('https://provider.example.test/oauth');
  m.exchange.mockResolvedValue({ accessToken: 'new-token', refreshToken: 'new-refresh', expiresAt: new Date('2027-01-01'), scopes: ['w_member_social', 'pins:write'] });
  m.currentUser.mockResolvedValue({ id: 'member', name: 'Example Studio', pictureUrl: null });
});
for (const lane of lanes) describe(`${lane.id} connection service`, () => {
  const input = () => ({ user: { id: 'member', name: 'Example Studio', pictureUrl: null }, accessToken: 'synthetic-token', refreshToken: 'synthetic-refresh', expiresAt: new Date('2027-01-01'), scopes: ['w_member_social', 'pins:write'], targets: [{ id: lane.remoteId, name: 'Example channel', kind: lane.id }] });
  it.each(['owner', 'admin'])('authorizes current %s', async role => {
    m.membership.mockResolvedValue({ role }); await expect(lane.authorize(viewer)).resolves.toBeUndefined();
  });
  it.each(['member', 'viewer', 'contributor'])('denies %s without reading or writing provider data', async role => {
    m.membership.mockResolvedValue({ role });
    await expect(lane.persist(viewer, input())).rejects.toMatchObject({ code: 'forbidden' });
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it('denies an absent membership or mismatched entitlement workspace', async () => {
    m.membership.mockResolvedValue(null);
    await expect(lane.authorize(viewer)).rejects.toMatchObject({ code: 'forbidden' });
    m.membership.mockResolvedValue({ role: 'owner' }); m.access.mockResolvedValue({ workspaceId: 'other', feature: true, platform: true });
    await expect(lane.authorize(viewer)).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('requires current write permission and enabled platform access', async () => {
    m.permissions.mockResolvedValue({ write: false });
    await expect(lane.authorize(viewer)).rejects.toThrow();
    m.permissions.mockResolvedValue({ write: true }); m.enabled.mockResolvedValue(false);
    await expect(lane.authorize(viewer)).rejects.toThrow();
  });
  it('encrypts credentials, scopes every query and creates destinations unselected', async () => {
    expect(await lane.persist(viewer, input())).toEqual({ saved: 1, skipped: 0 });
    const account = m.upsert.mock.calls[0]![0];
    expect(account.where.workspaceId_provider_providerUserId.workspaceId).toBe('workspace');
    expect(account.create.provider).toBe(lane.id);
    expect(decryptSecret(account.create.accessToken)).toBe('synthetic-token');
    expect(decryptSecret(account.create.refreshToken)).toBe('synthetic-refresh');
    expect(m.create.mock.calls[0]![0].data).toMatchObject({ workspaceId: 'workspace', enabled: false, type: lane.id, canPublish: true });
    expect(m.target.mock.calls[0]![0].where.workspaceId_providerId.workspaceId).toBe('workspace');
    expect(m.audit).toHaveBeenCalledWith(expect.anything(), { userId: 'owner', workspaceId: 'workspace' }, `connection.${lane.id}_connected`, { socialAccountId: 'source', saved: 1, skipped: 0 });
  });
  it('does not take another connection destination on a providerId collision', async () => {
    m.target.mockResolvedValue({ id: 'other', socialAccountId: 'other-source', type: lane.id });
    expect(await lane.persist(viewer, input())).toEqual({ saved: 0, skipped: 1 });
    expect(m.update).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it('rechecks membership under the transaction before persisting', async () => {
    m.membership.mockResolvedValueOnce({ role: 'owner' }).mockResolvedValueOnce({ role: 'viewer' });
    await expect(lane.persist(viewer, input())).rejects.toMatchObject({ code: 'forbidden' });
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it('preserves selection on reconnect and fences existing resources', async () => {
    m.existing.mockResolvedValue({ id: 'source' }); m.findTargets.mockResolvedValue([{ id: 'existing-target' }]);
    m.target.mockResolvedValue({ id: 'existing-target', socialAccountId: 'source', type: lane.id });
    await lane.persist(viewer, input());
    expect(m.lock).toHaveBeenCalledWith(expect.anything(), 'workspace', [{ kind: 'target', id: 'existing-target' }]);
    expect(m.update.mock.calls[0]![0].data).not.toHaveProperty('enabled');
    expect(m.create).not.toHaveBeenCalled();
  });
  it('derives callback and secure cookie from Root publicOrigin behind a proxy', async () => {
    const response = await lane.connection.start(new Request('http://localhost:3200/api/start'), viewer);
    expect(m.authUrl.mock.calls[0]![0].redirectUri).toBe(`https://app.example.test/api/connections/${lane.id}/callback`);
    const cookie = response.cookies.get(`msp_${lane.id}_oauth`)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: `/api/connections/${lane.id}/callback`, maxAge: lane.policy.stateTtlSeconds });
    expect(await response.json()).toEqual({ authorizationUrl: 'https://provider.example.test/oauth' });
  });
  it('rejects a callback without bound state before exchanging credentials', async () => {
    const response = await lane.connection.callback(new NextRequest(`http://localhost:3200/api/connections/${lane.id}/callback?code=secret&state=wrong`), viewer);
    expect(response.headers.get('location')).toBe('https://app.example.test/settings/channels?notice=oauth_invalid_state');
    expect(m.exchange).not.toHaveBeenCalled();
  });
  it('finishes a bound callback through discovery, persistence and selection', async () => {
    const start = await lane.connection.start(new Request('http://localhost:3200/api/start'), viewer);
    const cookie = start.cookies.get(`msp_${lane.id}_oauth`)!;
    const state = m.authUrl.mock.calls[0]![0].state;
    m.discover.mockResolvedValue({ targets: input().targets });
    const response = await lane.connection.callback(new NextRequest(`http://localhost:3200/api/connections/${lane.id}/callback?code=synthetic&state=${encodeURIComponent(state)}`, { headers: { cookie: `${cookie.name}=${cookie.value}` } }), viewer);
    expect(response.headers.get('location')).toBe('https://app.example.test/settings/channels?notice=connected&select=1');
    expect(m.create).toHaveBeenCalledTimes(1); expect(m.audit).toHaveBeenCalledTimes(1);
    expect(response.cookies.get(cookie.name)?.maxAge).toBe(0);
  });
});
