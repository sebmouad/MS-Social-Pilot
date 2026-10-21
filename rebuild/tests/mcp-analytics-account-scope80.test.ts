import { beforeEach, describe, expect, it, vi } from 'vitest';

type Where = Record<string, any>;
const state = vi.hoisted(() => ({
  user: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), feature: vi.fn(), permission: vi.fn(), purge: vi.fn(), config: vi.fn(),
  targets: vi.fn(), adAccounts: vi.fn(), pageInsights: vi.fn(), adInsights: vi.fn(), groupBy: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: { $queryRaw: async () => [],
  user: { findUnique: state.user }, post: { groupBy: state.groupBy }, membership: { findUnique: async () => ({ role: 'member' }) },
  target: { findMany: state.targets }, adAccount: { findMany: state.adAccounts },
  pageInsight: { findMany: state.pageInsights }, adInsight: { findMany: state.adInsights },
} }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: state.entitlements, canUseFeature: state.feature, entitledPlatformIds: () => ['facebook'] }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: state.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: state.permission }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: state.purge }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config, runtimeConfigBatch: async (keys: string[]) => Object.fromEntries(await Promise.all(keys.map(async key => [key, await state.config(key)]))) }));
vi.mock('../src/server/platforms/registry', async () => {
  const { facebookAnalyticsHost } = await import('../src/platforms/facebook/analytics');
  return { analyticsPlatformIds: async () => ['facebook'], platformAnalytics: async () => facebookAnalyticsHost };
});

import { readAnalytics, readAnalyticsSnapshot } from '../src/modules/analytics/server/read';
import { readAnalyticsComparison } from '../src/modules/analytics/comparison/server/comparison';
import { readAnalyticsExplorer } from '../src/modules/analytics/server/explorer';

// Controlled stored rows: sa-1 is one connection holding pages 1-2 and sibling ad accounts 1-2; sa-2 holds page 3 and ad account 3.
const targets = [
  { id: 'page-1', name: 'Page One', type: 'page', providerId: 'p1', socialAccountId: 'sa-1' },
  { id: 'page-2', name: 'Page Two', type: 'page', providerId: 'p2', socialAccountId: 'sa-1' },
  { id: 'page-3', name: 'Page Three', type: 'page', providerId: 'p3', socialAccountId: 'sa-2' },
];
const accounts = [
  { id: 'ad-1', name: 'Ads One', currency: 'USD', socialAccountId: 'sa-1' },
  { id: 'ad-2', name: 'Ads Two (sibling)', currency: 'USD', socialAccountId: 'sa-1' },
  { id: 'ad-3', name: 'Ads Three', currency: 'USD', socialAccountId: 'sa-2' },
];
const matchesAccount = (account: (typeof accounts)[number], where: Where) =>
  (where.id?.in === undefined || where.id.in.includes(account.id)) &&
  (where.socialAccountId?.in === undefined || where.socialAccountId.in.includes(account.socialAccountId));
const adRow = (account: (typeof accounts)[number], day: string) => ({
  date: new Date(`${day}T00:00:00.000Z`), spend: 10, impressions: 100, clicks: 5, reach: 80, cpc: 2, cpm: 100, cpp: 125, ctr: 5, frequency: 1.25,
  actions: [], fields: {}, fetchedAt: new Date(`${day}T06:00:00.000Z`), adAccount: { id: account.id, name: account.name, currency: account.currency },
});

const base = { userId: 'key-user', workspaceId: 'w' };
const range = { start: '2026-10-01', end: '2026-10-07' };
const adIds = (result: { options: { adAccounts: Array<{ id: string }> } }) => result.options.adAccounts.map(item => item.id);
const loadedAdRequests = () => state.adAccounts.mock.calls.map(call => call[0].where);

