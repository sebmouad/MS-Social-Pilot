import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ ids: vi.fn(), analytics: vi.fn(), load: vi.fn() }));
vi.mock('../src/server/platforms/registry', () => ({
  analyticsPlatformIds: state.ids,
  platformAnalytics: state.analytics,
}));

import { loadAnalytics } from '../src/server/analytics/data';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const facebookData = (request: { selectedTargetIds: readonly string[]; allowedTargetIds?: readonly string[]; selectedAdAccountIds?: readonly string[] }) => {
  const allTargets = [{ id: 'page-1', type: 'page', name: 'Page One', providerId: 'fb-page-1' }];
  const targets = allTargets.filter(item => request.allowedTargetIds === undefined || request.allowedTargetIds.includes(item.id));
  const selectedTargets = targets.filter(item => request.selectedTargetIds.includes(item.id));
  const accounts = [{ id: 'ad-1', name: 'Account One', currency: 'USD' }, { id: 'ad-2', name: 'Account Two', currency: 'EUR' }];
  const selectedAdAccountIds = request.selectedAdAccountIds === undefined ? accounts.map(item => item.id) : accounts.filter(item => request.selectedAdAccountIds!.includes(item.id)).map(item => item.id);
  return {
    targets, selectedTargets, adAccounts: accounts, selectedAdAccountIds,
    metrics: selectedTargets.length ? [{ key: 'page_follows::day', label: 'Followers', sourceLabel: 'Page performance', kind: 'stock' as const, unit: 'count' as const, observations: [{ date: date('2026-10-02'), channelId: 'page-1', channelLabel: 'Page One', value: 120 }], available: selectedTargets.length }] : [],
    audienceEntries: selectedTargets.map(item => ({ id: item.id, name: item.name, metric: 'page_follows', metricLabel: 'Followers', sourceLabel: 'Page performance', value: 120, asOf: date('2026-10-02'), fetchedAt: date('2026-10-03') })),
    audienceSelected: selectedTargets.length,
  };
};

describe('shared analytics loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.ids.mockResolvedValue(['facebook']);
    state.analytics.mockResolvedValue({ load: state.load });
    state.load.mockImplementation(async (request: Parameters<typeof facebookData>[0]) => facebookData(request));
  });

  it('delegates scoped storage reads and normalization to the installed analytics host', async () => {
    const range = { from: date('2026-10-01'), to: date('2026-10-31') };
    const available = await loadAnalytics('workspace-a', [], range, ['page-1']);
    expect(state.ids).toHaveBeenCalledOnce();
    expect(state.analytics).toHaveBeenCalledWith('facebook');
    expect(state.load).toHaveBeenCalledWith({ workspaceId: 'workspace-a', range, selectedTargetIds: [], allowedTargetIds: ['page-1'], selectedAdAccountIds: undefined });
    expect(available.targets.map(target => target.id)).toEqual(['page-1']);
    expect(available.metrics).toEqual([]);
  });

  it('merges only normalized selected-channel and ad-account data into the shared result', async () => {
    const range = { from: date('2026-10-01'), to: date('2026-10-31') };
    const result = await loadAnalytics('workspace-a', ['page-1'], range, ['page-1'], ['ad-2']);
    expect(result.selectedTargets.map(target => target.id)).toEqual(['page-1']);
    expect(result.selectedAdIds).toEqual(['ad-2']);
    expect(result.adAccountCount).toBe(1);
    expect(result.metrics.map(metric => metric.sourceLabel)).toEqual(['Page performance']);
    expect(result.audienceEntries).toMatchObject([{ id: 'page-1', value: 120, sourceLabel: 'Page performance' }]);
    expect(result.audienceSelected).toBe(1);
  });

  it('returns empty neutral inputs when no installed provider exposes analytics', async () => {
    state.ids.mockResolvedValue([]);
    const result = await loadAnalytics('workspace-a', [], { from: date('2026-10-01'), to: date('2026-10-31') });
    expect(result).toMatchObject({ targets: [], selectedTargets: [], adAccounts: [], selectedAdIds: [], metrics: [], audienceEntries: [], audienceSelected: 0 });
    expect(state.load).not.toHaveBeenCalled();
  });

  it('namespaces identical local metric keys from different installed modules', async () => {
    state.ids.mockResolvedValue(['provider-a', 'provider-b']);
    state.analytics.mockImplementation((provider: string) => ({ load: async () => ({
      targets: [], selectedTargets: [], adAccounts: [], selectedAdAccountIds: [], audienceEntries: [], audienceSelected: 0,
      metrics: [{ key: 'reach', label: 'Reach', sourceLabel: provider === 'provider-a' ? 'Community' : 'Video', kind: 'stock', unit: 'count', observations: [], available: 0 }],
    }) }));
    const result = await loadAnalytics('workspace-a', [], { from: date('2026-10-01'), to: date('2026-10-31') });
    expect(result.metrics.map(metric => metric.key)).toEqual(['provider-a:reach', 'provider-b:reach']);
  });
});
