import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: (_workspaceId: string, operation: () => Promise<unknown>) => operation() }));

const state = vi.hoisted(() => ({ targets: vi.fn(), freshTarget: vi.fn(), upsert: vi.fn(), observations: vi.fn(), settingRead: vi.fn(), settingWrite: vi.fn(), access: vi.fn() }));
vi.mock('../src/server/jobs/access', () => ({ assertWorkspaceJobAccess: state.access }));
vi.mock('../src/server/platforms/resource-lock', () => ({ withSelectedResourceOperation: async (_workspaceId: string, _resource: unknown, run: (tx: unknown, signal: AbortSignal) => Promise<unknown>) => run({ pageInsight: { upsert: state.upsert }, appSetting: { findUnique: async () => null, upsert: async () => ({}) }, externalPost: { upsert: async () => ({}) }, $queryRaw: async () => [], $executeRaw: async () => 1 }, new AbortController().signal) }));
vi.mock('../src/server/data', () => ({ prisma: { $queryRaw: async () => [], target: { findMany: state.targets, findFirst: state.freshTarget }, pageInsight: { upsert: state.upsert }, appSetting: { findUnique: state.settingRead, upsert: state.settingWrite } } }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: async () => ({ getPageInsightObservations: state.observations, getPostHistory: async () => ({ posts: [], failures: [], progress: {} }) }), configuredFacebookAdapter: vi.fn() }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
let facebookEnabled = true;
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'platforms.facebook.enabled' ? facebookEnabled : key === 'meta.pageInsightReadScopes' ? ['read_insights', 'pages_read_engagement'] : key === 'meta.pageAnalyticsLookbackDays' ? 7 : ((await import('../src/lib/config/registry')).CONFIG_BY_KEY.get(key as never)?.defaultValue ?? 100) }));

import { syncPageAnalytics } from '../src/platforms/facebook/jobs';
import { OperationError } from '../src/lib/operation-error';

beforeEach(() => {
  vi.clearAllMocks();
  facebookEnabled = true;
  state.targets.mockResolvedValue([{ id: 'target-1', workspaceId: 'workspace-1', providerId: 'provider-1', accessToken: 'encrypted-token', socialAccount: { workspaceId: 'workspace-1', accessToken: 'encrypted-token', scopes: 'read_insights,pages_read_engagement', tokenExpiresAt: null, invalidatedAt: null } }]);
  state.freshTarget.mockResolvedValue({ providerId: 'provider-1', accessToken: 'encrypted-token', socialAccount: { workspaceId: 'workspace-1', accessToken: 'encrypted-token', scopes: 'read_insights,pages_read_engagement', tokenExpiresAt: null, invalidatedAt: null } });
  state.access.mockResolvedValue(undefined);
  state.upsert.mockResolvedValue({});
  state.settingRead.mockResolvedValue(null);
  state.settingWrite.mockResolvedValue({});
});

