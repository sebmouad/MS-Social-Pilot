import { describe, expect, it, vi } from 'vitest';
vi.mock('@/server/data', () => ({ prisma: {} }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: vi.fn(), runtimeConfigBatch: vi.fn() }));
vi.mock('@/modules/analytics/server/error-copy', () => ({ analyticsLanguage: async () => 'en' }));
import { buildAnalytics } from '@/modules/analytics/server/aggregate';
import type { AnalyticsMetricInput } from '@/modules/analytics/server/catalog';
import { normalizeFacebookAnalytics } from '@/platforms/facebook/analytics';
import { analyticsDateRange } from '@/modules/analytics/server/comparison';
import { periodTotals, engagementHeatmap } from '@/modules/home/server/overview-pure';
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const targets = Array.from({ length: 10 }, (_, i) => ({ id: `page-${i}`, name: `Example Page ${i}`, type: 'page', providerId: 'facebook', socialAccountId: 'connection' }));
const metric = (overrides: Partial<AnalyticsMetricInput>): AnalyticsMetricInput => ({ key: 'measure', label: 'Measure', sourceLabel: 'Community', kind: 'stock', unit: 'count', observations: [], available: 10, ...overrides });
const posts = targets.flatMap((target, i) => [1, 2].map(n => ({ target, createdTime: date(`2026-10-${14 + n}`), insightsSyncedAt: date('2026-10-17'), insights: {
  post_media_view: (i + 1) * n * 100, post_total_media_view_unique: (i + 1) * n * 80,
  reactions: (i + 1) * n, comments: n, clicks: 2 * n,
  post_reactions_by_type_total: { like: (i + 1) * n },
} })));

describe('ten-Page production-shaped numeric evidence', () => {
  it('keeps unavailable stock and overlapping-window series unknown; preserves measured zero', () => {
    const result = buildAnalytics([
      metric({ key: 'audience' }), metric({ key: 'weekly', kind: 'flow', rollup: 'latest-per-channel' }),
      metric({ key: 'zero', observations: [{ channelId: 'page-0', channelLabel: 'Example', date: date('2026-10-16'), value: 0 }] }),
    ], [], 10);
    expect(result.metrics.find(m => m.key === 'audience')).toMatchObject({ total: null, coverage: 0, available: 10, points: [] });
    expect(result.metrics.find(m => m.key === 'weekly')?.total).toBeNull();
    expect(result.metrics.find(m => m.key === 'zero')).toMatchObject({ total: 0, coverage: 1 });
  });
  it.each(['stock', 'flow'] as const)('uses latest per-resource snapshots in daily %s charts for latest-per-channel rollup', kind => {
    const [result] = buildAnalytics([metric({ kind, ...(kind === 'flow' ? { rollup: 'latest-per-channel' as const } : {}), observations: [
      { channelId: 'page-0', channelLabel: 'A', date: new Date('2026-10-16T20:00:00Z'), value: 120 },
      { channelId: 'page-0', channelLabel: 'A', date: new Date('2026-10-16T01:00:00Z'), value: 100 },
      { channelId: 'page-1', channelLabel: 'B', date: date('2026-10-16'), value: 30 },
    ] })], [], 10).metrics;
    expect(result).toMatchObject({ total: 150, coverage: 2, points: [{ date: '2026-10-16', value: 150 }] });
  });
  it('adds every numeric post measure once with sparse Page insights and retains overlap disclosure', () => {
    const normalized = normalizeFacebookAnalytics({ pageRows: [], audienceRows: [], adRows: [], postRows: posts, selectedTargets: targets, selectedAdAccounts: [] });
    const result = buildAnalytics(normalized.metrics, normalized.audienceEntries, normalized.audienceSelected);
    for (const [key, total] of Object.entries({ post_media_view: 16500, post_total_media_view_unique: 13200, reactions: 165, comments: 30, clicks: 60 })) {
      const found = result.metrics.find(m => m.key === `post:${key}`)!;
      expect(found, key).toMatchObject({ total, coverage: 10, available: 10 });
      expect(found.points.reduce((sum, point) => sum + point.value, 0)).toBe(total);
      expect(found.rows.reduce((sum, row) => sum + row.value, 0)).toBe(total);
    }
    expect(result.metrics.find(m => m.key === 'post:post_total_media_view_unique')?.aggregationNote).toMatch(/overlap/);
    expect(result.audience).toMatchObject({ total: 0, covered: 0, selected: 10 });
  });
  it('uses latest audience per Page, includes real zero and discloses missing Pages', () => {
    const audienceRows = targets.slice(0, 8).flatMap((target, i) => [
      { target, metric: 'page_follows', period: 'day', endTime: date('2026-10-15'), fetchedAt: date('2026-10-17'), numeric: 999, value: 999 },
      { target, metric: 'page_follows', period: 'day', endTime: date('2026-10-16'), fetchedAt: date('2026-10-17'), numeric: i * 100, value: i * 100 },
    ]);
    const normalized = normalizeFacebookAnalytics({ pageRows: audienceRows, audienceRows, adRows: [], selectedTargets: targets, selectedAdAccounts: [], audienceAsOf: date('2026-10-16') });
    const result = buildAnalytics(normalized.metrics, normalized.audienceEntries, normalized.audienceSelected);
    expect(result.audience).toMatchObject({ total: 2800, covered: 8, selected: 10 });
    expect(result.metrics[0]).toMatchObject({ total: 2800, coverage: 8, available: 10 });
  });
  it('Home compares matched sums and weights heatmap channels equally in the workspace timezone', () => {
    expect(periodTotals(targets.map((_, i) => ({ current: i < 8 ? (i + 1) * 100 : null, previous: i < 6 ? (i + 1) * 80 : null }))))
      .toEqual({ current: 3600, previous: 1680, change: 0.25, covered: 8, comparable: 6 });
    const heatmap = engagementHeatmap(targets.map((_, i) => [
      { postId: 'first', publishedAt: new Date('2026-10-19T23:30:00Z'), rankValue: (i + 1) * 2 },
      { postId: 'second', publishedAt: new Date('2026-10-21T11:00:00Z'), rankValue: i + 1 },
      { postId: 'third', publishedAt: new Date('2026-10-22T11:00:00Z'), rankValue: i + 1 },
    ]), 'Africa/Casablanca', 10);
    expect(heatmap.measuredPosts).toBe(30);
    expect(heatmap.cells.find(cell => cell.day === 2 && cell.hour === 0)).toMatchObject({ value: 2, posts: 10 });
  });
  it('uses UTC calendar bounds and disjoint comparison periods', () => {
    const result = analyticsDateRange({ start: '2026-10-01', end: '2026-10-21', compare: 'previous' }, { defaultDays: 28, maxDays: 90 });
    expect(result.range).toEqual({ from: date('2026-10-01'), to: new Date('2026-10-21T23:59:59.999Z') });
    expect(result.comparison).toMatchObject({ start: '2026-09-10', end: '2026-09-30' });
    expect(result.comparison!.range.to.getTime() + 1).toBe(result.range.from.getTime());
  });
});


