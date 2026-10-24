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

describe('channel Analytics stays separate from Ads regardless of credential account grants', () => {
  it.each([undefined, [], ['ad-1'], ['ad-1', 'ad-2', 'ad-3']])('excludes paid reads with account ceiling %j', async allowedAdAccountIds => {
    const actor = { ...base, allowedAdAccountIds, adAccountTargetScope: { all: true as const } };
    const result = await readAnalytics(actor, { ...range, compare: 'previous' });
    expect(result.options.adAccounts).toEqual([]);
    expect(result.selected.adAccountIds).toEqual([]);
    expect(result.metrics.items.some(metric => metric.resourceKind === 'ad-account')).toBe(false);
    expect(state.adAccounts).not.toHaveBeenCalled();
    expect(state.adInsights).not.toHaveBeenCalled();
  });

  it('an account-only key has no channel metrics and cannot import its paid scope', async () => {
    const actor = { ...base, allowedAdAccountIds: ['ad-1'], adAccountTargetScope: { all: true as const } };
    const result = await readAnalytics(actor, range, { allowedChannelIds: [] });
    expect(result.options.channels).toEqual([]);
    expect(result.metrics.items).toEqual([]);
    expect(result.options.adAccounts).toEqual([]);
    expect(state.adAccounts).not.toHaveBeenCalled();
  });

  it('refuses explicit paid filters on overview, export snapshots, explorer and comparison', async () => {
    const actor = { ...base, allowedAdAccountIds: ['ad-1'] };
    const paidInput = { ...range, adFilter: '1', adAccount: 'ad-1' };
    for (const read of [readAnalytics, readAnalyticsSnapshot, readAnalyticsExplorer]) {
      await expect(read(actor, paidInput)).rejects.toMatchObject({ code: 'invalid_request' });
    }
    await expect(readAnalyticsComparison(actor, { mode: 'period', adAccount: ['ad-1'], a: { start: '2026-10-01', end: '2026-10-03' }, b: { start: '2026-10-04', end: '2026-10-07' } })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.adAccounts).not.toHaveBeenCalled();
    expect(state.adInsights).not.toHaveBeenCalled();
  });

  it('refuses paid metric detail keys and keeps explorer and comparisons channel-only', async () => {
    await expect(readAnalytics(base, { ...range, metric: 'facebook:spend::USD' })).rejects.toMatchObject({ code: 'forbidden' });
    const explorer = await readAnalyticsExplorer(base, range);
    expect(explorer.options.adAccounts).toEqual([]);
    const compared = await readAnalyticsComparison(base, { mode: 'period', a: { start: '2026-10-01', end: '2026-10-03' }, b: { start: '2026-10-04', end: '2026-10-07' } });
    expect(JSON.stringify(compared)).not.toMatch(/Advertising|Ads One|ad-1/);
    expect(state.adAccounts).not.toHaveBeenCalled();
    expect(state.adInsights).not.toHaveBeenCalled();
  });
});
