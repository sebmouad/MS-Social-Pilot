import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), member: vi.fn(), list: vi.fn(), permissions: vi.fn(), entitlements: vi.fn(), health: vi.fn() }));
vi.mock('@/server/data', () => ({ listConnections: m.list, prisma: { user: { findUnique: m.user }, membership: { findUnique: m.member } } }));
vi.mock('@/server/entitlements', () => ({ canUseFeature: () => true, entitledPlatformIds: () => ['installed'], loadEntitlements: m.entitlements }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: m.permissions }));
vi.mock('@/server/platforms/registry', () => ({ platformGrantHealth: m.health }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => 1 }));
import { readConnectionDirectory } from '@/modules/settings/server/connection-directory';
const actor = { userId: 'u', workspaceId: 'w' };
beforeEach(() => {
  vi.clearAllMocks(); m.user.mockResolvedValue({ disabledAt: null }); m.member.mockResolvedValue({ role: 'owner' }); m.permissions.mockResolvedValue({}); m.entitlements.mockResolvedValue({ workspaceId: 'w' }); m.health.mockResolvedValue([]);
  m.list.mockResolvedValue(['a', 'b'].map(id => ({ id, provider: 'installed', name: 'Example', createdAt: new Date('2026-01-01'), invalidatedAt: null, tokenExpiresAt: null, accessToken: 'private-token', scopes: ['private-scope'], targets: [{ id: id + '-channel', type: 'channel', name: 'Example channel', enabled: false }], adAccounts: [] })));
});
it('pages the same discovered sources, including unselected resources, without exposing credentials', async () => {
  const first = await readConnectionDirectory(actor);
  expect(first).toMatchObject({ total: 2, nextOffset: 1, hasMore: true });
  expect(first.connections[0]?.channels[0]).toMatchObject({ selected: false });
  expect(JSON.stringify(first)).not.toContain('private-');
  const next = await readConnectionDirectory(actor, { offset: 1 });
  expect(next.connections[0]?.id).toBe('b'); expect(next.nextOffset).toBeNull();
  expect(m.list).toHaveBeenCalledWith('w', ['installed']);
});
it('refuses stale role, disabled user, wrong tenant or unknown filters before discovery', async () => {
  m.member.mockResolvedValue({ role: 'editor' });
  await expect(readConnectionDirectory(actor)).rejects.toMatchObject({ code: 'forbidden' });
  m.member.mockResolvedValue({ role: 'owner' }); m.user.mockResolvedValue({ disabledAt: new Date() });
  await expect(readConnectionDirectory(actor)).rejects.toMatchObject({ code: 'forbidden' });
  m.user.mockResolvedValue({ disabledAt: null }); m.entitlements.mockResolvedValue({ workspaceId: 'other' });
  await expect(readConnectionDirectory(actor)).rejects.toMatchObject({ code: 'forbidden' });
  await expect(readConnectionDirectory(actor, { workspaceId: 'other' })).rejects.toMatchObject({ code: 'invalid_request' });
  expect(m.list).not.toHaveBeenCalled();
});