it('Analytics keeps all Ads totals and weighted ratios with latest-day non-additive reach', () => {
  const account = { id: 'usd', name: 'Example USD account', currency: 'USD' };
  const adRows = [
    { date: date('2026-10-15'), spend: 10.25, impressions: 100, clicks: 1, reach: 80 },
    { date: date('2026-10-16'), spend: 20.75, impressions: 900, clicks: 99, reach: 600 },
  ].map(row => ({ ...row, adAccount: account, fetchedAt: date('2026-10-17'), cpc: 999, cpm: 999, ctr: 999, cpp: 999, frequency: 999,
    actions: [{ action_type: 'link_click', value: String(row.clicks) }], fields: { spend: String(row.spend), account_id: '123456789', account_currency: 'USD' } }));
  const normalized = normalizeFacebookAnalytics({ pageRows: [], audienceRows: [], adRows, selectedTargets: [], selectedAdAccounts: [account] });
  const result = buildAnalytics(normalized.metrics, [], 0);
  const expected = { 'spend::USD': 31, impressions: 1000, clicks: 100, reach: 600,
    'cpc::USD': 0.31, 'cpm::USD': 31, ctr: 10, 'cpp::USD': 20.75 / 600, frequency: 1.5, 'actions:link_click': 100 };
  for (const [key, total] of Object.entries(expected)) {
    const found = result.metrics.find(m => m.key === key);
    expect(found, key).toBeDefined();
    expect(found!.total, key).toBeCloseTo(total);
    expect(found!.rows[0].value, key).toBeCloseTo(total);
  }
  expect(result.metrics.find(m => m.key === 'frequency')?.aggregationNote).toMatch(/latest stored day/);
  expect(result.metrics.find(m => m.key === 'spend::USD')?.points.map(p => p.date)).toEqual(['2026-10-15', '2026-10-16']);
  expect(result.metrics.some(m => m.key.includes('account_id'))).toBe(false);
});
