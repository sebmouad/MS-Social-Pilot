import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ guard: vi.fn(), status: vi.fn(), analytics: vi.fn(), ads: vi.fn(), inbox: vi.fn(), persist: vi.fn() }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: state.guard }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'platforms.facebook.enabled' ? true : key === 'sync.maxItemsPerJob' ? 10 : ['grant'] }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: async () => ({ getStatus: state.status, getPageInsightObservations: state.analytics, getAdInsights: state.ads, listInbox: state.inbox }) }));
vi.mock('../src/server/data', () => {
  const socialAccount = { workspaceId: 'workspace-a', accessToken: 'token', invalidatedAt: null, tokenExpiresAt: null, scopes: 'grant' };
  const target = { id: 'target-a', workspaceId: 'workspace-a', providerId: 'page-a', accessToken: 'token', socialAccount };
  return { prisma: {
    target: { findMany: async () => [target] },
    adAccount: { findMany: async () => [{ id: 'account-a', workspaceId: 'workspace-a', actId: 'act-a', name: 'Account', socialAccount }], updateMany: state.persist },
    postTarget: { findMany: async () => [{ id: 'delivery-a', postId: 'post-a', remotePostId: 'remote-a', target }], updateMany: state.persist },
    appSetting: { findUnique: async () => null, upsert: async () => ({}) },
    pageInsight: { upsert: state.persist }, adInsight: { upsert: state.persist },
  } };
});
import { OperationError } from '../src/lib/operation-error';
import { syncAdsAnalytics, syncInbox, syncPageAnalytics, syncScheduledPostStatus } from '../src/platforms/facebook/jobs';

beforeEach(() => {
  vi.clearAllMocks();
  state.guard.mockRejectedValue(new OperationError('forbidden', 'This workspace is suspended.'));
});

describe('background provider work respects workspace access', () => {
  it.each([
    ['post status', syncScheduledPostStatus], ['channel analytics', syncPageAnalytics],
    ['ads analytics', syncAdsAnalytics], ['Inbox', syncInbox],
  ] as const)('blocks %s provider requests and persistence when the workspace lock rejects access', async (_name, run) => {
    const result = await run(new Date('2026-10-16T00:00:00Z'));
    expect(state.guard).toHaveBeenCalledWith('workspace-a', expect.any(Function));
    expect(result).toMatchObject({ updated: 0, failed: 1 });
    for (const request of [state.status, state.analytics, state.ads, state.inbox, state.persist]) expect(request).not.toHaveBeenCalled();
  });
});
