import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  entitlements: vi.fn(), permissions: vi.fn(), canUse: vi.fn(), canAccess: vi.fn(), batch: vi.fn(), config: vi.fn(), workspace: vi.fn(), queryRaw: vi.fn(),
  snapshot: vi.fn(), inbox: vi.fn(), ads: vi.fn(), posts: vi.fn(), host: vi.fn(),
}));
vi.mock('@/server/data', () => ({ prisma: { workspace: { findUnique: mocks.workspace }, $queryRaw: mocks.queryRaw } }));
vi.mock('@/server/config/store', () => ({ runtimeConfigBatch: mocks.batch, runtimeConfig: mocks.config }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: mocks.canUse }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: mocks.canAccess }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('@/server/platforms/registry', () => ({ platformAnalytics: mocks.host }));
vi.mock('@/modules/analytics/server/read', () => ({ readAnalyticsSnapshot: mocks.snapshot }));
vi.mock('@/modules/inbox/server/read', () => ({ readInboxList: mocks.inbox }));
vi.mock('@/modules/ads/server/report-read', () => ({ readAdsDailyRows: mocks.ads }));
vi.mock('@/modules/publishing/server/read', () => ({ readPublishingPostPage: mocks.posts }));

import { readHomeOverview } from '@/modules/home/server/overview';
import { HOME_CONFIG } from '@/modules/home/config';

const actor = { userId: 'u1', workspaceId: 'w1' };
const now = new Date('2026-10-20T12:00:00Z');
const config = Object.fromEntries(HOME_CONFIG.map(item => [item.key, item.defaultValue]));
const snapshot = (over: Record<string, unknown> = {}) => ({
  options: { channels: [{ id: 'c1', name: 'Alpha' }, { id: 'c2', name: 'Beta' }] }, selected: { channelIds: ['c1', 'c2'] },
  audience: { entries: [{ id: 'c1', metric: 'm', asOf: new Date('2026-10-19') }, { id: 'c2', metric: 'm', asOf: new Date('2026-10-18') }], total: 300, covered: 2, selected: 2 },
  allMetrics: [{ key: 'm', kind: 'stock', resourceKind: 'channel', points: [{ date: '2026-10-18', value: 290 }, { date: '2026-10-19', value: 300 }] }], ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.entitlements.mockResolvedValue({}); mocks.permissions.mockResolvedValue({ pageScope: { all: true } });
  mocks.canUse.mockReturnValue(true); mocks.canAccess.mockReturnValue(true);
  mocks.batch.mockResolvedValue(config); mocks.config.mockImplementation(async (key: string) => config[key]); mocks.workspace.mockResolvedValue({ timezone: 'UTC' });
  mocks.queryRaw.mockResolvedValue([{ id: 'c1', provider: 'p' }, { id: 'c2', provider: 'p' }]);
  mocks.snapshot.mockResolvedValue(snapshot());
  mocks.inbox.mockResolvedValue({ total: 4 });
  mocks.posts.mockResolvedValue({ total: 0, posts: [] });
  mocks.ads.mockResolvedValue({ rows: [], nextOffset: null });
  mocks.host.mockResolvedValue({
    goalMeasures: vi.fn(async (request: { from: Date; targetId: string }) => request.from < new Date('2026-09-01') ? { audienceGained: null, views: 100, engagements: 10 }
      : request.from < new Date('2026-09-23') ? { audienceGained: null, views: 100, engagements: 10 } : { audienceGained: null, views: request.targetId === 'c1' ? 150 : 50, engagements: request.targetId === 'c1' ? 30 : 10 }),
    destinationMeasures: vi.fn(async () => ({ measures: [{ key: 'reactions', label: 'Reactions', value: 5, measuredPosts: 2 }, { key: 'impressions', label: 'Impressions', value: 999, measuredPosts: 2 }] })),
    postPerformance: vi.fn(async () => []),
  });
});

