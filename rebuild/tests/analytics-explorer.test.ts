import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const state = vi.hoisted(() => ({ read: vi.fn(), config: vi.fn(), viewer: vi.fn() }));
vi.mock('../src/modules/analytics/server/read', () => ({ readAnalyticsSnapshot: state.read }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/server/PageFrame', () => ({ PageFrame: ({ sidebar, children }: { sidebar: import('react').ReactNode; children: import('react').ReactNode }) => createElement('main', null, createElement('aside', null, sidebar), children) }));
vi.mock('../src/server/entitlements', () => ({ canUseFeature: (_entitlements: unknown, feature: string) => feature === 'analytics/reports' }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: (_permissions: unknown, feature: string) => feature === 'analytics/reports' }));

import { readAnalyticsExplorer } from '../src/modules/analytics/server/explorer';
import { executeAnalyticsExplorerTool, analyticsExplorerToolDefinitions } from '../src/modules/analytics/explorer-mcp';
import { GET } from '../src/app/api/analytics/explorer/route';
import AnalyticsExplorerPage from '../src/modules/analytics/ui/explorer/ExplorerScreen';
import type { AnalyticsSnapshot } from '../src/modules/analytics/server/types';

const metric = (key: string, label: string, sourceLabel: string, kind: 'flow' | 'stock' = 'flow') => ({
  key, label, sourceLabel, resourceKind: 'channel' as const, aggregationLabel: kind === 'flow' ? 'Period total' : 'Latest value per resource',
  aggregationNote: 'Missing measures are unknown.', unit: 'count' as const, kind, total: 8, latestAt: new Date('2026-10-16T00:00:00Z'), coverage: 1, available: 2,
  points: [{ date: '2026-10-16', label: 'Oct 16', value: 8 }, { date: '2026-10-15', label: 'Oct 15', value: 2 }], rows: [{ label: 'Channel A', value: 8, asOf: new Date('2026-10-16T00:00:00Z') }],
});
const snapshot = (): AnalyticsSnapshot => ({
  period: { start: '2026-10-10', end: '2026-10-16', range: { from: new Date('2026-10-10T00:00:00Z'), to: new Date('2026-10-16T23:59:59.999Z') }, comparison: null },
  options: { channels: [{ id: 'channel-a', name: 'Channel A', type: 'page' }], adAccounts: [], metrics: [metric('reach', 'Reach', 'Community'), metric('views', 'Views', 'Community'), metric('likes', 'Likes', 'Content')].map(({ key, label, sourceLabel }) => ({ key, label, sourceLabel })) },
  selected: { channelIds: ['channel-a'], adAccountIds: [] }, audience: { entries: [], total: 0, covered: 0, selected: 1 }, publishing: { published: 0, scheduled: 0, failed: 0 }, comparisons: {}, previousPoints: {}, query: 'start=2026-10-10&end=2026-10-16&filter=1&channel=channel-a', chartPoints: 25, searchMaxLength: 200, exportRowLimit: 1000,
  allMetrics: [metric('reach', 'Reach', 'Community'), metric('views', 'Views', 'Community', 'stock'), metric('likes', 'Likes', 'Content')],
});
const actor = { userId: 'reader-a', workspaceId: 'workspace-a' };
beforeEach(() => {
  vi.clearAllMocks(); state.read.mockResolvedValue(snapshot());
  state.config.mockImplementation(async (key: string) => ({ 'analytics.explorerSearchMaxCharacters': 500, 'analytics.searchMaxLength': 200, 'analytics.explorerPageSize': 1, 'analytics.detailPageSize': 1 }[key]));
  state.viewer.mockResolvedValue({ user: { id: actor.userId }, workspaceId: actor.workspaceId, permissions: { pageScope: { all: false, ids: ['channel-a'] } } });
});

describe('Analytics Explorer', () => {
  it('filters by exact provenance and metric kind, then paginates both metrics and detail rows', async () => {
    const result = await readAnalyticsExplorer(actor, { start: '2026-10-10', end: '2026-10-16', filter: '1', channel: 'channel-a', source: 'Community', kind: 'flow', page: '2', metric: 'reach', pointPage: '2', rowPage: '1' }, { allowedChannelIds: ['channel-a'], feature: 'analytics/explorer' });
    expect(state.read).toHaveBeenCalledWith(actor, expect.objectContaining({ start: '2026-10-10', channel: 'channel-a' }), { allowedChannelIds: ['channel-a'], feature: 'analytics/explorer' });
    expect(result.metrics).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(result.detail?.metric).toMatchObject({ key: 'reach', sourceLabel: 'Community', aggregationNote: 'Missing measures are unknown.' });
    expect(result.detail?.points).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(result.query).toContain('source=Community');
    expect(result.query).toContain('kind=flow');
  });

  it('rejects duplicate or invalid filters and returns to the list when active filters exclude the selected metric', async () => {
    await expect(readAnalyticsExplorer(actor, { filter: '1', channel: ['channel-a', 'channel-a'] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readAnalyticsExplorer(actor, { metric: '', source: '', kind: 'all' })).resolves.toMatchObject({ detail: null });
    await expect(readAnalyticsExplorer(actor, { unknown: 'ignored' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readAnalyticsExplorer(actor, { source: 'Content', kind: 'flow', metric: 'reach' })).resolves.toMatchObject({ detail: null, metrics: { total: 1 }, filters: { source: 'Content', kind: 'flow' } });
  });

  it('exposes an authorized read-only MCP tool with strict inputs', async () => {
    expect(analyticsExplorerToolDefinitions[0]?.name).toBe('get_analytics_explorer');
    await expect(executeAnalyticsExplorerTool(actor, { source: 'Community', kind: 'flow' }, { feature: 'analytics/explorer' })).resolves.toMatchObject({ filters: { source: 'Community', kind: 'flow' } });
    await expect(executeAnalyticsExplorerTool(actor, { confirmation: 'WRITE' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('serves a channel-scoped no-store API response and masks viewer failures', async () => {
    const response = await GET(new Request('http://local/api/analytics/explorer?source=Community&kind=flow'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.read).toHaveBeenCalledWith(actor, { search: '' }, { allowedChannelIds: ['channel-a'], feature: 'analytics/explorer' });
    state.viewer.mockRejectedValueOnce(new Error('private session detail'));
    const denied = await GET(new Request('http://local/api/analytics/explorer'));
    expect(denied.status).toBe(401); expect(await denied.json()).toEqual({ error: 'Sign in to an authorized workspace.', code: 'unauthorized' });
  });

  it('renders source/type/resource filters in the sidebar and emits a permission-gated export link', async () => {
    state.viewer.mockResolvedValueOnce({ user: { id: actor.userId }, workspaceId: actor.workspaceId, permissions: { pageScope: { all: false, ids: ['channel-a'] } }, entitlements: {} });
    const tree = await AnalyticsExplorerPage({ searchParams: Promise.resolve({ source: 'Community', kind: 'flow', filter: '1', channel: 'channel-a' }) });
    const html = renderToStaticMarkup(tree);
    const sidebar = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
    expect(sidebar).toContain('name="source"'); expect(sidebar).toContain('name="kind"'); expect(sidebar).toContain('name="channel"');
    expect(sidebar).toContain('/api/reports/export');
    expect(html).toContain('Explore stored metrics');
    expect(html).toContain('Reach');
  });
});
