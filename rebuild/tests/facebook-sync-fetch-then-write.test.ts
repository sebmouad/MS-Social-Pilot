import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  depth: 0, events: [] as string[], providerDepths: [] as number[],
  targets: vi.fn(), accounts: vi.fn(), freshTarget: vi.fn(), freshAccount: vi.fn(), postTargets: vi.fn(), freshPostTarget: vi.fn(),
  insights: vi.fn(), history: vi.fn(), ads: vi.fn(), status: vi.fn(), cursorRows: vi.fn(), insightUpsert: vi.fn(), adUpsert: vi.fn(), executeRaw: vi.fn(), updateMany: vi.fn(),
}));

const grants = { workspaceId: 'w', accessToken: 'token', scopes: 'read_insights,ads_read,pages_read_engagement', tokenExpiresAt: null, invalidatedAt: null };
const pageBinding = { providerId: 'pa', accessToken: null, socialAccount: grants };
async function inside<T>(name: string, run: () => Promise<T>): Promise<T> {
  state.depth++; state.events.push(`${name}:begin`);
  try { return await run(); } finally { state.depth--; state.events.push(`${name}:end`); }
}
const record = (name: string) => { state.providerDepths.push(state.depth); state.events.push(`provider:${name}`); };
const tx = {
  pageInsight: { upsert: (...args: unknown[]) => state.insightUpsert(...args) },
  adInsight: { upsert: (...args: unknown[]) => state.adUpsert(...args) },
  adAccount: { updateMany: async () => ({ count: 1 }) },
  postTarget: { updateMany: (...args: unknown[]) => state.updateMany(...args), groupBy: async () => [{ status: 'published', _count: 1 }], findFirst: async () => ({ id: 'pt1', target: { accessToken: null, socialAccount: grants } }) },
  post: { updateMany: async () => ({ count: 1 }) },
  $queryRaw: async (...args: unknown[]) => { state.events.push('tx:query'); return args.length && String(args[0]).includes('pg_try_advisory_xact_lock') ? [{ acquired: true }] : state.cursorRows(); },
  $executeRaw: (...args: unknown[]) => state.executeRaw(...args),
};

vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: (_w: string, operation: () => Promise<unknown>) => inside('workspace', operation) }));
vi.mock('../src/server/jobs/access', () => ({ assertWorkspaceJobAccess: vi.fn() }));
vi.mock('../src/server/platforms/resource-lock', () => ({ withSelectedResourceOperation: (_w: string, _r: unknown, run: (t: unknown, signal: AbortSignal) => Promise<unknown>) => inside('lock', () => run(tx, new AbortController().signal)) }));
vi.mock('../src/modules/publishing/server/guard', () => ({ lockPublishingTargets: async () => undefined }));
vi.mock('../src/modules/publishing/server/post-deletion-guard', () => ({ assertNoPostDeletionForRemoteIdentity: async () => undefined }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => {
  if (key === 'platforms.facebook.enabled') return true;
  if (key === 'sync.maxItemsPerJob') return 5;
  if (key === 'sync.resourceOperationTimeoutMs') return 60000;
  if (key === 'meta.pageInsightReadScopes') return ['read_insights'];
  if (key === 'meta.adsReadScopes') return ['ads_read'];
  if (key === 'meta.postReadScopes') return ['pages_read_engagement'];
  if (key === 'meta.pageAnalyticsLookbackDays' || key === 'meta.adsAnalyticsLookbackDays') return 7;
  return [];
} }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: async () => ({
  getPageInsightObservations: async () => { record('insights'); return state.insights(); },
  getPostHistory: async () => { record('history'); return state.history(); },
  getAdInsights: async () => { record('ads'); return state.ads(); },
  getStatus: async () => { record('status'); return state.status(); },
}) }));
vi.mock('../src/server/data', () => ({ prisma: {
  $queryRaw: async () => state.cursorRows(),
  target: { findMany: state.targets, findFirst: state.freshTarget },
  adAccount: { findMany: state.accounts, findFirst: state.freshAccount },
  appSetting: { findUnique: async () => null, upsert: async () => ({}) },
  postTarget: { findMany: state.postTargets, findFirst: state.freshPostTarget },
} }));

import { syncAdsAnalytics, syncPageAnalytics, syncScheduledPostStatus } from '../src/platforms/facebook/jobs';

const progress = { after: null, complete: true, since: '2026-01-01', until: '2026-10-20' };
const observation = { metric: 'page_views_total', period: 'day', endTime: new Date('2026-10-16T00:00:00Z'), value: 3, numeric: 3 };

