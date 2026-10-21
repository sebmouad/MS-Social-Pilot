import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ settings: vi.fn(), targets: vi.fn(), adAccounts: vi.fn(), pageInsights: vi.fn(), adInsights: vi.fn(), query: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: {
  appSetting: { findMany: db.settings }, target: { findMany: db.targets }, adAccount: { findMany: db.adAccounts },
  pageInsight: { findMany: db.pageInsights }, adInsight: { findMany: db.adInsights }, $queryRaw: db.query,
} }));
vi.mock('@/modules/analytics/server/error-copy', () => ({ analyticsLanguage: async () => 'en' }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async () => ({}), runtimeConfigBatch: async () => ({}) }));

import { facebookAnalyticsHost, facebookIdentifierField, normalizeFacebookAnalytics } from '../src/platforms/facebook/analytics';

const account = { id: 'ad-a', name: 'Ad account A', currency: 'USD' };
const adRow = (fields: unknown) => ({ date: new Date('2026-10-10'), spend: 5, impressions: 100, clicks: 4, reach: 80, cpc: 1.25, cpm: 50, cpp: 0.06, ctr: 4, frequency: 1.25, actions: [], fields, fetchedAt: new Date('2026-10-11'), adAccount: account });
const target = { id: 'page-a', name: 'Page A' };
const pageRow = { metric: 'page_media_view', period: 'day', endTime: new Date('2026-10-10'), fetchedAt: new Date('2026-10-11'), numeric: 12, value: 12, target };

describe('ad insight identifiers are never metrics', () => {
  it('drops account, campaign, name, currency and date-window fields but keeps numeric measures', () => {
    const { metrics } = normalizeFacebookAnalytics({ pageRows: [], audienceRows: [], selectedTargets: [], selectedAdAccounts: [account], adRows: [adRow({
      account_id: '159977536979568', account_name: 'Ad account A', account_currency: 'USD', campaign_id: '120000000000001', adset_id: '5', date_start: '2026-10-10', date_stop: '2026-10-10',
      inline_link_clicks: '7', outbound_clicks: [{ action_type: 'link_click', value: '3' }],
    })] });
    const keys = metrics.map(metric => metric.key);
    expect(keys).toEqual(expect.arrayContaining(['inline_link_clicks', 'outbound_clicks:link_click']));
    for (const key of keys) expect(key).not.toMatch(/account_id|account_name|campaign_id|adset_id|date_start|date_stop|account_currency/);
    expect(metrics.some(metric => /Account Id/i.test(metric.label))).toBe(false);
  });
  it('recognises identifier shapes without catching measures', () => {
    for (const key of ['account_id', 'campaign_id', 'actions:account_id', 'account_name', 'date_start', 'date_stop', 'account_currency']) expect(facebookIdentifierField(key), key).toBe(true);
    for (const key of ['reach', 'paid_views', 'inline_link_clicks', 'cost_per_inline_link_click', 'video_p25_watched_actions:video_view']) expect(facebookIdentifierField(key), key).toBe(false);
  });
});

describe('page metrics are emitted alongside ad metrics', () => {
  it('returns Facebook Page and Advertising metrics from one normalization', () => {
    const { metrics } = normalizeFacebookAnalytics({ pageRows: [pageRow], audienceRows: [], selectedTargets: [{ ...target, type: 'page', providerId: 'facebook', socialAccountId: 's' } as never], selectedAdAccounts: [account], adRows: [adRow({})] });
    expect(metrics.some(metric => metric.key.startsWith('page_media_view'))).toBe(true);
    expect(metrics.some(metric => metric.sourceLabel === 'Advertising')).toBe(true);
  });
});

describe('Facebook analytics targets report the platform id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.settings.mockResolvedValue([]); db.adAccounts.mockResolvedValue([]); db.pageInsights.mockResolvedValue([]); db.adInsights.mockResolvedValue([]); db.query.mockResolvedValue([]);
    db.targets.mockResolvedValue([{ id: 'page-a', name: 'Page A', type: 'page', providerId: '1029384756', socialAccountId: 'src' }]);
  });
  it('maps providerId to "facebook", never the remote Page id, for visible and selected targets', async () => {
    const result = await facebookAnalyticsHost.load({ workspaceId: 'w', range: { from: new Date('2026-10-01'), to: new Date('2026-10-31') }, selectedTargetIds: ['page-a'] });
    expect(result.targets).toEqual([{ id: 'page-a', name: 'Page A', type: 'page', providerId: 'facebook' }]);
    expect(result.selectedTargets.map(t => t.providerId)).toEqual(['facebook']);
    expect(JSON.stringify(result)).not.toContain('1029384756');
  });
});

describe('app-published posts read insights from the matching external post', () => {
  const request = { workspaceId: 'w', targetId: 't', from: new Date('2026-10-01'), to: new Date('2026-11-01'), limit: 10 };
  it('joins external_posts on target and remote id, preferring its snapshot only when the post target has none', async () => {
    db.query.mockResolvedValue([]);
    await facebookAnalyticsHost.postPerformance(request);
    const query = db.query.mock.calls.at(-1)![0] as { text: string; values: unknown[] };
    expect(query.text).toMatch(/LEFT JOIN external_posts ep ON ep\."targetId" = pt\."targetId" AND ep\."remoteId" = pt\."remotePostId"/);
    expect(query.text).toMatch(/CASE WHEN pt\."insightsSyncedAt" IS NULL AND ep\."insightsSyncedAt" IS NOT NULL THEN ep\.insights ELSE pt\.insights END/);
    expect(query.text).toMatch(/COALESCE\(pt\."insightsSyncedAt", ep\."insightsSyncedAt"\)/);
    expect(query.text).toMatch(/COALESCE\(pt\."remoteUrl", ep\.permalink\)/);
    expect(query.values).toEqual(expect.arrayContaining(['w', 't']));
  });
  it('maps the snapshot the query returns for such a row into measures', async () => {
    db.query.mockResolvedValue([{ postId: 'p1', message: 'Hi', publishedAt: new Date('2026-10-05'), remoteUrl: 'https://facebook.com/x', insights: { reach: 40, reactions: 3 }, insightsSyncedAt: new Date('2026-10-06') }]);
    const rows = await facebookAnalyticsHost.postPerformance(request);
    expect(rows[0]!.measures.find(m => m.key === 'reach')?.value).toBe(40);
    expect(rows[0]!.rankValue).toBe(3);
    expect(rows[0]!.measuredAt).toEqual(new Date('2026-10-06'));
  });
});
