// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const customPolicy = {
  presets: [{ id: '14d', days: 14, label: 'Last two weeks' }],
  defaultPreset: '14d', maxRangeDays: 14, maxFilterCharacters: 80,
};
const state = vi.hoisted(() => ({ accounts: vi.fn(), dataset: vi.fn(), viewer: vi.fn(), readiness: vi.fn(), policy: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/server/entitlements', () => ({ entitledPlatformIds: () => ['test-platform'] }));
vi.mock('../src/server/PageFrame', () => ({ PageFrame: ({ children, sidebar }: { children: ReactNode; sidebar?: ReactNode }) => createElement('div', null, createElement('aside', null, sidebar), children) }));
vi.mock('../src/server/ads/queries', async original => ({ ...await original<typeof import('../src/server/ads/queries')>(), getAdsAccounts: state.accounts, getAdsDataset: state.dataset }));
vi.mock('../src/server/ads/actions', () => ({ canManageWorkspaceAds: state.readiness, canReadWorkspaceAds: state.readiness }));
vi.mock('../src/server/platforms/registry', () => ({ platformAds: async () => null }));
vi.mock('../src/modules/ads/server/report-policy', () => ({ loadAdsReportPolicy: state.policy }));

import AdsPage from '../src/app/ads/page';
import CampaignsPage from '../src/app/ads/campaigns/page';
import { AdsFiltersSidebar } from '../src/app/ads/ads-filters';
import { parseAdsFilters } from '../src/server/ads/queries';
import { ADS_REPORT_DEFAULT_POLICY } from '../src/modules/ads/report-policy';

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
  state.dataset.mockResolvedValue({ accounts, insights: [] });
  state.readiness.mockResolvedValue(false);
  state.policy.mockResolvedValue(customPolicy);
});

describe('Ads report filter UX', () => {
  it('uses the same selected account set for summary counts and account cards', async () => {
    const node = dom(renderToStaticMarkup(await AdsPage({ searchParams: Promise.resolve({ account: 'usd' }) })));
    const totals = Object.fromEntries([...node.querySelectorAll('.metric-card dl')].map(item => [item.querySelector('dt')!.textContent, item.querySelector('dd')!.textContent]));
    expect(totals).toEqual({ 'Linked accounts': '1', 'Enabled accounts': '1', 'Accounts with sync time': '0', 'Campaigns with data': '0' });
    expect(node.querySelectorAll('.ads-account-card')).toHaveLength(1);
    expect(node.querySelector('.ads-account-card h3')?.textContent).toBe('US account');
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
