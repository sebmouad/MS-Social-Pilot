vi.mock('@/modules/ads/server/copy', async () => { const { defaultAdsCatalogs, customerText } = await import('../src/modules/ads/copy'); return { withAdsCopySnapshot: (operation: () => Promise<unknown>) => operation(), loadAdsCopy: async () => defaultAdsCatalogs, adsServiceText: async (key: Parameters<typeof customerText>[2]) => customerText(defaultAdsCatalogs.customer, 'en', key) }; });
// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const customPolicy = {
  presets: [{ id: '14d', days: 14, label: 'Last two weeks' }],
  defaultPreset: '14d', maxRangeDays: 14, maxFilterCharacters: 80,
};
const state = vi.hoisted(() => ({ accounts: vi.fn(), dataset: vi.fn(), viewer: vi.fn(), readiness: vi.fn(), canRead: vi.fn(), policy: vi.fn(), output: vi.fn(), feature: vi.fn(), access: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'accept-language': 'en' }) }));
vi.mock('@/modules/ads/management/server', () => ({ describeAdsManagement: async () => ({ canManage: false, operations: [] }) }));
vi.mock('@/modules/ads/server/object-store', () => ({ listStoredAdObjects: async () => [] }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/server/entitlements', () => ({ entitledPlatformIds: () => ['test-platform'], canUseFeature: state.feature }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: state.access }));
vi.mock('../src/server/PageFrame', () => ({ PageFrame: ({ children, sidebar }: { children: ReactNode; sidebar?: ReactNode }) => createElement('div', null, createElement('aside', null, sidebar), children) }));
vi.mock('@/modules/ads/server/queries', async original => ({ ...await original<typeof import('@/modules/ads/server/queries')>(), getAdsAccounts: state.accounts, getAdsDataset: state.dataset }));
vi.mock('@/modules/ads/server/actions', () => ({ canManageWorkspaceAds: state.readiness, canReadWorkspaceAds: state.canRead }));
vi.mock('../src/server/platforms/registry', () => ({ platformAds: async () => null }));
vi.mock('../src/modules/ads/server/report-policy', () => ({ loadAdsReportPolicy: state.policy }));
vi.mock('../src/modules/ads/server/output-policy', () => ({ loadAdsOutputPolicy: state.output }));

import AdsPage from '../src/modules/ads/ui/AdsScreen';
import CampaignsPage from '../src/modules/ads/ui/campaigns/CampaignsScreen';
import { AdsFiltersSidebar } from '../src/modules/ads/ui/ads-filters';
import { parseAdsFilters } from '@/modules/ads/server/queries';
import { ADS_REPORT_DEFAULT_POLICY } from '../src/modules/ads/report-policy';
import { AdsReportLimitError } from '../src/modules/ads/read-policy';

const accounts = [
  { id: 'eur', name: 'Europe account', actId: 'ref-eur', currency: 'EUR', enabled: true, accountStatus: 1, lastSyncedAt: new Date('2026-10-10T12:00:00Z'), socialAccount: { provider: 'test-platform' } },
  { id: 'usd', name: 'US account', actId: 'ref-usd', currency: 'USD', enabled: true, accountStatus: 1, lastSyncedAt: null, socialAccount: { provider: 'test-platform' } },
  { id: 'gbp', name: 'UK account', actId: 'ref-gbp', currency: 'GBP', enabled: true, accountStatus: 1, lastSyncedAt: null, socialAccount: { provider: 'test-platform' } },
];
const dom = (html: string) => { const node = document.createElement('div'); node.innerHTML = html; return node; };

beforeEach(() => {
  vi.clearAllMocks();
  state.viewer.mockResolvedValue({ workspaceId: 'workspace', user: { id: 'member' }, permissions: { pageScope: { all: true, ids: [] } }, entitlements: {} });
  state.accounts.mockResolvedValue(accounts);
  state.dataset.mockResolvedValue({ accounts, insights: [], pageSize: 25, maxRows: 2500 });
  state.readiness.mockResolvedValue(false);
  state.canRead.mockResolvedValue(false);
  state.policy.mockResolvedValue(customPolicy);
  state.output.mockResolvedValue({ detailMaxBytes: 1024, exportMaxBytes: 4096, exportFileName: 'ads-report.csv' });
  state.feature.mockReturnValue(true);
  state.access.mockReturnValue(true);
});

describe('Ads report filter UX', () => {
  it('uses the same selected account set for summary counts and account cards', async () => {
    const node = dom(renderToStaticMarkup(await AdsPage({ searchParams: Promise.resolve({ account: 'usd' }) })));
    const totals = Object.fromEntries([...node.querySelectorAll('.metric-card dl')].map(item => [item.querySelector('dt')!.textContent, item.querySelector('dd')!.textContent]));
    expect(totals).toEqual({ 'Linked accounts': '1', 'Enabled accounts': '1', 'Accounts with sync time': '0', 'Campaigns with data': '0' });
    expect(node.querySelectorAll('.ads-account-card')).toHaveLength(1);
    expect(node.querySelector('.ads-account-card h3')?.textContent).toBe('US account');
  });

  it('paginates account cards while preserving global counts and the complete custom filter scope', async () => {
    state.dataset.mockResolvedValue({ accounts, insights: [], pageSize: 1, maxRows: 2500 });
    const node = dom(renderToStaticMarkup(await AdsPage({ searchParams: Promise.resolve({ period: 'custom', since: '2026-10-01', until: '2026-10-03', page: '2' }) })));
    expect(node.querySelectorAll('.ads-account-card')).toHaveLength(1);
    expect(node.querySelector('.ads-account-card h3')?.textContent).toBe('US account');
    expect(node.querySelector('.ui-page-header')?.textContent).toContain('Showing 2–2 of 3 accounts · Page 2 of 3');
    expect(node.querySelector('.metric-card dd')?.textContent).toBe('3');
    const next = node.querySelector<HTMLAnchorElement>('nav[aria-label="Account report pages"] a[rel="next"]')!;
    expect(next.getAttribute('href')).toBe('/ads?period=custom&since=2026-10-01&until=2026-10-03&page=3');
    expect(node.querySelector('.ads-report-pager__current [aria-current="page"]')?.textContent).toBe('Page 2 of 3');
  });

  it('places a bounded export below paging using applied filters without the visible page', async () => {
    const node = dom(renderToStaticMarkup(await AdsPage({ searchParams: Promise.resolve({ period: 'custom', since: '2026-10-01', until: '2026-10-03', account: 'usd', page: '2' }) })));
    const sidebar = node.querySelector('aside')!;
    expect(sidebar.querySelector('section[aria-label="Export Ads report"]')).not.toBeNull();
    expect(sidebar.querySelector('.ads-report-export button')?.textContent).toBe('Export all matching daily rows');
    expect(sidebar.textContent).toContain('Action metrics and additional fields are included');
    expect(sidebar.querySelector('.ads-report-pager')!.compareDocumentPosition(sidebar.querySelector('.ads-report-export')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(state.output).toHaveBeenCalledTimes(1);
  });

  it('hides the report export when an overview reader lacks the campaigns feature', async () => {
    state.feature.mockImplementation((_entitlements, feature) => feature !== 'ads/campaigns');
    const node = dom(renderToStaticMarkup(await AdsPage({ searchParams: Promise.resolve({}) })));
    expect(state.feature).toHaveBeenCalledWith({}, 'ads/campaigns');
    expect(node.querySelector('[aria-label="Export Ads report"]')).toBeNull();
    expect(node.querySelector('.ads-report-pager')).not.toBeNull();
    expect(state.output).not.toHaveBeenCalled();
  });

  it.each([[AdsPage, 'ads/overview'], [CampaignsPage, 'ads/campaigns']] as const)('uses channel-scoped %s access for report pages', async (page, feature) => {
    await page({ searchParams: Promise.resolve({}) });
    expect(state.viewer).toHaveBeenCalledWith({ feature, channelScoped: true });
  });

  it.each([AdsPage, CampaignsPage])('refuses invalid and repeated result pages before reading report data', async page => {
    const node = dom(renderToStaticMarkup(await page({ searchParams: Promise.resolve({ period: 'custom', since: '2026-10-01', until: '2026-10-03', page: ['2', '3'] }) })));
    expect(node.querySelector('[role="alert"]')?.textContent).toBe('Choose a valid report page.');
    expect(node.querySelector('.ads-page-reset')?.getAttribute('href')).toMatch(/period=custom/);
    expect(state.dataset).not.toHaveBeenCalled();
    expect(state.readiness).not.toHaveBeenCalled();
  });

  it('paginates complete campaign summaries and checks readiness only for visible object accounts', async () => {
    const date = new Date('2026-10-02T00:00:00Z');
    const row = (id: string, account: typeof accounts[number]) => ({ id, adAccountId: account.id, level: 'campaign', objectId: id, objectName: `Campaign ${id}`, date, spend: 2, impressions: 10, clicks: 1, reach: 5, cpc: 2, cpm: 200, cpp: null, ctr: 10, frequency: 1, actions: [], fields: {}, adAccount: { id: account.id, name: account.name, currency: account.currency } });
    state.dataset.mockResolvedValue({ accounts, insights: [row('a', accounts[0]), row('b', accounts[1])], pageSize: 1, maxRows: 2500 });
    const node = dom(renderToStaticMarkup(await CampaignsPage({ searchParams: Promise.resolve({ page: '2' }) })));
    expect(node.querySelector('.ui-page-header')?.textContent).toContain('Showing 2–2 of 2 objects · Page 2 of 2');
    expect(node.querySelectorAll('.ads-results-panel')).toHaveLength(1);
    expect(node.querySelector('.ads-results-panel h2')?.textContent).toBe('US account');
    expect(state.dataset).toHaveBeenCalledWith('workspace', expect.anything(), undefined, ['test-platform'], { levels: ['campaign', 'adset', 'ad'] });
    expect(state.canRead).toHaveBeenCalledTimes(1);
    expect(state.canRead.mock.calls[0][1]).toBe('usd');
  });

  it('shows no partial rows after a report limit failure and retains the selected filters', async () => {
    state.dataset.mockRejectedValue(new AdsReportLimitError());
    const node = dom(renderToStaticMarkup(await AdsPage({ searchParams: Promise.resolve({ period: 'custom', since: '2026-10-01', until: '2026-10-03', account: 'usd' }) })));
    expect(node.querySelector('[role="alert"]')?.textContent).toMatch(/too much report data/i);
    expect(node.querySelector<HTMLInputElement>('input[name="since"]')?.value).toBe('2026-10-01');
    expect(node.querySelector<HTMLSelectElement>('select[name="account"]')?.value).toBe('usd');
    expect(node.querySelector('.ads-page-reset')?.getAttribute('href')).toBe('/ads?period=custom&since=2026-10-01&until=2026-10-03&account=usd');
    expect(node.querySelector('.ads-account-card')).toBeNull();
    expect(node.querySelector('[aria-label="Export Ads report"]')).toBeNull();
    expect(state.output).not.toHaveBeenCalled();
  });


  it.each([AdsPage, CampaignsPage])('retains a stale account selection, shows a linked error and does not load an unfiltered report', async page => {
    const node = dom(renderToStaticMarkup(await page({ searchParams: Promise.resolve({ account: 'removed-account' }) })));
    const select = node.querySelector<HTMLSelectElement>('select[name=account]')!;
    expect(select.value).toBe('removed-account');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(node.querySelector(`#${select.getAttribute('aria-describedby')}`)?.textContent).toMatch(/account/i);
    expect(node.querySelector('[role=alert]')).not.toBeNull();
    expect(state.dataset).not.toHaveBeenCalled();
    expect(state.readiness).not.toHaveBeenCalled();
  });

  it('keeps malformed custom dates available for correction instead of showing a default report', async () => {
    const node = dom(renderToStaticMarkup(await AdsPage({ searchParams: Promise.resolve({ period: 'custom', since: '2026-02-30', until: '2026-03-03' }) })));
    const since = node.querySelector<HTMLInputElement>('input[name=since]')!;
    expect(since.value).toBe('2026-02-30');
    expect(since.getAttribute('aria-invalid')).toBe('true');
    expect(node.querySelector('[role=alert]')).not.toBeNull();
    expect(state.dataset).not.toHaveBeenCalled();
  });

  it('makes dates noneditable for a preset and editable for a custom range', () => {
    const preset = dom(renderToStaticMarkup(createElement(AdsFiltersSidebar, { accounts, policy: ADS_REPORT_DEFAULT_POLICY, filters: parseAdsFilters({}, accounts.map(a => a.id)) })));
    expect(preset.querySelector<HTMLInputElement>('input[name=since]')!.disabled).toBe(true);
    const custom = dom(renderToStaticMarkup(createElement(AdsFiltersSidebar, { accounts, policy: ADS_REPORT_DEFAULT_POLICY, filters: parseAdsFilters({ period: 'custom', since: '2026-10-01', until: '2026-10-03' }, accounts.map(a => a.id)) })));
    expect(custom.querySelector<HTMLInputElement>('input[name=since]')!.disabled).toBe(false);
  });

  it('keeps an explicit empty account invalid rather than broadening it during correction', async () => {
    const node = dom(renderToStaticMarkup(await AdsPage({ searchParams: Promise.resolve({ account: '', period: 'custom', since: 'bad-day', until: '2026-10-03' }) })));
    expect(node.querySelector<HTMLSelectElement>('select[name=account]')?.value).toBe('');
    expect(node.querySelector('select[name=account]')?.getAttribute('aria-invalid')).toBe('true');
    expect(node.querySelector('[role=alert]')).not.toBeNull();
  });

  it.each([AdsPage, CampaignsPage])('loads and uses the module report policy after authorization', async page => {
    const node = dom(renderToStaticMarkup(await page({ searchParams: Promise.resolve({}) })));
    expect(state.policy).toHaveBeenCalledTimes(1);
    expect(state.policy.mock.invocationCallOrder[0]).toBeGreaterThan(state.viewer.mock.invocationCallOrder[0]);
    expect(node.querySelector('select[name=period] option[value="14d"]')?.textContent).toBe('Last two weeks');
    expect(node.querySelector<HTMLSelectElement>('select[name=period]')?.value).toBe('14d');
  });

  it('keeps custom range correction and explains the configured maximum', async () => {
    const node = dom(renderToStaticMarkup(await AdsPage({ searchParams: Promise.resolve({ period: 'custom', since: '2026-10-01', until: '2026-10-20' }) })));
    expect(node.querySelector('[role=alert]')).not.toBeNull();
    expect(node.querySelector<HTMLInputElement>('input[name=since]')?.value).toBe('2026-10-01');
    expect(node.textContent).toMatch(/14 days/i);
    expect(state.dataset).not.toHaveBeenCalled();
  });

  it('sets the correction text input maximum from policy and preserves overlong input', async () => {
    const invalid = 'x'.repeat(100);
    const node = dom(renderToStaticMarkup(await AdsPage({ searchParams: Promise.resolve({ period: 'custom', since: invalid, until: '2026-10-03' }) })));
    const since = node.querySelector<HTMLInputElement>('input[name=since]')!;
    expect(since.value).toBe(invalid);
    expect(since.getAttribute('maxlength')).toBe('80');
    expect(node.querySelector('[role=alert]')).not.toBeNull();
  });

  it('uses a policy default when selecting All accounts and an unknown preset needs correction', () => {
    const node = dom(renderToStaticMarkup(createElement(AdsFiltersSidebar, {
      accounts, policy: customPolicy, input: { period: 'removed-range' },
      filters: undefined,
    })));
    expect(node.querySelector<HTMLSelectElement>('select[name=period]')?.value).toBe('removed-range');
    expect(node.querySelector('select[name=period] option[value="14d"]')?.textContent).toBe('Last two weeks');
  });

  it('parses custom presets, enforces configured range limits and retains unknown preset errors', () => {
    const { since, until } = parseAdsFilters({}, ['eur'], new Date('2026-10-17T12:00:00Z'), customPolicy);
    expect(since.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(until.toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(() => parseAdsFilters({ period: 'custom', since: '2026-10-01', until: '2026-10-20' }, ['eur'], undefined, customPolicy)).toThrow();
    expect(() => parseAdsFilters({ period: 'removed-range' }, ['eur'], undefined, customPolicy)).toThrow();
  });
});