beforeEach(() => {
  vi.clearAllMocks();
  state.user.mockResolvedValue({ disabledAt: null });
  state.entitlements.mockResolvedValue({ workspaceId:'w', platformCapabilities: { facebook: true } });
  state.permissions.mockResolvedValue({ pageScope: { all: true, ids: [] } });
  state.feature.mockReturnValue(true); state.permission.mockReturnValue(true); state.purge.mockResolvedValue(undefined);
  state.groupBy.mockResolvedValue([]);
  state.config.mockImplementation(async (key: string) => ({
    'analytics.defaultRangeDays': 30, 'analytics.maxRangeDays': 366, 'analytics.metricPageSize': 50, 'analytics.detailPageSize': 50,
    'analytics.chartPoints': 30, 'analytics.searchMaxLength': 200, 'analytics.reportMaxChannels': 500, 'analytics.reportExportRows': 1000,
    'analytics.comparison.maxMetrics': 500, 'analytics.explorerSearchMaxCharacters': 200, 'analytics.explorerPageSize': 50,
  }[key]));
  state.targets.mockImplementation(async () => targets.map(target => ({ ...target })));
  state.adAccounts.mockImplementation(async ({ where }: { where: Where }) => accounts.filter(account => matchesAccount(account, where)).map(({ socialAccountId: _s, ...account }) => account));
  state.pageInsights.mockResolvedValue([]);
  state.adInsights.mockImplementation(async ({ where }: { where: Where }) => accounts.filter(account => matchesAccount(account, where.adAccount)).map(account => adRow(account, '2026-10-03')));
});

