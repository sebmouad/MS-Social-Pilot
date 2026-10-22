import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  viewer: vi.fn(), snapshot: vi.fn(), pins: vi.fn(), goals: vi.fn(), posts: vi.fn(), notes: vi.fn(), scope: vi.fn(), use: vi.fn(), access: vi.fn(), config: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/insights', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': 'en' }) }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: state.config, runtimeConfigBatch: async () => ({}) }));
vi.mock('@/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('@/server/PageFrame', () => ({ PageFrame: ({ children, scopedAccess }: { children: import('react').ReactNode; scopedAccess?: boolean }) => createElement('main', { 'data-scoped-access': scopedAccess ? 'true' : 'false' }, children) }));
vi.mock('@/server/entitlements', () => ({ canUseFeature: state.use }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: state.access }));
vi.mock('@/modules/shell/server/scope', () => ({ pageChannelScope: state.scope }));
vi.mock('@/modules/analytics/server/read', () => ({ readAnalyticsSnapshot: state.snapshot }));
vi.mock('@/modules/analytics/pins/server/pins', () => ({ readPinnedMetrics: state.pins }));
vi.mock('@/modules/analytics/goals/server/goals', () => ({ readGoals: state.goals }));
vi.mock('@/modules/analytics/explorer-posts/service', () => ({ readPosts: state.posts }));
vi.mock('@/modules/calendar-extras/server/chart-notes', () => ({ loadChartAnnotations: state.notes }));
vi.mock('@/modules/analytics/ui/insights/OverviewInsights', () => ({ OverviewInsights: () => null }));

import AnalyticsPage from '../src/modules/analytics/ui/AnalyticsScreen';
import { chartMetrics, headlineTiles, pickMetric, rankPosts } from '../src/modules/analytics/ui/insights/overview-model';
import { insightsPolicyDefaults, insightsCopyDefaults, resolveInsightsCopy, insightsPolicySchema, insightsCopySchema } from '../src/modules/analytics/ui/insights/insights-config';
import { presetRange, resolvePeriod } from '../src/modules/analytics/ui/insights/period';
import { insightsReadInput, withParams } from '../src/modules/analytics/ui/insights/scope';
import type { MetricView } from '../src/modules/analytics/server/aggregate';
import type { AnalyticsSnapshot } from '../src/modules/analytics/server/types';

const metric = (key: string, label: string, over: Partial<MetricView> = {}): MetricView => ({
  key, label, sourceLabel: 'Example channel', resourceKind: 'channel', aggregationLabel: 'Total over the selected period', aggregationNote: 'Counts may overlap across resources.',
  unit: 'count', kind: 'flow', total: 120, latestAt: new Date('2026-10-16T00:00:00Z'), updatedAt: new Date('2026-10-16T02:00:00Z'), coverage: 2, available: 2,
  points: [{ date: '2026-10-14', label: 'Oct 14', value: 40 }, { date: '2026-10-15', label: 'Oct 15', value: 50 }, { date: '2026-10-16', label: 'Oct 16', value: 30 }], rows: [], ...over,
});
const snapshot = (over: Partial<AnalyticsSnapshot> = {}): AnalyticsSnapshot => ({
  period: { start: '2026-10-10', end: '2026-10-16', range: { from: new Date('2026-10-10T00:00:00Z'), to: new Date('2026-10-16T23:59:59Z') }, comparison: null },
  options: { channels: [{ id: 'a', name: 'Alpha', type: 'page' } as never, { id: 'b', name: 'Beta', type: 'page' } as never], adAccounts: [], metrics: [] },
  selected: { channelIds: ['a', 'b'], adAccountIds: [] },
  audience: { entries: [{ id: 'a', name: 'Alpha', metricLabel: 'Followers', value: 9000, asOf: new Date('2026-10-16T00:00:00Z'), fetchedAt: new Date('2026-10-16T01:00:00Z') } as never], total: 9000, covered: 1, selected: 2 },
  publishing: { published: 7, scheduled: 3, failed: 1 }, comparisons: { views: { previous: 100, delta: 20, percent: 20, status: 'comparable' } }, previousPoints: {},
  query: '', chartPoints: 28, searchMaxLength: 200, exportRowLimit: 1000,
  allMetrics: [metric('views', 'Page views'), metric('eng', 'Engagements', { coverage: 1 }), metric('clicks', 'Link clicks'), metric('paid', 'Spend', { resourceKind: 'ad-account' })], ...over,
});
const post = (id: string, views: number | null, name = 'Alpha') => ({
  postId: id, channelId: 'a', channelName: name, text: `Post ${id}`, url: `https://example.test/${id}`, publishedAt: new Date('2026-10-15T08:00:00Z'), measuredAt: null, rankValue: null, rankLabel: '',
  measures: [{ key: 'v', label: 'Views', value: views }, { key: 'e', label: 'Engagements', value: 1 }],
});

