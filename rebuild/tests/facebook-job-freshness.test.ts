import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ lock: vi.fn(), resourceLock: vi.fn(), access: vi.fn(), selected: vi.fn(), fresh: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: state.lock }));
vi.mock('../src/server/jobs/access', () => ({ assertWorkspaceJobAccess: state.access }));
vi.mock('../src/server/platforms/resource-lock', () => ({ withSelectedResourceOperation: async (workspaceId: string, resource: unknown, run: (tx: unknown, signal: AbortSignal) => Promise<unknown>) => state.resourceLock(workspaceId, resource, run) }));
vi.mock('../src/server/data', () => ({ prisma: {
  target: { findMany: state.selected, findFirst: state.fresh },
  pageInsight: { upsert: state.write },
  appSetting: { findUnique: async () => null, upsert: async () => ({}) },
} }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: async () => ({ getPostHistory: async () => ({ posts: [], failures: [], progress: { after: null, complete: true, since: "2026-01-01", until: "2026-10-20" } }), getPageInsightObservations: state.read }) }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => {
  if (key === 'platforms.facebook.enabled') return true;
  if (key === 'sync.maxItemsPerJob') return 10;
  if (key === 'meta.pageInsightReadScopes') return ['read_insights', 'pages_read_engagement'];
  if (key === 'meta.pageAnalyticsLookbackDays') return 7;
  return [];
} }));

import { OperationError } from '../src/lib/operation-error';
import { syncPageAnalytics } from '../src/platforms/facebook/jobs';

const selectedTarget = { id: 'target-1', workspaceId: 'workspace-1', providerId: 'page-1', accessToken: 'old-page-token', socialAccount: { workspaceId: 'workspace-1', accessToken: 'old-user-token', scopes: 'read_insights,pages_read_engagement', tokenExpiresAt: null, invalidatedAt: null } };
const currentTarget = (accessToken: string, scopes = 'read_insights,pages_read_engagement') => ({ providerId: 'page-1', accessToken, socialAccount: { workspaceId: 'workspace-1', accessToken: 'user-token', scopes, tokenExpiresAt: null, invalidatedAt: null } });

beforeEach(() => {
  vi.clearAllMocks();
  state.lock.mockImplementation(async (_workspaceId: string, work: () => Promise<unknown>) => work());
  state.resourceLock.mockImplementation(async (_workspaceId: string, _resource: unknown, run: (tx: unknown, signal: AbortSignal) => Promise<unknown>) => run({ pageInsight: { upsert: state.write }, appSetting: { findUnique: async () => null, upsert: async () => ({}) } }, new AbortController().signal));
  state.access.mockResolvedValue(undefined);
  state.selected.mockResolvedValue([selectedTarget]);
  state.fresh.mockResolvedValue(currentTarget('new-page-token'));
  state.read.mockResolvedValue([]);
  state.write.mockResolvedValue({});
});

describe('Facebook background job freshness', () => {
  it('reads the latest token and grant after the selected-resource lock is acquired', async () => {
    state.resourceLock.mockImplementation(async (_workspaceId: string, _resource: unknown, run: (tx: unknown, signal: AbortSignal) => Promise<unknown>) => {
      state.fresh.mockResolvedValueOnce(currentTarget('rotated-token'));
      return run({ pageInsight: { upsert: state.write }, appSetting: { findUnique: async () => null, upsert: async () => ({}) } }, new AbortController().signal);
    });
    await syncPageAnalytics();
    expect(state.read).toHaveBeenCalledWith('rotated-token', 'page-1', expect.any(Date), expect.any(Date));
    expect(state.fresh).toHaveBeenCalledTimes(4); // analytics read, pre-write, history read and final persistence checks
  });

  it('does not persist observations when current workspace job access disappears after the read', async () => {
    state.read.mockResolvedValue([{ metric: 'page_views_total', period: 'day', endTime: new Date('2026-10-16T00:00:00Z'), value: 3, numeric: 3 }]);
    state.access.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new OperationError('forbidden', 'not currently entitled'));
    const result = await syncPageAnalytics();
    expect(result).toMatchObject({ skipped: 1, failed: 0, updated: 0 });
    expect(state.read).toHaveBeenCalledTimes(1);
    expect(state.write).not.toHaveBeenCalled();
  });

  it('marks a write batch skipped if workspace access disappears before transaction commit', async () => {
    state.read.mockResolvedValue([{ metric: 'page_views_total', period: 'day', endTime: new Date('2026-10-16T00:00:00Z'), value: 3, numeric: 3 }]);
    state.access.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new OperationError('forbidden', 'policy changed during persistence'));
    expect(await syncPageAnalytics()).toMatchObject({ updated: 0, skipped: 1, failed: 0 });
    expect(state.write).toHaveBeenCalledTimes(1);
  });

  it('reports no successful rows when the selected-resource transaction rejects after writes', async () => {
    state.read.mockResolvedValue([{ metric: 'page_views_total', period: 'day', endTime: new Date('2026-10-16T00:00:00Z'), value: 3, numeric: 3 }]);
    state.resourceLock.mockImplementationOnce(async (_workspaceId: string, _resource: unknown, run: (tx: unknown, signal: AbortSignal) => Promise<unknown>) => {
      await run({ pageInsight: { upsert: state.write }, appSetting: { findUnique: async () => null, upsert: async () => ({}) } }, new AbortController().signal);
      throw new Error('transaction commit failed');
    });
    expect(await syncPageAnalytics()).toMatchObject({ updated: 0, failed: 1 });
    expect(state.write).toHaveBeenCalledTimes(1);
  });

  it('skips provider IO when the fresh connection no longer has the configured grant', async () => {
    state.fresh.mockResolvedValue(currentTarget('current-token', 'pages_show_list'));
    expect(await syncPageAnalytics()).toMatchObject({ skipped: 1, failed: 0 });
    expect(state.read).not.toHaveBeenCalled();
    expect(state.write).not.toHaveBeenCalled();
  });
});