beforeEach(() => {
  vi.clearAllMocks(); state.depth = 0; state.events.length = 0; state.providerDepths.length = 0;
  state.targets.mockResolvedValue([{ id: 'target-a', workspaceId: 'w', providerId: 'pa' }]);
  state.accounts.mockResolvedValue([{ id: 'acct-a', workspaceId: 'w', actId: 'act_1', name: 'Account' }]);
  state.freshTarget.mockImplementation(async () => { state.events.push('recheck'); return pageBinding; });
  state.freshAccount.mockImplementation(async () => { state.events.push('recheck'); return { actId: 'act_1', socialAccount: grants }; });
  state.cursorRows.mockResolvedValue([]);
  state.insights.mockResolvedValue([observation]);
  state.history.mockResolvedValue({ posts: [{ remoteId: 'p1', message: 'm', permalink: null, statusType: null, pictureUrl: null, createdTime: new Date(), insights: {} }], failures: [], progress });
  state.ads.mockResolvedValue([{ date_start: '2026-10-16', spend: '1.5', impressions: '10' }]);
  state.insightUpsert.mockResolvedValue({}); state.adUpsert.mockResolvedValue({}); state.executeRaw.mockResolvedValue(1);
  state.postTargets.mockResolvedValue([{ id: 'pt1', postId: 'post1', remotePostId: 'remote1', post: { workspaceId: 'w', media: [] }, target: { id: 'target-a', workspaceId: 'w', providerId: 'pa' } }]);
  state.freshPostTarget.mockImplementation(async () => { state.events.push('recheck'); return { remotePostId: 'remote1', target: { workspaceId: 'w', enabled: true, providerId: 'pa', accessToken: null, socialAccount: grants } }; });
  state.status.mockResolvedValue({ state: 'published', publishedAt: new Date('2026-10-16T00:00:00Z') });
  state.updateMany.mockResolvedValue({ count: 1 });
});

describe('Page analytics fetch-then-write', () => {
  it('calls insights and post history outside any transaction, then writes in one short transaction', async () => {
    const result = await syncPageAnalytics();

    expect(result).toMatchObject({ examined: 1, updated: 2, failed: 0 });
    expect(state.providerDepths).toEqual([0, 0]);
    const events = state.events;
    expect(events.indexOf('provider:history')).toBeLessThan(events.indexOf('lock:begin'));
    expect(events.slice(0, events.indexOf('provider:insights'))).toContain('workspace:end'); // only the empty admission check precedes provider IO
    expect(state.insightUpsert).toHaveBeenCalledTimes(1);
    expect(state.executeRaw).toHaveBeenCalledTimes(2); // post upsert + cursor commit
  });

  it('writes nothing when the binding disappears while Facebook was being read', async () => {
    let reads = 0;
    state.freshTarget.mockImplementation(async () => (++reads <= 2 ? pageBinding : null));

    expect(await syncPageAnalytics()).toMatchObject({ updated: 0, skipped: 1, failed: 0 });
    expect(state.insightUpsert).not.toHaveBeenCalled();
    expect(state.executeRaw).not.toHaveBeenCalled();
  });

  it('keeps insights when post history fails and does not commit a cursor', async () => {
    state.history.mockRejectedValue(new Error('history refused'));

    const result = await syncPageAnalytics();

    expect(result).toMatchObject({ updated: 1, failed: 1 });
    expect(state.insightUpsert).toHaveBeenCalledTimes(1);
    expect(state.executeRaw).not.toHaveBeenCalled();
  });

  it('does not overwrite a history cursor another run advanced during the provider read', async () => {
    state.cursorRows.mockResolvedValueOnce([]).mockResolvedValueOnce([{ cursor: { ...progress, after: 'newer' } }]);

    const result = await syncPageAnalytics();

    expect(result).toMatchObject({ updated: 1, failed: 0 });
    expect(state.executeRaw).not.toHaveBeenCalled();
    expect(state.insightUpsert).toHaveBeenCalledTimes(1);
  });
});

describe('Ads analytics fetch-then-write', () => {
  it('calls the Ads API outside any transaction and re-checks the account before writing', async () => {
    const result = await syncAdsAnalytics();

    expect(result).toMatchObject({ examined: 1, updated: 1, failed: 0 });
    expect(state.providerDepths).toEqual([0]);
    const events = state.events;
    expect(events.indexOf('provider:ads')).toBeLessThan(events.indexOf('lock:begin'));
    expect(events.slice(events.indexOf('lock:begin'), events.indexOf('lock:end')).filter(event => event === 'recheck')).toHaveLength(2);
  });

  it('writes nothing when the account is deselected during the provider read', async () => {
    let reads = 0;
    state.freshAccount.mockImplementation(async () => (++reads <= 1 ? { actId: 'act_1', socialAccount: grants } : null));

    expect(await syncAdsAnalytics()).toMatchObject({ updated: 0, skipped: 1, failed: 0 });
    expect(state.adUpsert).not.toHaveBeenCalled();
  });
});

describe('Scheduled post status fetch-then-write', () => {
  it('reads Facebook status outside any transaction before the guarded update', async () => {
    const result = await syncScheduledPostStatus();

    expect(result).toMatchObject({ examined: 1, updated: 1, failed: 0 });
    expect(state.providerDepths).toEqual([0]);
    expect(state.events.indexOf('provider:status')).toBeLessThan(state.events.indexOf('lock:begin'));
    expect(state.updateMany).toHaveBeenCalledTimes(1);
  });

  it('skips the write when the provider post is not yet published', async () => {
    state.status.mockResolvedValue({ state: 'scheduled' });

    expect(await syncScheduledPostStatus()).toMatchObject({ updated: 0, skipped: 1 });
    expect(state.events).not.toContain('lock:begin');
    expect(state.updateMany).not.toHaveBeenCalled();
  });
});
