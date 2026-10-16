import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsProviderData, AnalyticsMetricInput } from '../src/server/analytics/catalog';

const state = vi.hoisted(() => ({
  user: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), feature: vi.fn(), permission: vi.fn(), purge: vi.fn(),
  config: vi.fn(), load: vi.fn(), groupBy: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: state.user }, post: { groupBy: state.groupBy } } }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: state.entitlements, canUseFeature: state.feature }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: state.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: state.permission }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: state.purge }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('../src/server/analytics/data', () => ({ loadAnalytics: state.load }));

import { readAnalytics, readAnalyticsSnapshot } from '../src/modules/analytics/server/read';

const actor = { userId: 'reader', workspaceId: 'workspace' };
const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const metrics = (request: { range: { from: Date } ; selectedTargetIds: readonly string[]; selectedAdAccountIds?: readonly string[] }): AnalyticsProviderData['metrics'] => {
  const previous = request.range.from < day('2026-10-10');
  const selected = request.selectedTargetIds;
  const selectedAds = request.selectedAdAccountIds ?? ['ad-1', 'ad-2'];
  const views: AnalyticsMetricInput = {
    key: 'views', label: 'Views', sourceLabel: 'Community', kind: 'flow', unit: 'count', available: selected.length,
    coveredResourceIds: selected,
    observations: selected.flatMap(id => ['2026-10-10', '2026-10-11', '2026-10-12'].map((date, index) => ({ date: day(date), channelId: id, channelLabel: id.toUpperCase(), value: (previous ? 1 : 2) + index }))),
  } as AnalyticsMetricInput;
  const followers: AnalyticsMetricInput = {
    key: 'followers', label: 'Followers', sourceLabel: 'Community', kind: 'stock', unit: 'count', available: selected.length,
    coveredResourceIds: selected,
    observations: selected.map(id => ({ date: day('2026-10-12'), channelId: id, channelLabel: id.toUpperCase(), value: previous ? 10 : 12 })),
  } as AnalyticsMetricInput;
  const spend: AnalyticsMetricInput = {
    key: 'spend::USD', label: 'Spend · USD', sourceLabel: 'Advertising', kind: 'flow', unit: 'currency', available: selectedAds.length,
    coveredResourceIds: selectedAds,
    observations: selectedAds.map(id => ({ date: day('2026-10-12'), channelId: id, channelLabel: id.toUpperCase(), value: previous ? 5 : 7 })),
  } as AnalyticsMetricInput;
  return [...(selected.length ? [views, followers] : []), ...(selectedAds.length ? [spend] : [])];
};

beforeEach(() => {
  vi.clearAllMocks();
  state.user.mockResolvedValue({ disabledAt: null });
  state.entitlements.mockResolvedValue({});
  state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['channel-1', 'channel-2'] } });
  state.feature.mockReturnValue(true); state.permission.mockReturnValue(true); state.purge.mockResolvedValue(undefined);
  state.groupBy.mockResolvedValue([{ status: 'published', _count: { _all: 3 } }, { status: 'scheduled', _count: { _all: 2 } }, { status: 'failed', _count: { _all: 1 } }, { status: 'partially_failed', _count: { _all: 4 } }]);
  state.config.mockImplementation(async (key: string) => ({
    'analytics.defaultRangeDays': 30, 'analytics.maxRangeDays': 366, 'analytics.metricPageSize': 1,
    'analytics.detailPageSize': 1, 'analytics.chartPoints': 2, 'analytics.searchMaxLength': 200,
    'analytics.reportMaxChannels': 500,
  }[key]));
  state.load.mockImplementation(async (_workspaceId: string, selectedTargetIds: string[], range: { from: Date; to: Date }, allowedTargetIds?: readonly string[], selectedAdAccountIds?: readonly string[]) => {
    const targets = [{ id: 'channel-1', name: 'Channel One', type: 'channel' }, { id: 'channel-2', name: 'Channel Two', type: 'channel' }]
      .filter(item => !allowedTargetIds || allowedTargetIds.includes(item.id));
    const adAccounts = [{ id: 'ad-1', name: 'Account One', currency: 'USD' }, { id: 'ad-2', name: 'Account Two', currency: 'EUR' }];
    const selectedAdIds = selectedAdAccountIds ? adAccounts.filter(item => selectedAdAccountIds.includes(item.id)).map(item => item.id) : adAccounts.map(item => item.id);
    const chosenTargets = targets.filter(item => selectedTargetIds.includes(item.id));
    return {
      targets, selectedTargets: chosenTargets, adAccounts, selectedAdIds, adAccountCount: selectedAdIds.length, range,
      metrics: metrics({ range, selectedTargetIds: chosenTargets.map(item => item.id), selectedAdAccountIds: selectedAdIds }),
      audienceEntries: chosenTargets.map(item => ({ id: item.id, name: item.name, metric: 'audience', metricLabel: 'Audience', sourceLabel: 'Community', value: 100, asOf: day('2026-10-12'), fetchedAt: day('2026-10-13') })),
      audienceSelected: chosenTargets.length,
    };
  });
});

