import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: vi.fn(), accounts: vi.fn(), dataset: vi.fn(), reportPolicy: vi.fn(), config: vi.fn() }));
vi.mock('../src/modules/ads/server/access', () => ({ authorizeAdsRead: state.access }));
vi.mock('../src/server/ads/queries', () => ({ getAdsAccounts: state.accounts, getAdsDataset: state.dataset }));
vi.mock('../src/modules/ads/server/report-policy', () => ({ loadAdsReportPolicy: state.reportPolicy }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));

import {
  ADS_ANALYSIS_DEFAULT_POLICY, assessFreshness, buildFindings, buildKpis, percentChange, previousWindow, sortObjects, totalsFromRows,
} from '../src/modules/ads/analysis/metrics';
import { readAdsComparison } from '../src/modules/ads/analysis/server';
import { executeAdsAnalysisTool } from '../src/modules/ads/analysis/mcp';
import { pageSearchRecord } from '../src/modules/ads/analysis/query';

const policy = ADS_ANALYSIS_DEFAULT_POLICY;
const day = (value: string) => new Date(`${value}T00:00:00Z`);

describe('Ads analysis metrics', () => {
  it('recomputes ratios from additive flows and treats empty data as unknown', () => {
    expect(totalsFromRows([{ date: 'a', spend: 10, impressions: 1000, clicks: 50 }, { date: 'b', spend: 10, impressions: 3000, clicks: 10 }]))
      .toMatchObject({ spend: 20, impressions: 4000, clicks: 60, cpc: 0.3333, ctr: 1.5, cpm: 5, days: 2 });
    expect(totalsFromRows([])).toMatchObject({ spend: 0, cpc: null, ctr: null, cpm: null });
  });
  it('never compares against a zero or missing baseline', () => {
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(null, 5)).toBeNull();
    expect(percentChange(15, 10)).toBe(50);
    const kpis = buildKpis(totalsFromRows([{ date: 'a', spend: 1, impressions: 10, clicks: 1 }]), null);
    expect(kpis.every(kpi => kpi.changePercent === null && kpi.previous === null)).toBe(true);
  });
  it('creates findings only when thresholds and sample sizes are met', () => {
    const current = { spend: 100, impressions: 10000, clicks: 100, cpc: 1, cpm: 10, ctr: 1, days: 7 };
    const previous = { spend: 100, impressions: 10000, clicks: 50, cpc: 2, cpm: 10, ctr: 0.5, days: 7 };
    const objects = [
      { objectId: 'a', name: 'A', spend: 80, impressions: 5000, clicks: 80, cpc: 1, ctr: 2, cpm: 16 },
      { objectId: 'b', name: 'B', spend: 20, impressions: 50, clicks: 2, cpc: 10, ctr: 4, cpm: 400 },
    ];
    const keys = buildFindings({ current, previous, objects, policy }).map(finding => finding.key);
    expect(keys).toEqual(expect.arrayContaining(['cpcDown', 'ctrUp', 'concentrated', 'bestCtr']));
    expect(keys).not.toContain('costlyClicks');
    expect(buildFindings({ current: { ...current, spend: 0 }, previous, objects, policy }).map(finding => finding.key)).toEqual(['noSpend']);
  });
  it('sorts with unknown values last in either direction and stable ties', () => {
    const rows = [
      { objectId: 'b', name: 'B', spend: 1, impressions: 0, clicks: 0, cpc: null, ctr: null, cpm: null },
      { objectId: 'a', name: 'A', spend: 1, impressions: 0, clicks: 0, cpc: 2, ctr: null, cpm: null },
      { objectId: 'c', name: 'C', spend: 1, impressions: 0, clicks: 0, cpc: 1, ctr: null, cpm: null },
    ];
    expect(sortObjects(rows, 'cpc', 'asc').map(row => row.objectId)).toEqual(['c', 'a', 'b']);
    expect(sortObjects(rows, 'cpc', 'desc').map(row => row.objectId)).toEqual(['a', 'c', 'b']);
    expect(sortObjects(rows, 'spend', 'desc').map(row => row.objectId)).toEqual(['a', 'b', 'c']);
  });
  it('reports freshness and previous windows', () => {
    const now = new Date('2026-10-17T12:00:00Z');
    expect(assessFreshness([], now, 36).status).toBe('unknown');
    expect(assessFreshness([new Date('2026-10-17T00:00:00Z')], now, 36)).toMatchObject({ status: 'fresh', ageHours: 12 });
    expect(assessFreshness([new Date('2026-10-10T00:00:00Z')], now, 36).status).toBe('stale');
    const window = previousWindow(day('2026-10-08'), day('2026-10-15'));
    expect(window.since.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(window.until.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });
});

const account = (id: string, currency: string | null) => ({ id, name: `Account ${id}`, currency });
const row = (adAccountId: string, level: string, objectId: string, date: string, spend: number, clicks: number, currency: string | null = 'USD') => ({
  adAccountId, level, objectId, objectName: `Name ${objectId}`, date: day(date), fetchedAt: new Date('2026-10-17T06:00:00Z'), spend, impressions: clicks * 100, clicks, adAccount: account(adAccountId, currency),
});

describe('Ads comparison service', () => {
  const actor = { userId: 'u1', workspaceId: 'w1' };
  beforeEach(() => {
    vi.clearAllMocks();
    state.access.mockResolvedValue({ actor, allowedTargetIds: ['t1'], allowedProviders: ['facebook'] });
    state.reportPolicy.mockResolvedValue({ presets: [{ id: '7d', days: 7, label: 'Last 7 days' }], defaultPreset: '7d', maxRangeDays: 30, maxFilterCharacters: 80 });
    state.config.mockResolvedValue(policy);
    state.accounts.mockResolvedValue([account('a1', 'USD'), account('a2', 'EUR')]);
  });

  it('compares with the previous window, scopes reads, and never sums currencies', async () => {
    state.dataset.mockImplementation(async (_w, filters) => ({
      accounts: [], pageSize: 25, maxRows: 100,
      insights: filters.since.toISOString().startsWith('2026-10-10') || filters.since > day('2026-10-05')
        ? [row('a1', 'account', 'a1', '2026-10-12', 100, 100), row('a1', 'campaign', 'c1', '2026-10-12', 100, 100), row('a2', 'account', 'a2', '2026-10-12', 50, 10, 'EUR')]
        : [row('a1', 'account', 'a1', '2026-10-05', 100, 50)],
    }));
    const result = await readAdsComparison(actor, { period: 'custom', start: '2026-10-10', end: '2026-10-16' }, new Date('2026-10-17T12:00:00Z'));
    expect(state.dataset).toHaveBeenCalledWith('w1', expect.anything(), ['t1'], ['facebook'], { levels: ['account', 'campaign'] });
    expect(state.dataset).toHaveBeenCalledWith('w1', expect.anything(), ['t1'], ['facebook'], { levels: ['account'] });
    expect(result.groups.map(group => group.currency).sort()).toEqual(['EUR', 'USD']);
    const usd = result.groups.find(group => group.currency === 'USD')!;
    expect(usd.totals?.spend).toBe(100);
    expect(usd.kpis.find(kpi => kpi.key === 'clicks')!.changePercent).toBe(100);
    const eur = result.groups.find(group => group.currency === 'EUR')!;
    expect(eur.previous).toBeNull();
    expect(eur.kpis.every(kpi => kpi.changePercent === null)).toBe(true);
    expect(result.previousRange).toEqual({ from: '2026-10-03', to: '2026-10-10', endExclusive: true });
  });

  it('compares across accounts and keeps accounts without data visible as unknown', async () => {
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 25, maxRows: 100, insights: [row('a1', 'account', 'a1', '2026-10-12', 10, 5)] });
    const result = await readAdsComparison(actor, { compare: 'accounts' }, new Date('2026-10-17T12:00:00Z'));
    expect(state.dataset).toHaveBeenCalledTimes(1);
    expect(result.groups).toHaveLength(2);
    expect(result.groups.find(group => group.key === 'a2')).toMatchObject({ hasData: false, freshness: { status: 'unknown' } });
  });

  it('bounds selected accounts and keeps unknown currencies separate', async () => {
    state.config.mockResolvedValue({ ...policy, maxCompareAccounts: 1 });
    state.accounts.mockResolvedValue([account('a1', 'USD'), account('a2', 'EUR')]);
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 25, maxRows: 100, insights: [row('a1', 'account', 'a1', '2026-10-12', 10, 5)] });
    await expect(readAdsComparison(actor, { compare: 'accounts', accountId: 'a1' }, new Date('2026-10-17T12:00:00Z'))).resolves.toMatchObject({ groups: [{ key: 'a1' }] });

    state.accounts.mockResolvedValue([account('a1', null), account('a2', null)]);
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 25, maxRows: 100, insights: [
      row('a1', 'account', 'a1', '2026-10-12', 10, 5, null), row('a2', 'account', 'a2', '2026-10-12', 20, 10, null),
    ] });
    const result = await readAdsComparison(actor, {}, new Date('2026-10-17T12:00:00Z'));
    expect(result.groups).toHaveLength(2);
    expect(result.groups.map(group => group.totals?.spend).sort()).toEqual([10, 20]);
  });

  it('preserves account identity when object IDs repeat across accounts', async () => {
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 25, maxRows: 100, insights: [
      row('a1', 'account', 'a1', '2026-10-12', 10, 5), row('a1', 'campaign', 'same', '2026-10-12', 10, 5),
      row('a2', 'account', 'a2', '2026-10-12', 20, 10), row('a2', 'campaign', 'same', '2026-10-12', 20, 10),
    ] });
    const result = await readAdsComparison(actor, { level: 'campaign', sort: 'name', direction: 'asc' }, new Date('2026-10-17T12:00:00Z'));
    expect(result.groups[0]!.objects.map(item => [item.accountId, item.objectId])).toEqual([['a1', 'same'], ['a2', 'same']]);
  });

  it('keeps object rows visible when the account aggregate is missing', async () => {
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 25, maxRows: 100, insights: [row('a1', 'campaign', 'c1', '2026-10-12', 10, 5)] });
    const result = await readAdsComparison(actor, { compare: 'accounts' }, new Date('2026-10-17T12:00:00Z'));
    expect(result.groups[0]).toMatchObject({ hasData: true, accountTotalsAvailable: false, totals: null, kpis: [], objects: [{ objectId: 'c1', spend: 10 }], findings: [], freshness: { status: 'fresh' } });
  });

  it('does not turn a missing current aggregate into zero or a false negative change', async () => {
    state.dataset.mockImplementation(async (_workspace, filters) => ({
      accounts: [], pageSize: 25, maxRows: 100,
      insights: filters.since.toISOString().startsWith('2026-10-03')
        ? [row('a1', 'account', 'a1', '2026-10-05', 100, 50)]
        : [row('a1', 'campaign', 'c1', '2026-10-12', 10, 5)],
    }));
    const result = await readAdsComparison(actor, { period: 'custom', start: '2026-10-10', end: '2026-10-16' }, new Date('2026-10-17T12:00:00Z'));
    expect(result.groups[0]).toMatchObject({ accountTotalsAvailable: false, totals: null, previous: { spend: 100 }, kpis: [], objects: [{ objectId: 'c1' }] });
  });

  it.each([
    [{ compare: 'other' }], [{ level: 'account' }], [{ sort: 'reach' }], [{ direction: 'up' }], [{ unknown: 1 }], [{ period: 'x'.repeat(200) }], ['text'],
  ])('rejects invalid input before reading data: %j', async input => {
    await expect(readAdsComparison(actor, input)).rejects.toMatchObject({ code: expect.stringMatching(/invalid_request|unavailable/) });
    expect(state.dataset).not.toHaveBeenCalled();
  });

  it('refuses unauthorized readers and bounds account comparisons by Root policy', async () => {
    state.access.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'forbidden' }));
    await expect(readAdsComparison(actor, {})).rejects.toThrow('no');
    expect(state.dataset).not.toHaveBeenCalled();
    state.config.mockResolvedValue({ ...policy, maxCompareAccounts: 1 });
    await expect(readAdsComparison(actor, { compare: 'accounts' })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('fails closed when Root analysis policy is invalid', async () => {
    state.config.mockResolvedValue({ minImpressions: -1 });
    await expect(readAdsComparison(actor, {})).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('exposes the comparison through the MCP executor and rejects unknown tools', async () => {
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 25, maxRows: 100, insights: [] });
    await expect(executeAdsAnalysisTool(actor, 'compare_ads_performance', { compare: 'accounts' })).resolves.toMatchObject({ compare: 'accounts' });
    await expect(executeAdsAnalysisTool(actor, 'nope', {})).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('Ads page query parsing', () => {
  it('rejects repeated, unknown, oversized and malformed offset values', () => {
    expect(() => pageSearchRecord({ period: ['7d', '30d'] }, ['period'], 20)).toThrow(/one value/);
    expect(() => pageSearchRecord({ unexpected: '1' }, ['period'], 20)).toThrow(/unknown Ads filters/);
    expect(() => pageSearchRecord({ period: 'x'.repeat(21) }, ['period'], 20)).toThrow(/20 characters/);
    expect(() => pageSearchRecord({ offset: '1e2' }, ['offset'], 20)).toThrow(/valid page number/);
    expect(pageSearchRecord({ offset: '100' }, ['offset'], 20)).toEqual({ offset: '100' });
  });
});
