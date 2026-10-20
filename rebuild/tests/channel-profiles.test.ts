import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  db: { user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() }, target: { findMany: vi.fn() }, workspaceDataPurge: { findUnique: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() },
  config: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), use: vi.fn(), access: vi.fn(), selected: vi.fn(), lock: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: m.db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: m.config }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: m.entitlements, canUseFeature: m.use, entitledPlatformIds: () => ['test-platform'] }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: m.permissions }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: m.access }));
vi.mock('@/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: m.selected }));
vi.mock('@/server/platforms/resource-lock', () => ({ lockSelectedResources: m.lock }));
import { changeChannelProfiles, readChannelProfiles } from '@/modules/settings/channel-profiles/service';
import { deleteGroupConfirmation } from '@/modules/settings/channel-profiles/contracts';
const actor = { userId: 'u1', workspaceId: 'w1' };
const policy = { maxGroups: 3, maxChannels: 3, maxLabelsPerChannel: 2, maxNameCharacters: 12 };
const sql = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');
beforeEach(() => {
  vi.clearAllMocks();
  m.db.user.findUnique.mockResolvedValue({ disabledAt: null }); m.db.membership.findUnique.mockResolvedValue({ role: 'owner' });
  m.entitlements.mockResolvedValue({ workspaceId: 'w1' }); m.permissions.mockResolvedValue({ pageScope: { all: true } }); m.use.mockReturnValue(true); m.access.mockReturnValue(true);
  m.selected.mockResolvedValue({ workspaceId: 'w1', invalidatedAt: null }); m.lock.mockResolvedValue(undefined);
  m.config.mockImplementation(async key => key === 'settings.channelProfilesPolicy' ? policy : 1000);
  m.db.workspaceDataPurge.findUnique.mockResolvedValue(null); m.db.target.findMany.mockResolvedValue([{ id: 'a', name: 'Alpha' }]);
  m.db.$executeRaw.mockResolvedValue(1); m.db.$transaction.mockImplementation(async callback => callback(m.db));
  m.db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const query = strings.join('?');
    if (query.includes('FROM workspaces')) return [{ suspendedAt: null }];
    if (query.includes('SELECT COUNT')) return [{ count: BigInt(0) }];
    if (query.includes('FROM memberships')) return [{ id: 'm1' }];
    if (query.includes('FROM page_groups')) return [{ id: 'g1', name: 'Brand' }];
    if (query.includes('FROM page_group_targets')) return [{ groupId: 'g1', targetId: 'a' }];
    if (query.includes('FROM rebuild_channel_profiles')) return [{ targetId: 'a', labels: ['North'] }];
    return [];
  });
});
describe('channel profile authority and persistence', () => {
  it('reads selected workspace resources with current member and key ceilings', async () => {
    m.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['a', 'b'] } });
    const result = await readChannelProfiles({ ...actor, allowedChannelIds: ['a', 'c'] }, 'analytics/overview');
    expect(result).toEqual({ channels: [{ id: 'a', name: 'Alpha', labels: ['North'] }], groups: [{ id: 'g1', name: 'Brand', channelIds: ['a'] }] });
    expect(m.db.target.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'w1', enabled: true, id: { in: ['a'] } }) }));
    expect(m.access).toHaveBeenCalledWith(expect.anything(), 'analytics/overview', 'read');
  });
  it('does not query labels for an empty key scope or expose empty group names', async () => {
    m.db.target.findMany.mockResolvedValue([]);
    expect(await readChannelProfiles({ ...actor, allowedChannelIds: [] })).toEqual({ channels: [], groups: [] });
    expect(m.db.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it.each(['disabled', 'revoked', 'suspended', 'purging', 'feature'])('refuses %s authority before data mutation', async reason => {
    if (reason === 'disabled') m.db.user.findUnique.mockResolvedValue({ disabledAt: new Date() });
    if (reason === 'revoked') m.db.membership.findUnique.mockResolvedValue(null);
    if (reason === 'suspended') m.db.$queryRaw.mockResolvedValue([{ suspendedAt: new Date() }]);
    if (reason === 'purging') m.db.workspaceDataPurge.findUnique.mockResolvedValue({ status: 'running' });
    if (reason === 'feature') m.use.mockReturnValue(false);
    await expect(changeChannelProfiles(actor, { action: 'setLabels', channelId: 'a', labels: [] })).rejects.toBeDefined();
    expect(m.db.$executeRaw).not.toHaveBeenCalled();
  });
  it('refuses editor writes and rechecks role after locking', async () => {
    m.db.membership.findUnique.mockResolvedValueOnce({ role: 'owner' }).mockResolvedValueOnce({ role: 'editor' });
    await expect(changeChannelProfiles(actor, { action: 'setLabels', channelId: 'a', labels: [] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(m.db.$executeRaw).not.toHaveBeenCalled();
  });
  it('rejects unavailable channels and configured label/name bounds', async () => {
    for (const input of [
      { action: 'setLabels', channelId: 'other', labels: [] },
      { action: 'setLabels', channelId: 'a', labels: ['x', 'y', 'z'] },
      { action: 'saveGroup', name: 'Name too long here', channelIds: ['a'] },
    ]) await expect(changeChannelProfiles(actor, input)).rejects.toBeDefined();
    expect(m.db.$executeRaw).not.toHaveBeenCalled();
  });
  it('replaces labels including an explicit empty list and atomically audits', async () => {
    await expect(changeChannelProfiles(actor, { action: 'setLabels', channelId: 'a', labels: [] })).resolves.toMatchObject({ ok: true, id: 'a' });
    expect(m.lock).toHaveBeenCalledWith(m.db, 'w1', [{ kind: 'target', id: 'a' }]);
    expect(sql(m.db.$executeRaw.mock.calls[0]!)).toContain('ON CONFLICT');
    expect(m.db.$executeRaw.mock.calls[0]).toContainEqual([]);
    expect(sql(m.db.$executeRaw.mock.calls[1]!)).toContain('INSERT INTO activity_logs');
  });
  it('creates and replaces named groups without duplicates', async () => {
    await changeChannelProfiles(actor, { action: 'saveGroup', name: 'Brand', channelIds: ['a', 'a'] });
    expect(m.db.$executeRaw.mock.calls.filter(call => sql(call).includes('INSERT INTO page_group_targets'))).toHaveLength(1);
    expect(sql(m.db.$executeRaw.mock.calls[0]!)).toContain('INSERT INTO page_groups');
    m.db.$executeRaw.mockClear();
    await changeChannelProfiles(actor, { action: 'saveGroup', id: 'g1', name: 'New', channelIds: ['a'] });
    expect(sql(m.db.$executeRaw.mock.calls[0]!)).toContain('UPDATE page_groups');
  });
  it('will not replace/delete a group containing channels outside current scope', async () => {
    m.db.$queryRaw.mockImplementation(async strings => {
      const query = strings.join('?');
      if (query.includes('FROM workspaces')) return [{ suspendedAt: null }];
      if (query.includes('FROM page_groups')) return [{ id: 'g1' }];
      if (query.includes('FROM page_group_targets')) return [{ targetId: 'hidden' }];
      return [];
    });
    for (const input of [{ action: 'saveGroup', id: 'g1', name: 'New', channelIds: ['a'] }, { action: 'deleteGroup', id: 'g1', confirmation: deleteGroupConfirmation('g1') }]) await expect(changeChannelProfiles(actor, input)).rejects.toMatchObject({ code: 'conflict' });
    expect(m.db.$executeRaw).not.toHaveBeenCalled();
  });
  it('requires exact delete confirmation and deletes only its own group', async () => {
    await expect(changeChannelProfiles(actor, { action: 'deleteGroup', id: 'g1', confirmation: 'wrong' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(m.db.$transaction).not.toHaveBeenCalled();
    await changeChannelProfiles(actor, { action: 'deleteGroup', id: 'g1', confirmation: deleteGroupConfirmation('g1') });
    expect(sql(m.db.$executeRaw.mock.calls[0]!)).toContain('DELETE FROM page_groups WHERE id = ? AND "workspaceId" = ?');
    expect(m.db.$executeRaw.mock.calls[0]).toContain('w1');
  });
  it('refuses oversized directories, invalid Root policy and failed audit', async () => {
    m.db.target.findMany.mockResolvedValueOnce(Array(4).fill({ id: 'a', name: 'Alpha' }));
    await expect(readChannelProfiles(actor)).rejects.toMatchObject({ code: 'unavailable' });
    m.config.mockResolvedValueOnce({ ...policy, maxGroups: 0 });
    await expect(readChannelProfiles(actor)).rejects.toMatchObject({ code: 'unavailable' });
    m.db.$executeRaw.mockRejectedValueOnce(new Error('private database details'));
    await expect(changeChannelProfiles(actor, { action: 'setLabels', channelId: 'a', labels: [] })).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('maps a duplicate group name to a safe conflict', async () => {
    m.db.$executeRaw.mockRejectedValueOnce({ code: 'P2002' });
    await expect(changeChannelProfiles(actor, { action: 'saveGroup', name: 'Brand', channelIds: ['a'] })).rejects.toMatchObject({ code: 'conflict' });
  });
  it('preserves scheduling rules rather than cascading them on group deletion', async () => {
    const original = m.db.$queryRaw.getMockImplementation()!;
    m.db.$queryRaw.mockImplementation(async (...args) => sql(args).includes('FROM content_mix_rules') ? [{ id: 'rule' }] : original(...args));
    await expect(changeChannelProfiles(actor, { action: 'deleteGroup', id: 'g1', confirmation: deleteGroupConfirmation('g1') })).rejects.toMatchObject({ code: 'conflict' });
    expect(m.db.$executeRaw).not.toHaveBeenCalled();
  });

});