beforeEach(() => {
  vi.clearAllMocks();
  state.config.mockResolvedValue(undefined);
  state.viewer.mockResolvedValue({ user: { id: 'reader' }, workspaceId: 'workspace', permissions: { pageScope: { all: false, ids: ['a', 'b'] } }, entitlements: {} });
  state.scope.mockResolvedValue({ ids: [], dropped: 0, source: 'none', channels: [] });
  state.use.mockReturnValue(true); state.access.mockReturnValue(true);
  state.snapshot.mockResolvedValue(snapshot());
  state.pins.mockResolvedValue({ pins: [] });
  state.goals.mockResolvedValue({ channels: [] });
  state.posts.mockResolvedValue({ items: [] });
  state.notes.mockResolvedValue(null);
});
const render = async (params: Record<string, string | string[] | undefined> = {}) => renderToStaticMarkup(await AnalyticsPage({ searchParams: Promise.resolve(params) }));

describe('Insights › Overview', () => {
  it('shows the four key numbers first, each with an info button, and no paid metric', async () => {
    const html = await render();
    expect(state.viewer).toHaveBeenCalledWith({ feature: 'analytics/overview', channelScoped: true });
    expect(html).toContain('data-scoped-access="true"');
    for (const label of ['Audience', 'Views', 'Engagements', 'Link clicks']) expect(html).toContain(`>${label}</h3>`);
    expect(html).not.toContain('>Spend</h3>');
    expect(html.match(/ui-infotip__trigger/g)!.length).toBeGreaterThanOrEqual(4);
    // 9,000 is the sum of the one channel with an audience; the info says 1 of 2 channels, so it is flagged partial.
    expect(html).toContain('9,000');
    expect(html).toContain('is-warning');
    expect(html).toContain('+20%');
  });

  it('leaves out a number no stored metric supports instead of showing zero', async () => {
    state.snapshot.mockResolvedValue(snapshot({ allMetrics: [metric('views', 'Page views')] }));
    const html = await render();
    expect(html).toContain('>Views</h3>');
    expect(html).not.toContain('>Link clicks</h3>');
    expect(html).not.toContain('>Engagements</h3>');
  });

  it('marks an audience with no stored count as unknown', async () => {
    state.snapshot.mockResolvedValue(snapshot({ audience: { entries: [], total: 0, covered: 0, selected: 2 } }));
    const html = await render();
    expect(html).toContain('No data for this selection yet');
  });

  it('reads the channels chosen in the sidebar with the default period, never the page-owned names', async () => {
    state.scope.mockResolvedValue({ ids: ['a'], dropped: 0, source: 'url', channels: [] });
    await render({ channel: 'a', filter: '1', period: '7', compare: 'previous' });
    const input = state.snapshot.mock.calls[0]![1] as Record<string, unknown>;
    expect(input).toMatchObject({ filter: '1', channel: ['a'], compare: 'previous' });
    expect(input.period).toBeUndefined();
    expect(String(input.start)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const days = (Date.parse(`${input.end}T00:00:00Z`) - Date.parse(`${input.start}T00:00:00Z`)) / 86_400_000 + 1;
    expect(days).toBe(7);
    expect(state.snapshot.mock.calls[0]![2]).toEqual({ allowedChannelIds: ['a', 'b'], feature: 'analytics/overview' });
  });

  it('draws the main chart with a metric switcher, and the Top posts ranked by the policy words', async () => {
    state.posts.mockResolvedValue({ items: [post('1', 10), post('2', 90), post('3', null)] });
    const html = await render();
    expect(html).toContain('insights-switch');
    expect(html).toContain('Show data');
    const first = html.indexOf('Post 2'); const second = html.indexOf('Post 1');
    expect(first).toBeGreaterThan(-1); expect(second).toBeGreaterThan(first);
    expect(html).toContain('href="https://example.test/2"');
    expect(state.posts).toHaveBeenCalledWith({ userId: 'reader', workspaceId: 'workspace' }, expect.objectContaining({ filter: '1', channel: ['a', 'b'] }), insightsPolicyDefaults.topPostsPool);
  });

  it('links the publishing activity into Content with the same status filter', async () => {
    const html = await render();
    expect(html).toContain('href="/content?status=published"');
    expect(html).toContain('href="/content?status=scheduled"');
    expect(html).toContain('href="/content?status=failed"');
  });

  it('shows goal progress only when the month has goals, and a failing goal read hides just that card', async () => {
    state.goals.mockResolvedValue({ channels: [{ channelId: 'a', channelName: 'Alpha', goals: [{ metric: 'views', label: 'Views', percent: 64 }] }] });
    expect(await render()).toContain('Alpha · Views: 64%');
    state.goals.mockRejectedValue(new Error('private detail'));
    const html = await render();
    expect(html).not.toContain('Goals this month');
    expect(html).not.toContain('private detail');
    expect(html).toContain('>Views</h3>');
  });

  it('appends pinned metrics after the key numbers, up to the tile limit', async () => {
    state.pins.mockResolvedValue({ pins: [{ key: 'x', label: 'Saves', sourceLabel: 'Example channel', unit: 'count', kind: 'flow', resourceKind: 'channel', state: 'available', total: 12, coverage: 2, available: 2, latestAt: null, comparison: null }] });
    // Four key numbers show first; the pinned one waits behind "Show all 5" so the first screen stays calm.
    const html = await render();
    expect(html).not.toContain('>Saves</h3>');
    expect(html).toContain('Show all 5');
    const model = headlineTiles(snapshot(), insightsPolicyDefaults, { copy: resolveInsightsCopy(insightsCopyDefaults as never, 'en'), locale: 'en', period: { start: '2026-10-10', end: '2026-10-16' } });
    expect(model.tiles).toHaveLength(4);
  });

  it('does not read the post, pin or goal services for features the member lacks', async () => {
    state.use.mockImplementation((_entitlements: unknown, feature: string) => feature === 'analytics/overview');
    await render();
    expect(state.posts).not.toHaveBeenCalled(); expect(state.pins).not.toHaveBeenCalled(); expect(state.goals).not.toHaveBeenCalled();
  });

  it('masks a service failure and offers a retry', async () => {
    state.snapshot.mockRejectedValue(new Error('postgres://private-password'));
    const html = await render({ channel: 'a' });
    expect(html).toContain('Insights could not be loaded');
    expect(html).not.toContain('private-password');
    expect(html).toContain('Try again');
  });

  it('explains an empty workspace with a way to manage channels, only for members who can', async () => {
    state.snapshot.mockResolvedValue(snapshot({ options: { channels: [], adAccounts: [], metrics: [] }, selected: { channelIds: [], adAccountIds: [] } }));
    expect(await render()).toContain('href="/settings/channels"');
    state.use.mockImplementation((_entitlements: unknown, feature: string) => feature !== 'settings/connections');
    expect(await render()).not.toContain('href="/settings/channels"');
  });
});

describe('Insights models', () => {
  const copy = resolveInsightsCopy(insightsCopyDefaults as never, 'en');
  const context = { copy, locale: 'en' as const, period: { start: '2026-10-10', end: '2026-10-16' } };

  it('picks the first stored channel metric for each policy word and ignores paid and breakdown metrics', () => {
    const metrics = [metric('p', 'Spend views', { resourceKind: 'ad-account' }), metric('b', 'Views by country', { kind: 'breakdown' }), metric('v', 'Page views'), metric('i', 'Impressions')];
    expect(pickMetric(metrics, ['views', 'impressions'])?.key).toBe('v');
    expect(pickMetric(metrics, ['clicks'])).toBeUndefined();
    expect(pickMetric([metric('n', 'Views', { total: null })], ['views'])).toBeUndefined();
  });

  it('builds headline tiles in policy order and chart metrics from the headline first', () => {
    const base = snapshot();
    const { tiles, metrics } = headlineTiles(base, insightsPolicyDefaults, context);
    expect(tiles.map(tile => tile.id)).toEqual(['audience', 'views', 'engagements', 'clicks']);
    const chart = chartMetrics(base, metrics, insightsPolicyDefaults, { ...context, exploreHref: key => `/insights/explore?metric=${key}` });
    expect(chart.map(item => item.key).slice(0, 3)).toEqual(['views', 'eng', 'clicks']);
    expect(chart.every(item => item.exploreHref?.startsWith('/insights/explore'))).toBe(true);
    expect(chart.length).toBeLessThanOrEqual(insightsPolicyDefaults.chartMetricsMax);
  });

  it('ranks posts by the first measure matching a policy word and falls back to recency', () => {
    const ranked = rankPosts([post('1', 5), post('2', 50), post('3', 20)], ['views'], 2);
    expect(ranked.posts.map(item => item.postId)).toEqual(['2', '3']);
    expect(ranked.measureLabel).toBe('Views');
    const fallback = rankPosts([post('1', 5), post('2', 50)], ['nothing'], 5);
    expect(fallback.measureKey).toBeNull();
    expect(fallback.posts.map(item => item.postId)).toEqual(['1', '2']);
  });

  it('resolves the period from a preset, a typed range or the default, and keeps the compare switch', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    expect(resolvePeriod({ period: '7' }, insightsPolicyDefaults, now)).toEqual({ preset: '7', start: '2026-10-14', end: '2026-10-20', compare: 'none' });
    expect(resolvePeriod({ start: '2026-09-01', end: '2026-09-30', compare: 'previous' }, insightsPolicyDefaults, now)).toEqual({ preset: 'custom', start: '2026-09-01', end: '2026-09-30', compare: 'previous' });
    expect(resolvePeriod({ start: '2026-09-30', end: '2026-09-01' }, insightsPolicyDefaults, now).preset).toBe('28');
    expect(resolvePeriod({ period: 'month' }, insightsPolicyDefaults, now)).toMatchObject({ start: '2026-10-01', end: '2026-10-20' });
    expect(presetRange(insightsPolicyDefaults.rangePresets.find(item => item.id === 'last-month')!, now)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });

  it('turns the sidebar scope into the services’ channel filter and keeps other parameters', () => {
    expect(insightsReadInput({ channel: 'a,b', channelId: 'x', filter: '1', search: 'v' }, ['a', 'b'], { start: '2026-10-01' })).toEqual({ search: 'v', start: '2026-10-01', filter: '1', channel: ['a', 'b'] });
    expect(insightsReadInput({ channel: 'a', search: 'v' }, [])).toEqual({ search: 'v' });
    expect(withParams({ channel: 'a,b', metric: 'x', page: '3' }, { metric: 'y', page: null })).toBe('channel=a%2Cb&metric=y');
  });

  it('keeps the shipped copy and policy valid against their schemas, French included', () => {
    expect(insightsCopySchema.safeParse(insightsCopyDefaults).success).toBe(true);
    expect(insightsPolicySchema.safeParse(insightsPolicyDefaults).success).toBe(true);
    for (const [key, message] of Object.entries(insightsCopyDefaults)) { expect(message.en.length, key).toBeGreaterThan(0); expect(message.fr.length, key).toBeGreaterThan(0); }
    const edited = { ...insightsCopyDefaults, tilesShowAll: { en: 'Show all', fr: 'Tout' } };
    expect(insightsCopySchema.safeParse(edited).success).toBe(false);
    expect(insightsPolicySchema.safeParse({ ...insightsPolicyDefaults, rangePresets: [{ id: 'x', label: { en: 'x', fr: 'x' }, days: 5, span: 'month' }] }).success).toBe(false);
  });
});
