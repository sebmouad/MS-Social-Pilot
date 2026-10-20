import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ user: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), catalog: vi.fn(), hook: vi.fn(), config: vi.fn(), use: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, entitledPlatformIds: () => ['example'], canUseFeature: mocks.use }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: vi.fn() }));
vi.mock('../server/data', () => ({ loadAnalytics: mocks.catalog }));
vi.mock('@/server/platforms/registry', () => ({ platformAnalytics: async () => ({ postPerformance: mocks.hook }) }));
import { comparePosts, postsCsv, readPosts, exportPosts, type PostRow } from './service';
const row = (id: string, value: number | null): PostRow => ({ postId: id, text: '=unsafe,"text"', channelId: 'a', channelName: 'Channel', publishedAt: new Date('2026-01-01'), measuredAt: null, url: null, rankValue: null, rankLabel: 'Rank', measures: [{ key: 'views', label: 'Views', value }] });
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue({ disabledAt: null }); mocks.entitlements.mockResolvedValue({}); mocks.use.mockReturnValue(true);
  mocks.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['a', 'b'] } });
  mocks.config.mockImplementation(async (key: string) => ({ 'analytics.reportExportRows': 3, 'analytics.postsPageSize': 2, 'analytics.defaultRangeDays': 30, 'analytics.maxRangeDays': 366, 'analytics.reportMaxChannels': 100 })[key]);
  mocks.catalog.mockResolvedValue({ targets: [{ id: 'a', name: 'A', providerId: 'example' }, { id: 'b', name: 'B', providerId: 'example' }] });
  mocks.hook.mockImplementation(async ({ targetId }: { targetId: string }) => targetId === 'a' ? [row('1', 9), row('2', null)] : [row('3', 10), row('4', 1)]);
});
describe('published post explorer', () => {
  it('merges channel measures globally and pages without replacing unknown with zero', async () => {
    const data = await readPosts({ userId: 'u', workspaceId: 'w' }, { sort: 'views' });
    expect(data.items.map(p => p.postId)).toEqual(['3', '1']); expect(data.nextPage).toBe(2);
    const next = await readPosts({ userId: 'u', workspaceId: 'w' }, { sort: 'views', page: 2 });
    expect(next.items.map(p => p.postId)).toEqual(['4', '2']); expect(next.items[1].measures[0].value).toBeNull();
    expect(mocks.hook).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'w', sort: 'views', from: expect.any(Date), to: expect.any(Date) }));
  });
  it('keeps unknown last in both directions', () => {
    for (const direction of ['asc', 'desc'] as const) expect([row('a', null), row('b', 0)].sort(comparePosts('views', direction))[1].postId).toBe('a');
  });
  it('intersects current resource permissions with credential scope', async () => {
    await readPosts({ userId: 'u', workspaceId: 'w', allowedChannelIds: ['b', 'outside'] }, { filter: '1', channel: [] });
    expect(mocks.catalog).toHaveBeenCalledWith('w', [], expect.anything(), ['b'], [], ['example'], { accountIds: [] }); expect(mocks.hook).not.toHaveBeenCalled();
  });
  it('rejects unavailable resources before reading posts', async () => {
    await expect(readPosts({ userId: 'u', workspaceId: 'w' }, { filter: '1', channel: ['outside'] })).rejects.toMatchObject({ code: 'forbidden' }); expect(mocks.hook).not.toHaveBeenCalled();
  });
  it('rejects stale access and invalid period/page', async () => {
    mocks.user.mockResolvedValueOnce({ disabledAt: new Date() });
    await expect(readPosts({ userId: 'u', workspaceId: 'w' }, {})).rejects.toMatchObject({ code: 'forbidden' });
    for (const input of [{ page: -1 }, { start: 'bad' }, { sort: 'bad\nkey' }]) await expect(readPosts({ userId: 'u', workspaceId: 'w' }, input)).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('caps MCP rows while retaining continuation', async () => {
    const data = await readPosts({ userId: 'u', workspaceId: 'w' }, {}, 1); expect(data.items).toHaveLength(1); expect(data.nextPage).toBe(2);
  });
  it('refuses oversized full exports rather than truncating', async () => {
    await expect(exportPosts({ userId: 'u', workspaceId: 'w' }, {})).rejects.toMatchObject({ code: 'invalid_request' });
    const csv = await exportPosts({ userId: 'u', workspaceId: 'w' }, { filter: '1', channel: 'a', page: 99 });
    expect(csv).toContain('Not available');
  });
  it('escapes CSV formulas and quotes, distinguishes missing from zero', () => {
    const csv = postsCsv([row('a', null), row('b', 0)], [{ key: 'views', label: 'Views' }]);
    expect(csv).toContain('"\'=unsafe,""text"""'); expect(csv).toContain('"Not available"'); expect(csv).toContain('"0"');
  });
});
