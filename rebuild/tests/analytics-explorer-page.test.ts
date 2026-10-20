import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ viewer: vi.fn(), read: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/modules/analytics/server/read', () => ({ readAnalytics: state.read }));
vi.mock('../src/server/PageFrame', () => ({ PageFrame: ({ sidebar, children, scopedAccess }: { sidebar: import('react').ReactNode; children: import('react').ReactNode; scopedAccess?: boolean }) => createElement('main', { 'data-scoped-access': scopedAccess }, createElement('aside', null, sidebar), children) }));
vi.mock('../src/server/entitlements', () => ({ canUseFeature: () => true }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: () => true }));

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': 'en' }) }));
vi.mock('@/modules/settings/channel-profiles/service', () => ({ readChannelProfiles: async () => ({ channels: [], groups: [] }) }));

import AnalyticsPage from '../src/modules/analytics/ui/AnalyticsScreen';
import type { AnalyticsReadResult } from '../src/modules/analytics/server/types';

const valueMetric = {
  key: 'spend-usd', label: 'Spend', sourceLabel: 'Example account', resourceKind: 'ad-account' as const,
  aggregationLabel: 'Total over the selected period', aggregationNote: 'Counts may overlap across resources. Sums are not deduplicated people or total reach for the whole period.', unit: 'currency' as const, kind: 'flow' as const,
  total: 125.5, displayTotal: 'USD 125.50', latestAt: new Date('2026-10-16T00:00:00Z'),
  updatedAt: new Date('2026-10-16T02:00:00Z'), coverage: 1, available: 1,
  points: [{ date: '2026-10-15', label: 'Oct 15', value: 50 }, { date: '2026-10-16', label: 'Oct 16', value: 75.5 }],
  rows: [{ label: 'Example account', value: 125.5, asOf: new Date('2026-10-16T00:00:00Z') }],
};

const base = (): AnalyticsReadResult => ({
  period: {
    start: '2026-10-10', end: '2026-10-16',
    range: { from: new Date('2026-10-10T00:00:00Z'), to: new Date('2026-10-16T23:59:59.999Z') },
    comparison: { mode: 'previous' as const, start: '2026-10-03', end: '2026-10-09', range: { from: new Date('2026-10-03T00:00:00Z'), to: new Date('2026-10-09T23:59:59.999Z') } },
  },
  options: {
    channels: [{ id: 'channel-a', name: 'Example channel', type: 'page' }],
    adAccounts: [{ id: 'account-a', name: 'Example account', currency: 'USD' }],
    metrics: [{ key: 'spend-usd', label: 'Spend', sourceLabel: 'Example account' }, { key: 'views', label: 'Views', sourceLabel: 'Example channel' }],
  },
  selected: { channelIds: [], adAccountIds: ['account-a'] },
  audience: { entries: [], total: 0, covered: 0, selected: 0 },
  publishing: { published: 0, scheduled: 0, failed: 0 },
  metrics: { items: [valueMetric], total: 2, page: 1, pages: 2, pageSize: 1 },
  detail: null,
  comparisons: { 'spend-usd': { previous: 100, delta: 25.5, percent: 25.5, status: 'comparable' as const } },
  query: 'start=2026-10-10&end=2026-10-16&compare=previous&filter=1&channel=channel-a&adFilter=1&adAccount=account-a&search=spend&page=1&pointPage=1&rowPage=1',
  chartPoints: 28,
  searchMaxLength: 200,
  exportRowLimit: 1000,
});

beforeEach(() => {
  vi.clearAllMocks();
  state.viewer.mockResolvedValue({
    user: { id: 'reader' }, workspaceId: 'workspace',
    permissions: { pageScope: { all: false, ids: ['channel-a'] } },
    entitlements: {},
  });
  state.read.mockResolvedValue(base());
});

const render = async (params: Record<string, string | string[] | undefined> = {}) =>
  renderToStaticMarkup(await AnalyticsPage({ searchParams: Promise.resolve(params) }));

const links = (html: string) => [...html.matchAll(/href="([^"]+)"/g)]
  .map(match => new URL(match[1].replaceAll('&amp;', '&'), 'http://preview.test'));

