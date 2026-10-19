import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: vi.fn(), accounts: vi.fn(), dataset: vi.fn(), reportPolicy: vi.fn(), config: vi.fn() }));
vi.mock('../src/modules/ads/server/access', () => ({ authorizeAdsRead: state.access }));
vi.mock('@/modules/ads/server/queries', () => ({ getAdsAccounts: state.accounts, getAdsDataset: state.dataset }));
vi.mock('../src/modules/ads/server/report-policy', () => ({ loadAdsReportPolicy: state.reportPolicy }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));

import { ADS_ANALYSIS_DEFAULT_POLICY, peakReach, spendSharePercent, sumActions } from '../src/modules/ads/analysis/metrics';
import { exportAdsComparison, readAdsComparison } from '../src/modules/ads/analysis/server';
import { executeAdsAnalysisTool } from '../src/modules/ads/analysis/mcp';
import { buildAdsComparisonCsv } from '../src/modules/ads/analysis/csv';
import { adsCopy, adsFindingText, adsLocale, adsText } from '../src/modules/ads/analysis/copy';

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const account = { id: 'a1', name: 'Main', currency: 'USD' };
const row = (level: string, objectId: string, date: string, spend: number, clicks: number, extra: Record<string, unknown> = {}) => ({
  adAccountId: 'a1', level, objectId, objectName: objectId === 'c2' ? '=cmd|calc' : `Name ${objectId}`, date: day(date), fetchedAt: new Date('2026-10-17T06:00:00Z'),
  spend, impressions: clicks * 100, clicks, reach: clicks * 10, actions: { link_click: clicks }, adAccount: account, ...extra,
});
const now = new Date('2026-10-17T12:00:00Z');

describe('comparison helpers', () => {
  it('computes whole-percent spend share and refuses a missing or zero total', () => {
    expect(spendSharePercent(25, 100)).toBe(25);
    expect(spendSharePercent(1, 0)).toBeNull();
    expect(spendSharePercent(1, null)).toBeNull();
  });
  it('sums action maps by count and ignores non-numeric entries', () => {
    expect(sumActions([{ a: 1, b: 5 }, { a: 2, c: 'x' }, null, [1], { b: Number.NaN }])).toEqual({ b: 5, a: 3 });
    expect(Object.keys(sumActions([{ a: 1, b: 2, c: 3 }], 2))).toEqual(['c', 'b']);
  });
  it('uses the highest single day for reach and unknown when nothing was read', () => {
    expect(peakReach([10, 40, 25])).toBe(40);
    expect(peakReach([])).toBeNull();
  });
});

describe('comparison copy', () => {
  it('has the same keys in English and French', () => {
    expect(Object.keys(adsCopy.fr).sort()).toEqual(Object.keys(adsCopy.en).sort());
  });
  it('chooses French only for French-first browsers and fills placeholders', () => {
    expect(adsLocale('fr-FR,fr;q=0.9')).toBe('fr');
    expect(adsLocale('en-US,fr;q=0.8')).toBe('en');
    expect(adsLocale(null)).toBe('en');
    expect(adsText('fr', 'showing', { shown: 2, total: 9 })).toBe('Affichage des 2 premiers sur 9.');
    expect(adsFindingText('en', 'concentrated', { name: 'Spring', share: 70 })).toContain('70%');
    expect(adsFindingText('fr', 'cpcUp', { percent: 20 })).toContain('20 %');
  });
});

