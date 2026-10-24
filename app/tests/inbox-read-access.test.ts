vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ user: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), feature: vi.fn(), platform: vi.fn(), providers: vi.fn(), permission: vi.fn(), purge: vi.fn(), channels: vi.fn(), workspace: vi.fn(), where: vi.fn(), query: vi.fn(), config: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: state.user }, target: { findMany: state.channels }, workspace: { findUnique: state.workspace }, $queryRaw: state.query } }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: state.entitlements, canUseFeature: state.feature, hasPlatformCapability: state.platform }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: state.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: state.permission }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: state.purge }));
vi.mock('@/modules/inbox/server/providers', () => ({ inboxTargetWhere: state.where, inboxProviders: state.providers }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
import { readInboxList, readInboxThread } from '../src/modules/inbox/server/read';
const actor = { userId: 'reader', workspaceId: 'workspace' };
beforeEach(() => {
  vi.clearAllMocks(); state.user.mockResolvedValue({ disabledAt: null }); state.entitlements.mockResolvedValue({}); state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['allowed', 'other'] } }); state.feature.mockReturnValue(true); state.platform.mockReturnValue(true); state.providers.mockResolvedValue(['facebook']); state.permission.mockReturnValue(true); state.purge.mockResolvedValue(undefined); state.where.mockResolvedValue({}); state.channels.mockResolvedValue([]); state.workspace.mockResolvedValue({ timezone: 'Africa/Casablanca' });
  state.config.mockImplementation(async key => ({ 'inbox.listPageSize': 25, 'inbox.threadPageSize': 50, 'inbox.searchMaxCharacters': 200, 'inbox.cursorMaxCharacters': 4096 }[key as string]));
});
describe('Inbox shared read authorization and input boundaries', () => {
  it.each([null, { disabledAt: new Date() }])('denies missing/disabled accounts before membership, configuration or content reads', async user => {
    state.user.mockResolvedValue(user);
    await expect(readInboxList(actor)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(readInboxThread(actor, { key: 'message:item' })).rejects.toMatchObject({ code: 'unauthorized' });
    expect(state.entitlements).not.toHaveBeenCalled(); expect(state.channels).not.toHaveBeenCalled(); expect(state.query).not.toHaveBeenCalled();
  });
  it.each(['membership', 'entitlement', 'read_permission'])('requires current %s without installation-owner suspension bypass', async denial => {
    if (denial === 'membership') state.permissions.mockResolvedValue(null);
    if (denial === 'entitlement') state.feature.mockReturnValue(false);
    if (denial === 'read_permission') state.permission.mockReturnValue(false);
    await expect(readInboxList(actor)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.entitlements).toHaveBeenCalledWith('reader', 'workspace', { allowInstallationInspection: false });
    expect(state.channels).not.toHaveBeenCalled(); expect(state.query).not.toHaveBeenCalled();
  });
  it('intersects trusted key constraints with current member grants before channel selection', async () => {
    const result = await readInboxList(actor, {}, { allowedChannelIds: ['allowed', 'not-granted'], maxItems: 3 });
    expect(state.where).toHaveBeenCalledWith('workspace', ['allowed'], ['facebook']);
    expect(result).toMatchObject({ items: [], total: 0, limit: 3, channels: [], timeZone: 'Africa/Casablanca' });
    expect(state.query).not.toHaveBeenCalled();
  });
  it('does not expose selected channels from a platform the workspace is not entitled to use', async () => {
    state.platform.mockReturnValue(false);
    await expect(readInboxList(actor)).resolves.toMatchObject({ items: [], total: 0 });
    expect(state.where).toHaveBeenCalledWith('workspace', ['allowed', 'other'], []);
    expect(state.query).not.toHaveBeenCalled();
  });
  it.each([{ kind: ['message', 'comment'] }, { state: 'invalid' }, { limit: '2' }, { limit: 0 }, { limit: 1.5 }, { hidden: false }, { q: 'x'.repeat(201) }, { cursor: '' }, { unexpected: true }])('rejects ambiguous/invalid filters %j before content reads', async input => {
    await expect(readInboxList(actor, input)).rejects.toMatchObject({ code: 'invalid_request' }); expect(state.query).not.toHaveBeenCalled();
  });
  it('refuses forged channels and cross-thread malformed keys, and fails closed during erasure', async () => {
    await expect(readInboxList(actor, { channelId: 'foreign' })).rejects.toMatchObject({ code: 'forbidden' });
    for (const key of ['message:one:two', 'comment:../x', ['message:item'], 'unsupported:item']) await expect(readInboxThread(actor, { key })).rejects.toMatchObject({ code: 'invalid_request' });
    state.purge.mockRejectedValueOnce(new Error('Erasure active')); await expect(readInboxList(actor)).rejects.toThrow('Erasure active');
    expect(state.query).not.toHaveBeenCalled();
  });
});