describe('Analytics explorer page', () => {
  it('uses the scoped reader and still shows selected ad metrics with no channels selected', async () => {
    const html = await render({ compare: 'previous', filter: '1', channel: [], adFilter: '1', adAccount: 'account-a' });

    expect(state.viewer).toHaveBeenCalledWith({ feature: 'analytics/overview', channelScoped: true });
    expect(state.read).toHaveBeenCalledWith(
      { userId: 'reader', workspaceId: 'workspace' },
      expect.objectContaining({ compare: 'previous', filter: '1', adFilter: '1', adAccount: 'account-a' }),
      { allowedChannelIds: ['channel-a'], feature: 'analytics/overview' },
    );
    expect(html).toContain('data-scoped-access="true"');
    expect(html).toContain('Spend');
    expect(html).toContain('Latest 2 of 2 stored dates shown');
    expect(html).toContain('Counts may overlap across resources');
    expect(html).not.toContain('Selected channel audience');
    expect(html).not.toContain('No channels selected');
    expect(html).toContain('Stored calendar dates (UTC)');
  });

  it('puts all resource, date, comparison, metric, search, and page controls in the sidebar and preserves the full query', async () => {
    const html = await render({ start: '2026-10-10', end: '2026-10-16', compare: 'previous', filter: '1', channel: 'channel-a', adFilter: '1', adAccount: 'account-a', search: 'spend', page: '1' });
    const sidebar = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
    expect(sidebar).toContain('name="start"');
    expect(sidebar).toContain('name="end"');
    expect(sidebar).toContain('name="compare"');
    expect(sidebar).toContain('name="channel"');
    expect(sidebar).toContain('name="adAccount"');
    expect(sidebar).toContain('name="search"');
    expect(sidebar).toContain('name="metric"');
    expect(sidebar).toContain('name="page"');
    expect(sidebar).toContain('Views');
    expect(sidebar).toContain('Export CSV');
    expect(sidebar).toContain('Exports include up to 1000 data rows');
    const exportLink = links(html).find(url => url.pathname === '/api/reports/export');
    expect(exportLink?.searchParams.get('adAccount')).toBe('account-a');
    expect(exportLink?.searchParams.get('search')).toBe('spend');
    expect(exportLink?.searchParams.has('page')).toBe(false);
    expect(html).not.toContain('View full series and resource details');
    expect(html.slice(html.indexOf('</aside>'))).not.toContain('href="/analytics?');

    const pageLink = links(html).find(url => url.searchParams.get('page') === '2');
    expect(pageLink?.searchParams.get('compare')).toBe('previous');
    expect(pageLink?.searchParams.get('channel')).toBe('channel-a');
    expect(pageLink?.searchParams.get('adAccount')).toBe('account-a');
    expect(pageLink?.searchParams.get('search')).toBe('spend');
  });

  it('renders paginated full metric details, keeps pagination context, and masks service failures', async () => {
    const result = base();
    result.detail = {
      metric: { ...valueMetric, points: [...valueMetric.points, { date: '2026-10-14', label: 'Oct 14', value: 1 }], rows: [...valueMetric.rows, { label: 'Older account', value: 1, asOf: null }] },
      points: { items: valueMetric.points, total: 31, page: 1, pages: 2, pageSize: 25 },
      rows: { items: valueMetric.rows, total: 31, page: 1, pages: 2, pageSize: 25 },
    };
    result.query = 'start=2026-10-10&end=2026-10-16&compare=previous&filter=1&channel=channel-a&adFilter=1&adAccount=account-a&search=spend&metric=spend-usd&pointPage=1&rowPage=1';
    state.read.mockResolvedValueOnce(result);
    const html = await render({ metric: 'spend-usd', pointPage: '1', rowPage: '1', search: 'spend', adFilter: '1', adAccount: 'account-a' });
    expect(html).toContain('Oct 15');
    expect(html).toContain('Full date and value series');
    expect(html).toContain('Counts may overlap across resources');
    expect(html).toContain('31 stored rows');
    const pointLink = links(html).find(url => url.searchParams.get('pointPage') === '2');
    expect(pointLink?.searchParams.get('metric')).toBe('spend-usd');
    expect(pointLink?.searchParams.get('rowPage')).toBe('1');
    expect(pointLink?.searchParams.get('adAccount')).toBe('account-a');
    const detailSidebar = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
    expect(detailSidebar).toContain('Back to all metric cards');
    expect(detailSidebar).not.toContain('Next metrics');
    expect(detailSidebar).not.toContain('Previous metrics');
    expect(detailSidebar).toContain('Next series');
    expect(detailSidebar).toContain('Next resources');
    expect(html.slice(html.indexOf('</aside>'))).not.toContain('href="/analytics?');

    state.read.mockRejectedValueOnce(new Error('postgres://private-password'));
    const failed = await render();
    expect(failed).toContain('Analytics could not be loaded');
    expect(failed).not.toContain('private-password');
    expect(failed).toContain('Try again with these filters');
    const failedSidebar = failed.slice(failed.indexOf('<aside'), failed.indexOf('</aside>'));
    expect(failedSidebar).toContain('Reset filters');
  });
});