describe('comparison service additions', () => {
  const actor = { userId: 'u1', workspaceId: 'w1' };
  beforeEach(() => {
    vi.clearAllMocks();
    state.access.mockResolvedValue({ actor, allowedTargetIds: ['t1'], allowedProviders: ['facebook'] });
    state.reportPolicy.mockResolvedValue({ presets: [{ id: '7d', days: 7, label: 'Last 7 days' }], defaultPreset: '7d', maxRangeDays: 30, maxFilterCharacters: 80 });
    state.config.mockImplementation(async (key: string) => key === 'ads.exportMaxBytes' ? 100_000 : key === 'ads.exportFileName' ? 'ads-report.csv'
      : key === 'ads.analysisPolicy' ? ADS_ANALYSIS_DEFAULT_POLICY : key === 'ads.detailMaxBytes' ? 100_000 : undefined);
    state.accounts.mockResolvedValue([{ ...account, lastSyncedAt: new Date('2026-10-17T05:00:00Z') }]);
    state.dataset.mockResolvedValue({ accounts: [{ ...account, lastSyncedAt: new Date('2026-10-17T05:00:00Z') }], pageSize: 25, maxRows: 100, insights: [
      row('account', 'a1', '2026-10-11', 100, 100, { actions: { link_click: 100, purchase: 2 } }),
      row('account', 'a1', '2026-10-12', 100, 100, { actions: { link_click: 50 } }),
      row('campaign', 'c1', '2026-10-11', 120, 120, { reach: 500 }), row('campaign', 'c1', '2026-10-12', 40, 40, { reach: 900 }),
      row('campaign', 'c2', '2026-10-12', 40, 40, { actions: undefined }),
    ] });
  });

  it('adds share of spend, peak-day reach, summed actions, coverage and last-synced time', async () => {
    const result = await readAdsComparison(actor, { compare: 'accounts' }, now);
    const group = result.groups[0]!;
    expect(group.actions).toEqual({ link_click: 150, purchase: 2 });
    expect(group.coverage).toEqual({ firstDay: '2026-10-11', lastDay: '2026-10-12' });
    expect(group.accounts[0]).toMatchObject({ id: 'a1', lastSyncedAt: '2026-10-17T05:00:00.000Z' });
    const c1 = group.objects.find(object => object.objectId === 'c1')!;
    expect(c1).toMatchObject({ spend: 160, sharePercent: 80, reachPeakDay: 900 });
    expect(group.objects.find(object => object.objectId === 'c2')).toMatchObject({ sharePercent: 20, actions: {} });
  });

  it('leaves the share unknown when account totals are missing', async () => {
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 25, maxRows: 100, insights: [row('campaign', 'c1', '2026-10-12', 10, 5)] });
    const result = await readAdsComparison(actor, { compare: 'accounts' }, now);
    expect(result.groups[0]!.objects[0]).toMatchObject({ sharePercent: null });
    expect(result.groups[0]!.coverage).toBeNull();
  });

  it('exports one CSV row per object with unknowns empty, formulas neutralised and a derived file name', async () => {
    const exported = await exportAdsComparison(actor, { compare: 'accounts' }, now);
    expect(exported.fileName).toMatch(/^ads-report-comparison-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(exported.rowCount).toBe(2);
    const lines = exported.csv.trimEnd().split('\r\n');
    expect(lines[0]).toContain('share_of_spend_percent');
    expect(exported.csv).toContain(`"'=cmd|calc"`);
    expect(exported.byteLength).toBe(Buffer.byteLength(exported.csv));
  });

  it('refuses a CSV above the Root size limit instead of truncating', async () => {
    const result = await readAdsComparison(actor, { compare: 'accounts' }, now);
    expect(() => buildAdsComparisonCsv(result, 50)).toThrow(/size limit/);
    expect(() => buildAdsComparisonCsv(result, 0)).toThrow(/valid/);
  });

  it('serves csv through the MCP tool, honouring the result ceiling', async () => {
    await expect(executeAdsAnalysisTool(actor, 'compare_ads_performance', { compare: 'accounts', format: 'csv' })).resolves.toMatchObject({ rowCount: 2, format: 'ms-social-pilot-ads-comparison-csv' });
    await expect(executeAdsAnalysisTool(actor, 'compare_ads_performance', { compare: 'accounts', format: 'csv' }, 1)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeAdsAnalysisTool(actor, 'compare_ads_performance', { format: 'xml' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeAdsAnalysisTool(actor, 'compare_ads_performance', { compare: 'accounts', format: 'json' })).resolves.toMatchObject({ compare: 'accounts' });
  });
});