describe('Analytics independent ad-account ceiling', () => {
  it('keeps old behavior when neither ceiling field is supplied', async () => {
    const result = await readAnalytics(base, range);
    expect(adIds(result)).toEqual(['ad-1', 'ad-2', 'ad-3']);
    expect(result.metrics.items.some(item => item.sourceLabel === 'Advertising')).toBe(true);
  });

  it('empty [] shows no ad accounts, metrics, options or detail, while undefined shows them', async () => {
    const none = await readAnalytics({ ...base, allowedAdAccountIds: [] }, range);
    expect(none.options.adAccounts).toEqual([]);
    expect(none.selected.adAccountIds).toEqual([]);
    expect(none.metrics.items.filter(item => item.sourceLabel === 'Advertising')).toEqual([]);
    expect(none.options.metrics.filter(item => item.sourceLabel === 'Advertising')).toEqual([]);
    expect(state.adInsights).not.toHaveBeenCalled();
    expect(state.adAccounts).not.toHaveBeenCalled();
    const open = await readAnalytics({ ...base, allowedAdAccountIds: undefined }, range);
    expect(adIds(open)).toEqual(['ad-1', 'ad-2', 'ad-3']);
    const adKey = open.options.metrics.find(item => item.sourceLabel === 'Advertising')!.key;
    // Metric detail for an Ads metric is refused when nothing in Ads is readable.
    await expect(readAnalytics({ ...base, allowedAdAccountIds: [] }, { ...range, metric: adKey })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('explicit account ceiling excludes sibling accounts on the same connection and refuses an out-of-scope query', async () => {
    const actor = { ...base, allowedAdAccountIds: ['ad-1'] };
    const result = await readAnalytics(actor, range);
    expect(adIds(result)).toEqual(['ad-1']);
    expect(result.selected.adAccountIds).toEqual(['ad-1']);
    expect(state.adInsights.mock.calls.every(call => call[0].where.adAccount.id.in.join() === 'ad-1')).toBe(true);
    for (const outside of ['ad-2', 'ad-3']) {
      await expect(readAnalytics(actor, { ...range, adFilter: '1', adAccount: outside })).rejects.toMatchObject({ code: 'forbidden' });
    }
    await expect(readAnalytics(actor, { ...range, adFilter: '1', adAccount: ['ad-1', 'ad-2'] })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('account-only key with no channels reads its account through independent membership grants', async () => {
    state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['page-1', 'page-2'] } });
    const actor = { ...base, allowedAdAccountIds: ['ad-1'], adAccountTargetScope: { all: false as const, ids: ['page-1', 'page-2'] } };
    const result = await readAnalytics(actor, range, { allowedChannelIds: [] });
    expect(result.options.channels).toEqual([]);
    expect(adIds(result)).toEqual(['ad-1']);
    expect(result.metrics.items.some(item => item.sourceLabel === 'Advertising')).toBe(true);
    // Without the independent scope the empty channel ceiling still erases Ads, as before.
    const legacy = await readAnalytics({ ...base, allowedAdAccountIds: ['ad-1'] }, range, { allowedChannelIds: [] });
    expect(legacy.options.adAccounts).toEqual([]);
  });

  it('the key\'s selected channels do not grant sibling accounts or accounts on other connections', async () => {
    state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['page-1'] } });
    // Membership covers only page-1 (connection sa-1); the key selected page-3 (connection sa-2) as a channel.
    const actor = { ...base, allowedAdAccountIds: ['ad-1', 'ad-3'], adAccountTargetScope: { all: false as const, ids: ['page-1'] } };
    const result = await readAnalytics(actor, range, { allowedChannelIds: ['page-3'] });
    expect(result.options.channels).toEqual([]);
    expect(adIds(result)).toEqual(['ad-1']);
    await expect(readAnalytics(actor, { ...range, adFilter: '1', adAccount: 'ad-3' }, { allowedChannelIds: ['page-3'] })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('membership grants are intersected fresh: revoked or foreign grant ids add nothing', async () => {
    state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['page-3'] } });
    const actor = { ...base, adAccountTargetScope: { all: false as const, ids: ['page-1', 'page-2'] } };
    const result = await readAnalytics(actor, range);
    expect(result.options.adAccounts).toEqual([]);
    state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['page-1'] } });
    expect(adIds(await readAnalytics({ ...base, adAccountTargetScope: { all: true } }, range))).toEqual(['ad-1', 'ad-2']);
    expect(adIds(await readAnalytics({ ...base, adAccountTargetScope: { all: true }, allowedAdAccountIds: ['ad-2'] }, range))).toEqual(['ad-2']);
  });

  it('applies the same ceiling to the initial, current and comparison loads', async () => {
    const actor = { ...base, allowedAdAccountIds: ['ad-2'], adAccountTargetScope: { all: true as const } };
    const result = await readAnalytics(actor, { ...range, compare: 'previous' });
    expect(adIds(result)).toEqual(['ad-2']);
    expect(state.adAccounts.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const where of loadedAdRequests()) expect(where.id).toEqual({ in: ['ad-2'] });
    for (const call of state.adInsights.mock.calls) expect(call[0].where.adAccount.id).toEqual({ in: ['ad-2'] });
  });

  it('comparison and explorer details cannot escape the account ceiling', async () => {
    const actor = { ...base, allowedAdAccountIds: ['ad-1'], adAccountTargetScope: { all: true as const } };
    const compared = await readAnalyticsComparison(actor, { mode: 'period', a: { start: '2026-10-01', end: '2026-10-03' }, b: { start: '2026-10-04', end: '2026-10-07' } });
    expect(JSON.stringify(compared)).not.toMatch(/ad-2|ad-3|Ads Two|Ads Three/);
    await expect(readAnalyticsComparison(actor, { mode: 'period', adAccount: ['ad-2'], a: { start: '2026-10-01', end: '2026-10-03' }, b: { start: '2026-10-04', end: '2026-10-07' } })).rejects.toMatchObject({ code: 'forbidden' });
    const snapshot = await readAnalyticsSnapshot(actor, range);
    const adMetric = snapshot.allMetrics.find(metric => metric.sourceLabel === 'Advertising')!;
    const detail = await readAnalyticsExplorer(actor, { ...range, metric: adMetric.key });
    expect(JSON.stringify(detail)).not.toMatch(/ad-2|ad-3|Ads Two|Ads Three/);
    await expect(readAnalyticsExplorer(actor, { ...range, adFilter: '1', adAccount: 'ad-3' })).rejects.toMatchObject({ code: 'forbidden' });
    const none = { ...actor, allowedAdAccountIds: [] as string[] };
    const emptyCompare = await readAnalyticsComparison(none, { mode: 'period', a: { start: '2026-10-01', end: '2026-10-03' }, b: { start: '2026-10-04', end: '2026-10-07' } });
    expect(JSON.stringify(emptyCompare)).not.toMatch(/Advertising|Ads One|ad-1/);
    const emptyExplorer = await readAnalyticsExplorer(none, range);
    expect(JSON.stringify(emptyExplorer)).not.toMatch(/Advertising|Ads One|ad-1/);
  });
});
