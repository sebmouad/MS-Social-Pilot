import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  role: 'owner' as string | null, workspace: 'workspace', enabled: true, pages: [] as unknown[], current: null as unknown,
  target: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  social: { upsert: vi.fn() }, account: { upsert: vi.fn() }, audit: vi.fn(), lock: vi.fn(), discover: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: {
  membership: { findUnique: async () => state.role ? { role: state.role } : null },
  target: state.target,
  $transaction: async (work: (tx: unknown) => unknown) => work({ target: state.target, socialAccount: state.social, instagramAccount: state.account, $executeRaw: vi.fn(async () => 1), membership: { findUnique: async () => state.role ? { role: state.role } : null } }),
} }));
vi.mock('@/server/entitlements', () => ({ canUseFeature: () => true, hasPlatformCapability: () => true, loadEntitlements: async () => ({ workspaceId: state.workspace }) }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({}) }));
vi.mock('@/server/platforms/registry', () => ({ isPlatformEnabled: async () => state.enabled }));
vi.mock('@/server/platforms/resource-lock', () => ({ lockSelectedResources: state.lock }));
vi.mock('@/modules/settings/server/connection-mutations', () => ({ auditConnectionEvent: state.audit }));
vi.mock('@/server/secret-crypto', () => ({ encryptSecret: (value: string) => `encrypted:${value}`, decryptSecret: (value: string) => value.replace('encrypted:', '') }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: async (_: unknown, work: () => unknown) => work() }));
vi.mock('@/server/config/store', () => ({ runtimeSecret: async () => 'secret' }));
vi.mock('@/platforms/instagram/runtime', async () => {
  const { INSTAGRAM_POLICY_DEFAULTS } = await import('@/platforms/instagram/config');
  return { configuredInstagramPolicy: async () => INSTAGRAM_POLICY_DEFAULTS, configuredInstagramDiscovery: async () => state.discover };
});
import { discoverSelectedInstagramAccounts } from '@/platforms/instagram/connection';
import { INSTAGRAM_POLICY_DEFAULTS } from '@/platforms/instagram/config';
const viewer = { user: { id: 'owner' }, workspaceId: 'workspace' };
const source = { id: 'fb-source', provider: 'facebook', workspaceId: 'workspace', scopes: INSTAGRAM_POLICY_DEFAULTS.publishScopes.join(','), invalidatedAt: null, tokenExpiresAt: new Date('2099-01-01') };
const page = { id: 'page', providerId: 'remote-page', name: 'Example Page', accessToken: 'encrypted:page-token', socialAccount: source };
beforeEach(() => {
  vi.clearAllMocks(); state.role = 'owner'; state.workspace = 'workspace'; state.enabled = true;
  state.target.findMany.mockResolvedValue([page]); state.target.findFirst.mockResolvedValue(page); state.target.findUnique.mockResolvedValue(null);
  state.target.upsert.mockResolvedValue({ id: 'ig-target', enabled: false }); state.social.upsert.mockResolvedValue({ id: 'ig-source' });
  state.discover.mockResolvedValue([{ igUserId: 'ig-user', username: 'example', pageId: 'remote-page', pageAccessToken: 'page-token' }]);
});
describe('Instagram selected-Page host connection', () => {
  it.each(['owner', 'admin'])('persists encrypted, unselected destinations for %s', async role => {
    state.role = role;
    expect(await discoverSelectedInstagramAccounts(viewer)).toEqual({ saved: 1 });
    expect(state.target.findMany.mock.calls[0]![0].where).toMatchObject({ workspaceId: 'workspace', enabled: true, type: 'page', socialAccount: { provider: 'facebook', invalidatedAt: null } });
    expect(state.discover).toHaveBeenCalledWith([{ id: 'remote-page', name: 'Example Page', accessToken: 'page-token' }]);
    expect(state.social.upsert.mock.calls[0]![0].create).toMatchObject({ provider: 'instagram', accessToken: 'encrypted:page-token', scopes: source.scopes, tokenExpiresAt: source.tokenExpiresAt });
    expect(state.target.upsert.mock.calls[0]![0].create).toMatchObject({ type: 'instagram', socialAccountId: 'ig-source', enabled: false, accessToken: 'encrypted:page-token' });
    expect(state.account.upsert.mock.calls[0]![0].create).toMatchObject({ targetId: 'ig-target', enabled: false });
    expect(state.audit).toHaveBeenCalled();
  });
  it.each(['member', 'viewer', null])('denies %s before discovery or persistence', async role => {
    state.role = role;
    await expect(discoverSelectedInstagramAccounts(viewer)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.discover).not.toHaveBeenCalled(); expect(state.social.upsert).not.toHaveBeenCalled();
  });
  it('rejects mismatched workspace entitlements and disabled installation', async () => {
    state.workspace = 'other';
    await expect(discoverSelectedInstagramAccounts(viewer)).rejects.toMatchObject({ code: 'forbidden' });
    state.workspace = 'workspace'; state.enabled = false;
    await expect(discoverSelectedInstagramAccounts(viewer)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.discover).not.toHaveBeenCalled();
  });
  it('does not persist stale Page selection after provider discovery', async () => {
    state.target.findFirst.mockResolvedValue(null);
    await expect(discoverSelectedInstagramAccounts(viewer)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.social.upsert).not.toHaveBeenCalled();
  });
  it('never steals a destination from another source', async () => {
    state.target.findUnique.mockResolvedValue({ id: 'foreign', type: 'instagram', socialAccount: { provider: 'facebook', providerUserId: 'another' } });
    expect(await discoverSelectedInstagramAccounts(viewer)).toEqual({ saved: 0 });
    expect(state.social.upsert).not.toHaveBeenCalled();
  });
  it('does not enumerate or save unselected Pages', async () => {
    state.target.findMany.mockResolvedValue([]);
    await expect(discoverSelectedInstagramAccounts(viewer)).rejects.toMatchObject({ code: 'unavailable' });
    expect(state.discover).not.toHaveBeenCalled();
  });
});