describe('Page analytics ingestion', () => {
  it('persists each provider-dated observation with its actual period and JSON breakdown', async () => {
    state.observations.mockResolvedValue([
      { metric: 'page_media_view', period: 'day', endTime: new Date('2026-01-02T00:00:00Z'), value: 4, numeric: 4 },
      { metric: 'page_media_view', period: 'day', endTime: new Date('2026-01-03T00:00:00Z'), value: 7, numeric: 7 },
      { metric: 'page_views_by_country', period: 'week', endTime: new Date('2026-01-03T00:00:00Z'), value: { MA: 12 }, numeric: null },
    ]);
    const result = await syncPageAnalytics(new Date('2026-01-04T12:00:00Z'));
    expect(result).toEqual({ examined: 1, updated: 3, skipped: 0, failed: 0 });
    expect(state.upsert.mock.calls.map(call => call[0].where.targetId_metric_period_endTime)).toEqual([
      { targetId: 'target-1', metric: 'page_media_view', period: 'day', endTime: new Date('2026-01-02T00:00:00Z') },
      { targetId: 'target-1', metric: 'page_media_view', period: 'day', endTime: new Date('2026-01-03T00:00:00Z') },
      { targetId: 'target-1', metric: 'page_views_by_country', period: 'week', endTime: new Date('2026-01-03T00:00:00Z') },
    ]);
    expect(state.upsert.mock.calls[2][0].create).toMatchObject({ value: { MA: 12 }, numeric: null });
  });

  it('persists supported metrics while counting isolated metric failures', async () => {
    const observations = Object.assign([{ metric: 'page_views_total', period: 'day', endTime: new Date('2026-01-03T00:00:00Z'), value: 9, numeric: 9 }], {
      failedMetrics: [{ metric: 'unsupported_metric', message: 'Unsupported metric' }],
    });
    state.observations.mockResolvedValue(observations);
    expect(await syncPageAnalytics(new Date('2026-01-04T12:00:00Z'))).toEqual({ examined: 1, updated: 1, skipped: 0, failed: 1 });
    expect(state.upsert).toHaveBeenCalledTimes(1);
  });

  it('does not call Facebook or read connected data while the engine is disabled in Root', async () => {
    facebookEnabled = false;
    expect(await syncPageAnalytics(new Date('2026-01-04T12:00:00Z'))).toEqual({ examined: 0, updated: 0, skipped: 0, failed: 0 });
    expect(state.targets).not.toHaveBeenCalled();
    expect(state.observations).not.toHaveBeenCalled();
  });

  it('uses the current connection token after waiting for the workspace lock', async () => {
    state.freshTarget.mockResolvedValue({ providerId: 'provider-1', accessToken: 'refreshed-page-token', socialAccount: { workspaceId: 'workspace-1', accessToken: 'refreshed-user-token', scopes: 'read_insights,pages_read_engagement', tokenExpiresAt: null, invalidatedAt: null } });
    state.observations.mockResolvedValue([]);
    await syncPageAnalytics();
    expect(state.observations).toHaveBeenCalledWith('refreshed-page-token', 'provider-1', expect.any(Date), expect.any(Date));
  });

  it('re-reads credentials and current grants on every retry', async () => {
    state.freshTarget.mockResolvedValueOnce({ providerId: 'provider-1', accessToken: 'expired-token', socialAccount: { workspaceId: 'workspace-1', accessToken: 'user-token', tokenExpiresAt: null, invalidatedAt: null, scopes: 'read_insights,pages_read_engagement' } })
      .mockResolvedValueOnce({ providerId: 'provider-1', accessToken: 'new-token', socialAccount: { workspaceId: 'workspace-1', accessToken: 'user-token', tokenExpiresAt: null, invalidatedAt: null, scopes: 'read_insights,pages_read_engagement' } });
    state.observations.mockRejectedValueOnce(new TypeError('temporary network issue')).mockResolvedValueOnce([]);
    await syncPageAnalytics(new Date('2026-01-04T12:00:00Z'), 1, { baseDelayMs: 0, maxDelayMs: 0 });
    expect(state.observations.mock.calls.map(call => call[0])).toEqual(['expired-token', 'new-token']);
    expect(state.freshTarget).toHaveBeenCalledTimes(5); // two provider attempts, the history read, then the write-phase recheck and final persistence check
  });

  it('does not reuse the old grant after a retry observes scope loss', async () => {
    state.freshTarget.mockResolvedValueOnce({ providerId: 'provider-1', accessToken: 'first-token', socialAccount: { workspaceId: 'workspace-1', accessToken: 'user-token', tokenExpiresAt: null, invalidatedAt: null, scopes: 'read_insights,pages_read_engagement' } })
      .mockResolvedValueOnce({ providerId: 'provider-1', accessToken: 'new-token', socialAccount: { workspaceId: 'workspace-1', accessToken: 'user-token', tokenExpiresAt: null, invalidatedAt: null, scopes: 'pages_show_list' } });
    state.observations.mockRejectedValueOnce(new TypeError('temporary network issue'));
    expect(await syncPageAnalytics(new Date('2026-01-04T12:00:00Z'), 1, { baseDelayMs: 0, maxDelayMs: 0 })).toMatchObject({ skipped: 1, failed: 0, updated: 0 });
    expect(state.observations.mock.calls.map(call => call[0])).toEqual(['first-token']);
    expect(state.upsert).not.toHaveBeenCalled();
  });

  it('skips a connection that lost current access before provider IO', async () => {
    state.freshTarget.mockResolvedValue(null);
    expect(await syncPageAnalytics()).toMatchObject({ skipped: 1, failed: 0, updated: 0 });
    expect(state.observations).not.toHaveBeenCalled();
    expect(state.upsert).not.toHaveBeenCalled();
  });

  it('blocks persistence if workspace job access is revoked after the provider read', async () => {
    state.observations.mockResolvedValue([{ metric: 'page_views_total', period: 'day', endTime: new Date('2026-01-03T00:00:00Z'), value: 9, numeric: 9 }]);
    state.access.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new OperationError('forbidden', 'access revoked'));
    expect(await syncPageAnalytics()).toMatchObject({ skipped: 1, failed: 0, updated: 0 });
    expect(state.observations).toHaveBeenCalledTimes(1);
    expect(state.upsert).not.toHaveBeenCalled();
  });
});