describe('readHomeOverview', () => {
  it('builds audience, performance and an interaction mix from stored figures only', async () => {
    const overview = await readHomeOverview(actor, now);
    expect(overview.audience).toMatchObject({ state: 'ready', data: { total: 300, covered: 2, selected: 2 } });
    expect((overview.audience as { data: { trend: unknown[] } }).data.trend).toHaveLength(2);
    const performance = overview.performance as { state: 'ready'; data: { views: { current: number }; topChannels: Array<{ name: string }>; interactions: Array<{ key: string; value: number }> } };
    expect(performance.state).toBe('ready');
    expect(performance.data.views.current).toBe(200);
    expect(performance.data.topChannels.map(channel => channel.name)).toEqual(['Alpha', 'Beta']);
    // Only the configured additive measures feed the mix; impressions are excluded.
    expect(performance.data.interactions).toEqual([{ key: 'reactions', label: 'Reactions', value: 10 }]);
  });

  it('resolves a shared provider once across performance and heatmap reads', async () => {
    await readHomeOverview(actor, now);
    expect(mocks.host).toHaveBeenCalledTimes(1);
    expect(mocks.host).toHaveBeenCalledWith('p');
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });

  it('batches 40 authorized channels by provider for measures and bounded post history', async () => {
    const channels = Array.from({ length: 40 }, (_, index) => ({ id: `c${index}`, name: `Channel ${index}` }));
    mocks.snapshot.mockResolvedValue(snapshot({ options: { channels }, selected: { channelIds: channels.map(channel => channel.id) } }));
    mocks.queryRaw.mockResolvedValue(channels.map((channel, index) => ({ id: channel.id, provider: index % 2 ? 'p' : 'q' })));
    const hosts = ['p', 'q'].map(() => ({
      channelMeasuresBatch: vi.fn(async (request: { targetIds: string[] }) => request.targetIds.map(targetId => ({ targetId,
        current: { audienceGained: null, views: 10, engagements: 2 }, previous: { audienceGained: null, views: 5, engagements: 1 }, mix: [] }))),
      postPerformanceBatch: vi.fn(async () => []), goalMeasures: vi.fn(), destinationMeasures: vi.fn(), postPerformance: vi.fn(),
    }));
    mocks.host.mockImplementation(async provider => hosts[provider === 'p' ? 0 : 1]);
    const overview = await readHomeOverview(actor, now);
    expect(overview.performance).toMatchObject({ state: 'ready', data: { channels: 40, views: { current: 400, previous: 200 } } });
    expect(mocks.host).toHaveBeenCalledTimes(2);
    for (const [index, host] of hosts.entries()) {
      expect(host.channelMeasuresBatch).toHaveBeenCalledTimes(1);
      expect(host.postPerformanceBatch).toHaveBeenCalledTimes(1);
      const ids = channels.filter((_, channelIndex) => channelIndex % 2 === (index === 0 ? 1 : 0)).map(channel => channel.id);
      expect(host.channelMeasuresBatch.mock.calls[0]![0]).toMatchObject({ workspaceId: actor.workspaceId, targetIds: ids,
        current: { from: new Date('2026-09-23T00:00:00Z'), to: now }, previous: { from: new Date('2026-08-26T00:00:00Z'), to: new Date('2026-09-23T00:00:00Z') } });
      expect(host.postPerformanceBatch).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: actor.workspaceId, targetIds: ids,
        limit: config['home.heatmapMaxPostsPerChannel'], sort: 'publishedAt', direction: 'desc', to: now }));
      expect(host.goalMeasures).not.toHaveBeenCalled();
      expect(host.destinationMeasures).not.toHaveBeenCalled();
      expect(host.postPerformance).not.toHaveBeenCalled();
    }
  });

  it('starts other cards while a performance read is pending', async () => {
    let finish!: (value: { views: number; engagements: number }) => void;
    const pending = new Promise<{ views: number; engagements: number }>(resolve => { finish = resolve; });
    const started = vi.fn();
    mocks.host.mockResolvedValue({ goalMeasures: () => { started(); return pending; }, postPerformance: vi.fn(async () => []) });
    const reading = readHomeOverview(actor, now);
    try {
      await vi.waitFor(() => {
        expect(started).toHaveBeenCalled();
        expect(mocks.posts).toHaveBeenCalledTimes(1);
        expect(mocks.inbox).toHaveBeenCalledTimes(1);
        expect(mocks.ads).toHaveBeenCalledTimes(1);
      });
    } finally { finish({ views: 1, engagements: 1 }); }
    expect((await reading).performance?.state).toBe('ready');
  });

  it('omits cards for modules the viewer cannot use', async () => {
    mocks.canUse.mockImplementation((_e: unknown, feature: string) => feature.startsWith('publishing/'));
    const overview = await readHomeOverview(actor, now);
    expect(overview.audience).toBeNull();
    expect(overview.performance).toBeNull();
    expect(overview.inbox).toBeNull();
    expect(overview.ads).toBeNull();
    expect(overview.upcoming).toEqual({ state: 'empty' });
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.inbox).not.toHaveBeenCalled();
  });

  it('keeps the page up when one card cannot be read', async () => {
    mocks.inbox.mockRejectedValue(new Error('down'));
    const overview = await readHomeOverview(actor, now);
    expect(overview.inbox).toEqual({ state: 'unavailable' });
    expect(overview.audience?.state).toBe('ready');
  });

  it('shows no audience trend when channels report different measures', async () => {
    mocks.snapshot.mockResolvedValue(snapshot({ audience: { entries: [{ id: 'c1', metric: 'a', asOf: new Date() }, { id: 'c2', metric: 'b', asOf: new Date() }], total: 5, covered: 2, selected: 2 } }));
    const overview = await readHomeOverview(actor, now);
    expect((overview.audience as { data: { trend: unknown[] } }).data.trend).toEqual([]);
  });

  it('marks the held-on-platform mode of upcoming posts', async () => {
    mocks.posts.mockResolvedValue({ total: 2, posts: [
      { id: 'p1', message: 'Hello   world', scheduledAt: new Date('2026-10-21T09:00:00Z'), targets: [{ status: 'scheduled_remote', target: { name: 'Alpha' } }] },
      { id: 'p2', message: 'Later', scheduledAt: new Date('2026-10-22T09:00:00Z'), targets: [{ status: 'scheduled', target: { name: 'Beta' } }] },
    ] });
    const overview = await readHomeOverview(actor, now);
    const items = (overview.upcoming as { data: { items: Array<{ mode: string; text: string }> } }).data.items;
    expect(items.map(item => item.mode)).toEqual(['platform', 'app']);
    expect(items[0]!.text).toBe('Hello world');
  });

  it('reports spend per currency and withholds a partial total', async () => {
    mocks.ads.mockResolvedValueOnce({ rows: [{ currency: 'EUR', spend: 12, date: '2026-10-19' }, { currency: 'USD', spend: 3, date: '2026-10-19' }], nextOffset: null });
    const spend = ((await readHomeOverview(actor, now)).ads as { data: { spend: Array<{ currency: string; total: number }> } }).data.spend;
    expect(spend.map(group => [group.currency, group.total])).toEqual([['EUR', 12], ['USD', 3]]);
    mocks.ads.mockResolvedValue({ rows: [{ currency: 'EUR', spend: 1, date: '2026-10-19' }], nextOffset: 1 });
    expect((await readHomeOverview(actor, now)).ads).toEqual({ state: 'unavailable' });
    expect(mocks.ads).toHaveBeenCalledTimes(1 + Number(config['home.adsMaxPages']));
  });

  it('refuses a user without current workspace access', async () => {
    mocks.permissions.mockResolvedValue(null);
    await expect(readHomeOverview(actor, now)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('returns the requested UTC period and actual latest spend day without inventing missing-day zeros', async () => {
    mocks.ads.mockResolvedValue({ rows: [
      { currency: 'USD', spend: 12.3, date: '2026-10-15T00:00:00.000Z' },
      { currency: 'USD', spend: 0.7, date: '2026-10-16T00:00:00.000Z' },
    ], nextOffset: null });
    const overview = await readHomeOverview(actor, now);
    expect(overview.ads).toMatchObject({ state: 'ready', data: { start: '2026-09-23', end: '2026-10-20', spend: [
      { currency: 'USD', total: 13, firstDay: '2026-10-15', lastDay: '2026-10-16', recordedDays: 2 },
    ] } });
    expect(mocks.ads).toHaveBeenCalledWith(actor, { start: '2026-09-23', end: '2026-10-20', level: 'account', offset: 0 });
  });

  it('excludes nonfinite channel engagements from the ranking as well as totals', async () => {
    mocks.host.mockResolvedValue({ goalMeasures: async ({ targetId }: { targetId: string }) => ({ views: 5, engagements: targetId === 'c1' ? Infinity : 10 }) });
    expect((await readHomeOverview(actor, now)).performance).toMatchObject({ state: 'ready', data: {
      engagements: { current: 10, covered: 1 }, topChannels: [{ id: 'c2', name: 'Beta', engagements: 10 }],
    } });
  });

  it('isolates an unknown spend currency without hiding other cards', async () => {
    mocks.ads.mockResolvedValue({ rows: [{ currency: null, spend: 12, date: '2026-10-16' }], nextOffset: null });
    const overview = await readHomeOverview(actor, now);
    expect(overview.ads).toEqual({ state: 'unavailable' });
    expect(overview.inbox).toEqual({ state: 'ready', data: { open: 4 } });
  });
});
