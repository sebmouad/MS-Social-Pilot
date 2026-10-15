import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: vi.fn() }));

const state = vi.hoisted(() => ({ targets: vi.fn(), upsert: vi.fn(), observations: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { target: { findMany: state.targets }, pageInsight: { upsert: state.upsert } } }));
vi.mock('../src/server/platforms/facebook', () => ({ configuredFacebookEngine: async () => ({ getPageInsightObservations: state.observations }), configuredFacebookAdapter: vi.fn() }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
let facebookEnabled = true;
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'platforms.facebook.enabled' ? facebookEnabled : 100 }));

import { syncPageAnalytics } from '../src/server/jobs/sync';

beforeEach(() => {
  vi.clearAllMocks();
  facebookEnabled = true;
  state.targets.mockResolvedValue([{ id: 'target-1', workspaceId: 'workspace-1', providerId: 'provider-1', accessToken: 'encrypted-token', socialAccount: { workspaceId: 'workspace-1', accessToken: 'encrypted-token', tokenExpiresAt: null, invalidatedAt: null } }]);
  state.upsert.mockResolvedValue({});
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

  it('does not call Facebook or read connected data while the engine is disabled in Root', async () => {
    facebookEnabled = false;
    expect(await syncPageAnalytics(new Date('2026-01-04T12:00:00Z'))).toEqual({ examined: 0, updated: 0, skipped: 0, failed: 0 });
    expect(state.targets).not.toHaveBeenCalled();
    expect(state.observations).not.toHaveBeenCalled();
  });
});
