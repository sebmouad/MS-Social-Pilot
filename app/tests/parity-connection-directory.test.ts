import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), member: vi.fn(), list: vi.fn(), permissions: vi.fn(), entitlements: vi.fn(), health: vi.fn(), accounts: vi.fn(), count: vi.fn(), enabled: vi.fn(), config: vi.fn() }));
vi.mock('@/server/data', () => ({ listConnections: m.list, prisma: { user: { findUnique: m.user }, membership: { findUnique: m.member }, socialAccount: { findMany: m.accounts, count: m.count } } }));
vi.mock('@/server/entitlements', () => ({ canUseFeature: () => true, entitledPlatformIds: () => ['installed'], loadEntitlements: m.entitlements }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: m.permissions }));
vi.mock('@/server/platforms/registry', () => ({ platformGrantHealth: m.health, enabledSocialAccountWhere: m.enabled }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
import { readConnectionDirectory } from '@/modules/settings/server/connection-directory';
const actor = { userId: 'u', workspaceId: 'w' };
beforeEach(() => {
  vi.clearAllMocks(); m.config.mockResolvedValue(1); m.user.mockResolvedValue({ disabledAt: null }); m.member.mockResolvedValue({ role: 'owner' }); m.permissions.mockResolvedValue({}); m.entitlements.mockResolvedValue({ workspaceId: 'w' }); m.health.mockResolvedValue([]); m.enabled.mockResolvedValue({ provider: { in: ['installed'] } }); m.count.mockResolvedValue(2);
  const accounts = ['a', 'b'].map(id => ({ id, provider: 'installed', name: 'Example', createdAt: new Date('2026-01-01'), invalidatedAt: null, tokenExpiresAt: null, accessToken: 'private-token', scopes: ['private-scope'], targets: [{ id: id + '-channel', type: 'channel', name: 'Example channel', enabled: false }], adAccounts: [] }));
  m.list.mockResolvedValue(accounts);
  m.accounts.mockImplementation(async ({ skip, take }: { skip: number; take: number }) => accounts.slice(skip, skip + take));
});
it('pages the same discovered sources, including unselected resources, without exposing credentials', async () => {
  const first = await readConnectionDirectory(actor);
  expect(first).toMatchObject({ total: 2, nextOffset: 1, hasMore: true });
  expect(first.connections[0]?.channels[0]).toMatchObject({ selected: false });
  expect(JSON.stringify(first)).not.toContain('private-');
  const next = await readConnectionDirectory(actor, { offset: 1 });
  expect(next.connections[0]?.id).toBe('b'); expect(next.nextOffset).toBeNull();
  expect(m.list).not.toHaveBeenCalled();
  expect(m.accounts).toHaveBeenCalledTimes(2);
  expect(m.count).toHaveBeenCalledTimes(2);
  expect(m.accounts.mock.calls[0][0]).toMatchObject({ skip: 0, take: 1, orderBy: [{ name: 'asc' }, { id: 'asc' }], where: { workspaceId: 'w', provider: { in: ['installed'] } } });
  expect(m.accounts.mock.calls[1][0]).toMatchObject({ skip: 1, take: 1 });
  expect(m.count.mock.calls[0][0].where).toEqual(m.accounts.mock.calls[0][0].where);
  expect(m.accounts.mock.calls[0][0].select).not.toHaveProperty('accessToken');
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
  expect(m.accounts).not.toHaveBeenCalled();
  expect(m.count).not.toHaveBeenCalled();
});

it.each(['owner', 'admin'])('keeps %s directory reads to one bounded data query plus a count beyond the last page', async role => {
  m.member.mockResolvedValue({ role });
  const result = await readConnectionDirectory(actor, { offset: 100 }, 20);
  expect(result).toEqual({ connections: [], total: 2, hasMore: false, nextOffset: null });
  expect(m.accounts).toHaveBeenCalledTimes(1);
  expect(m.accounts.mock.calls[0][0]).toMatchObject({ skip: 100, take: 1 });
  expect(m.count).toHaveBeenCalledTimes(1);
  expect(m.health).not.toHaveBeenCalled();
});
it.each(['editor', 'viewer', 'member', 'contributor'])('refuses %s before connection queries', async role => {
  m.member.mockResolvedValue({ role });
  await expect(readConnectionDirectory(actor)).rejects.toMatchObject({ code: 'forbidden' });
  expect(m.accounts).not.toHaveBeenCalled();
  expect(m.count).not.toHaveBeenCalled();
});

it('bounds a large directory by both Root policy and the caller ceiling', async () => {
  m.config.mockResolvedValue(7);
  m.count.mockResolvedValue(96);
  m.accounts.mockImplementation(async ({ take }: { take: number }) => Array.from({ length: take }, (_, index) => ({
    id: `connection-${index}`, provider: 'installed', name: 'Synthetic connection', createdAt: new Date('2026-01-01'),
    invalidatedAt: null, tokenExpiresAt: null, scopes: [], targets: [], adAccounts: [],
  })));
  const result = await readConnectionDirectory(actor, {}, 3);
  expect(result.connections).toHaveLength(3);
  expect(result).toMatchObject({ total: 96, hasMore: true, nextOffset: 3 });
  expect(m.accounts).toHaveBeenCalledTimes(1);
  expect(m.accounts.mock.calls[0][0]).toMatchObject({ take: 3 });
  expect(m.health).toHaveBeenCalledTimes(3);
  m.accounts.mockClear();
  const rootLimited = await readConnectionDirectory(actor, {}, 20);
  expect(rootLimited.connections).toHaveLength(7);
  expect(rootLimited.nextOffset).toBe(7);
  expect(m.accounts.mock.calls[0][0]).toMatchObject({ take: 7 });
});