describe('shared Analytics read service', () => {
  it('rechecks active identity, membership, feature access, and erasure state', async () => {
    state.user.mockResolvedValue({ disabledAt: new Date() });
    await expect(readAnalytics(actor)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(state.entitlements).not.toHaveBeenCalled(); expect(state.load).not.toHaveBeenCalled();
    state.user.mockResolvedValue({ disabledAt: null }); state.permissions.mockResolvedValue(null);
    await expect(readAnalytics(actor)).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.entitlements).toHaveBeenCalledWith(actor.userId, actor.workspaceId, { allowInstallationInspection: false });
  });

  it('intersects trusted channel constraints with member grants and rejects unavailable selected IDs', async () => {
    const result = await readAnalytics(actor, {}, { allowedChannelIds: ['channel-1', 'outside-grant'] });
    expect(result.options.channels.map(item => item.id)).toEqual(['channel-1']);
    expect(state.load.mock.calls[0]?.[3]).toEqual(['channel-1']);
    state.load.mockClear();
    await expect(readAnalytics(actor, { filter: '1', channel: ['foreign'] })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.load).toHaveBeenCalledOnce();
  });

  it('uses explicit empty channel filters while allowing ad-account-only reports', async () => {
    const result = await readAnalytics(actor, { filter: '1', channel: [], adFilter: '1', adAccount: ['ad-2'] });
    expect(result.selected).toEqual({ channelIds: [], adAccountIds: ['ad-2'] });
    expect(result.metrics.items.map(item => item.key)).toEqual(['spend::USD']);
    expect(result.audience).toMatchObject({ total: 0, covered: 0, selected: 0 });
    expect(state.groupBy).not.toHaveBeenCalled();
    expect(state.load.mock.calls.slice(1).map(call => [call[1], call[4]])).toEqual([[[], ['ad-2']]]);
  });

  it('returns canonical UTC periods, same-scope previous comparisons, and publishing counts', async () => {
    const result = await readAnalytics(actor, { start: '2026-10-10', end: '2026-10-12', compare: 'previous', filter: '1', channel: 'channel-1', adFilter: '1', adAccount: 'ad-2' });
    expect(result.period).toMatchObject({ start: '2026-10-10', end: '2026-10-12', comparison: { mode: 'previous', start: '2026-10-07', end: '2026-10-09' } });
    expect(result.selected).toEqual({ channelIds: ['channel-1'], adAccountIds: ['ad-2'] });
    expect(result.publishing).toEqual({ published: 3, scheduled: 2, failed: 5 });
    expect(result.comparisons.views).toMatchObject({ previous: 6, delta: 3, status: 'comparable' });
    expect(state.load.mock.calls.slice(1).map(call => [call[1], call[4]])).toEqual([[['channel-1'], ['ad-2']], [['channel-1'], ['ad-2']]]);
    expect(result.query).toContain('filter=1'); expect(result.query).toContain('adFilter=1');
  });

  it('preserves canonical filter values and pages when a search has no matches', async () => {
    const result = await readAnalytics(actor, { compare: 'year', filter: '1', channel: 'channel-2', adFilter: '1', adAccount: [], search: 'no such metric', page: '2' });
    expect(result.metrics).toMatchObject({ items: [], total: 0, page: 1, pages: 1 });
    const query = new URLSearchParams(result.query);
    expect(query.get('compare')).toBe('year'); expect(query.get('channel')).toBe('channel-2');
    expect(query.get('filter')).toBe('1'); expect(query.get('adFilter')).toBe('1');
    expect(query.get('search')).toBe('no such metric'); expect(query.get('page')).toBe('1');
  });

  it('applies the configured resource selection limit to channels and ad accounts on both read surfaces', async () => {
    state.config.mockImplementation(async (key: string) => ({
      'analytics.defaultRangeDays': 30, 'analytics.maxRangeDays': 366, 'analytics.metricPageSize': 1,
      'analytics.detailPageSize': 1, 'analytics.chartPoints': 2, 'analytics.searchMaxLength': 200,
      'analytics.reportMaxChannels': 1,
    }[key]));
    await expect(readAnalyticsSnapshot(actor, { filter: '1', channel: ['channel-1', 'channel-2'], adFilter: '1', adAccount: [] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readAnalytics(actor, { filter: '1', channel: [], adFilter: '1', adAccount: ['ad-1', 'ad-2'] })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.load).not.toHaveBeenCalled();
  });

  it('applies metric search to export snapshots while keeping the full metric catalog available', async () => {
    const snapshot = await readAnalyticsSnapshot(actor, { search: 'spend', page: '3', pointPage: '2' });
    expect(snapshot.allMetrics.map(metric => metric.key)).toEqual(['spend::USD']);
    expect(snapshot.options.metrics.map(metric => metric.key)).toEqual(['spend::USD', 'followers', 'views']);
    const query = new URLSearchParams(snapshot.query);
    expect(query.get('page')).toBe('3'); expect(query.get('pointPage')).toBe('2');
  });

  it('fails closed when distinct sources emit the same metric key', async () => {
    state.load.mockImplementation(async (_workspaceId: string, selectedTargetIds: string[], range: { from: Date; to: Date }, _allowed?: readonly string[], selectedAdAccountIds?: readonly string[]) => {
      const targets = [{ id: 'channel-1', name: 'Channel One', type: 'channel' }, { id: 'channel-2', name: 'Channel Two', type: 'channel' }];
      const adAccounts = [{ id: 'ad-1', name: 'Account One', currency: 'USD' }, { id: 'ad-2', name: 'Account Two', currency: 'EUR' }];
      const selectedAdIds = selectedAdAccountIds ? [...selectedAdAccountIds] : ['ad-1', 'ad-2'];
      const selectedTargets = targets.filter(target => selectedTargetIds.includes(target.id));
      const hasSelection = selectedTargets.length > 0 || selectedAdIds.length > 0;
      const duplicateMetrics: AnalyticsMetricInput[] = hasSelection ? [
        { key: 'same', label: 'One', sourceLabel: 'Community', kind: 'flow', unit: 'count', available: 1, coveredResourceIds: ['channel-1'], observations: [{ date: day('2026-10-12'), channelId: 'channel-1', channelLabel: 'Channel One', value: 1 }] },
        { key: 'same', label: 'Two', sourceLabel: 'Advertising', kind: 'flow', unit: 'currency', available: 1, coveredResourceIds: ['ad-1'], observations: [{ date: day('2026-10-12'), channelId: 'ad-1', channelLabel: 'Account One', value: 2 }] },
      ] : [];
      return { targets, selectedTargets, adAccounts, selectedAdIds, adAccountCount: selectedAdIds.length, range, metrics: duplicateMetrics, audienceEntries: [], audienceSelected: selectedTargets.length };
    });
    await expect(readAnalytics(actor, { metric: 'same' })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it.each([{ start: '2026-02-31', end: '2026-03-01' }, { start: '2026-10-20', end: '2026-10-10' }, { page: '9007199254740992' }, { channel: ['channel-1', 'channel-1'], filter: '1' }, { unknown: 'x' }])('rejects invalid dates, repeated IDs, malformed pages, and unknown keys before data reads: %j', async input => {
    await expect(readAnalytics(actor, input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.load).not.toHaveBeenCalled(); expect(state.groupBy).not.toHaveBeenCalled();
  });

  it('paginates metrics and continues metric point/row details independently', async () => {
    const result = await readAnalytics(actor, { filter: '1', channel: ['channel-1'], adFilter: '1', adAccount: [], page: '2', metric: 'views', pointPage: '2', rowPage: '1' });
    expect(result.metrics).toMatchObject({ total: 2, page: 2, pages: 2, pageSize: 1 });
    expect(result.detail?.metric.key).toBe('views');
    expect(result.detail?.points).toMatchObject({ total: 3, page: 2, pages: 3, items: [{ date: '2026-10-11' }] });
    expect(result.detail?.rows).toMatchObject({ total: 1, page: 1, pages: 1, items: [{ label: 'CHANNEL-1' }] });
    const snapshot = await readAnalyticsSnapshot(actor, { filter: '1', channel: [], adFilter: '1', adAccount: [] });
    expect(snapshot.allMetrics).toHaveLength(0);
    expect(snapshot).toHaveProperty('comparisons');
  });
});
