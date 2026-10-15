import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  targets: vi.fn(), instagramAccounts: vi.fn(), pageInsights: vi.fn(), instagramInsights: vi.fn(), adInsights: vi.fn(), adCount: vi.fn(),
}));

vi.mock('../src/server/data', () => ({
  prisma: {
    target: { findMany: state.targets },
    instagramAccount: { findMany: state.instagramAccounts },
    pageInsight: { findMany: state.pageInsights },
    instagramInsight: { findMany: state.instagramInsights },
    adInsight: { findMany: state.adInsights },
    adAccount: { count: state.adCount },
  },
}));

import { loadAnalytics } from '../src/server/analytics/data';
import { buildAnalytics } from '../src/server/analytics/aggregate';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('rebuild Instagram analytics data selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.instagramAccounts.mockResolvedValue([
      { igUserId: 'ig-provider-1', followersCount: 91, lastSyncedAt: null, updatedAt: date('2026-10-03') },
      { igUserId: 'ig-provider-2', followersCount: 42, lastSyncedAt: date('2026-10-03') },
    ]);
    state.targets.mockResolvedValue([
      { id: 'page-1', type: 'page', name: 'Page One', providerId: 'fb-provider-1', socialAccountId: 'social-1' },
      { id: 'ig-target-1', type: 'instagram', name: '@one', providerId: 'ig-provider-1', socialAccountId: 'social-1' },
      { id: 'ig-target-2', type: 'instagram', name: '@two', providerId: 'ig-provider-2', socialAccountId: 'social-2' },
    ]);
    state.pageInsights.mockResolvedValue([]);
    state.instagramInsights.mockResolvedValue([]);
    state.adInsights.mockResolvedValue([]);
    state.adCount.mockResolvedValue(0);
  });

  it('offers connected Instagram targets when publishing is disabled and selects insights by Instagram provider id, not linked Page targetId', async () => {
    const range = { from: date('2026-10-01'), to: date('2026-10-31') };
    const result = await loadAnalytics('workspace-1', ['ig-target-1'], range);

    expect(state.targets).toHaveBeenCalledWith(expect.objectContaining({
      where: { workspaceId: 'workspace-1', OR: [{ enabled: true, type: { not: 'instagram' } }, { type: 'instagram', providerId: { in: ['ig-provider-1', 'ig-provider-2'] } }] },
    }));
    expect(result.selectedTargets.map(target => target.id)).toEqual(['ig-target-1']);
    expect(state.instagramInsights).toHaveBeenCalledWith(expect.objectContaining({
      where: { account: { workspaceId: 'workspace-1', enabled: true, igUserId: { in: ['ig-provider-1'] } }, endTime: { gte: range.from, lte: range.to } },
    }));
    expect(result.selectedInstagramAudience.map(row => row.igUserId)).toEqual(['ig-provider-1']);
  });

  it('limits available and selected targets to the allowed target IDs', async () => {
    const range = { from: date('2026-10-01'), to: date('2026-10-31') };
    const available = await loadAnalytics('workspace-1', [], range, ['page-1']);
    const result = await loadAnalytics('workspace-1', ['page-1', 'ig-target-1'], range, ['page-1']);

    expect(available.targets.map(target => target.id)).toEqual(['page-1']);
    expect(result.targets.map(target => target.id)).toEqual(['page-1']);
    expect(result.selectedTargets.map(target => target.id)).toEqual(['page-1']);
    expect(state.instagramInsights).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { account: { workspaceId: 'workspace-1', enabled: true, igUserId: { in: [] } }, endTime: { gte: range.from, lte: range.to } },
    }));
  });

  it('sums current Page and Instagram followers for the selected channels', () => {
    const result = buildAnalytics([], [], [
      { metric: 'page_follows', numeric: 120, endTime: date('2026-10-02'), fetchedAt: date('2026-10-03'), target: { id: 'page-1', name: 'Page One' } },
    ], [
      { id: 'page-1', type: 'page', name: 'Page One', providerId: 'fb-provider-1' },
      { id: 'ig-target-1', type: 'instagram', name: '@one', providerId: 'ig-provider-1' },
    ], 0, [], [
      { igUserId: 'ig-provider-1', followersCount: 91, lastSyncedAt: null, updatedAt: date('2026-10-03') },
      { igUserId: 'ig-provider-2', followersCount: 42, lastSyncedAt: date('2026-10-03') },
    ]);
    expect(result.audience).toMatchObject({ total: 211, covered: 2, selected: 2 });
    expect(result.audience.entries.map(row => row.id)).toEqual(['page-1', 'ig-target-1']);
  });

  it('aggregates Instagram account metrics across selected accounts using the target provider id', () => {
    const result = buildAnalytics([], [], [], [
      { id: 'ig-target-1', type: 'instagram', name: '@one', providerId: 'ig-provider-1' },
      { id: 'ig-target-2', type: 'instagram', name: '@two', providerId: 'ig-provider-2' },
    ], 0, [
      { metric: 'views', period: 'day', endTime: date('2026-10-01'), fetchedAt: date('2026-10-02'), numeric: 12, value: 12, account: { id: 'account-1', igUserId: 'ig-provider-1', username: 'one' } },
      { metric: 'views', period: 'day', endTime: date('2026-10-02'), fetchedAt: date('2026-10-03'), numeric: 7, value: 7, account: { id: 'account-2', igUserId: 'ig-provider-2', username: 'two' } },
    ]);
    expect(result.metrics.find(metric => metric.key === 'views::day')).toMatchObject({ source: 'instagram', total: 19, coverage: 2, available: 2 });
  });
});
