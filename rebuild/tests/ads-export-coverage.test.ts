import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: vi.fn(), accounts: vi.fn(), dataset: vi.fn(), reportPolicy: vi.fn(), readPolicy: vi.fn(), outputPolicy: vi.fn(), config: vi.fn(), platformAds: vi.fn() }));
vi.mock('../src/modules/ads/server/access', () => ({ authorizeAdsRead: state.access }));
vi.mock('@/modules/ads/server/queries', () => ({ getAdsAccounts: state.accounts, getAdsDataset: state.dataset }));
vi.mock('@/modules/ads/server/actions', () => ({ readWorkspaceAdObject: vi.fn() }));
vi.mock('../src/modules/ads/server/report-policy', () => ({ loadAdsReportPolicy: state.reportPolicy }));
vi.mock('../src/modules/ads/server/read-policy', () => ({ loadAdsReadPolicy: state.readPolicy }));
vi.mock('../src/modules/ads/server/output-policy', () => ({ loadAdsOutputPolicy: state.outputPolicy }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('../src/modules/ads/directory/management-port', () => ({ adsDirectoryManagementPort: () => null }));
vi.mock('../src/server/platforms/registry', () => ({ platformAds: state.platformAds }));

import { ADS_ANALYSIS_DEFAULT_POLICY } from '../src/modules/ads/analysis/metrics';
import { exportAdsComparison } from '../src/modules/ads/analysis/server';
import { executeAdsAnalysisTool } from '../src/modules/ads/analysis/mcp';
import { exportAdsDirectory } from '../src/modules/ads/directory/server';
import { executeAdsDirectoryTool } from '../src/modules/ads/directory/mcp';
import { adsCopy } from '../src/modules/ads/analysis/copy';

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const account = { id: 'a1', name: 'Main', currency: 'USD' };
const row = (level: string, objectId: string, date: string, spend: number, clicks: number, extra: Record<string, unknown> = {}) => ({
  adAccountId: 'a1', level, objectId, objectName: objectId === 'x' ? '=evil()' : `Name ${objectId}`, date: day(date), fetchedAt: new Date('2026-10-17T06:00:00Z'),
  spend, impressions: clicks * 100, clicks, reach: clicks * 10, actions: null, fields: null, adAccount: account, ...extra,
});
const actor = { userId: 'u1', workspaceId: 'w1' };
const now = new Date('2026-10-17T12:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  state.access.mockResolvedValue({ actor, allowedTargetIds: ['t1'], allowedProviders: ['facebook'] });
  state.reportPolicy.mockResolvedValue({ presets: [{ id: '7d', days: 7, label: 'Last 7 days' }], defaultPreset: '7d', maxRangeDays: 30, maxFilterCharacters: 80 });
  state.readPolicy.mockResolvedValue({ pageSize: 25, maxRows: 100 });
  state.outputPolicy.mockResolvedValue({ exportMaxBytes: 100_000, exportFileName: 'ads-report.csv', detailMaxBytes: 100_000 });
  state.config.mockImplementation(async (key: string) => (key === 'ads.analysisPolicy' ? { ...ADS_ANALYSIS_DEFAULT_POLICY, maxObjects: 1 } : undefined));
  state.accounts.mockResolvedValue([{ ...account, lastSyncedAt: null, socialAccount: { provider: 'test-platform' } }]);
  state.platformAds.mockResolvedValue(null);
});

describe('comparison CSV completeness and daily section', () => {
  beforeEach(() => {
    state.dataset.mockResolvedValue({ accounts: [account], pageSize: 25, maxRows: 100, insights: [
      row('account', 'a1', '2026-10-11', 30, 3), row('account', 'a1', '2026-10-12', 20, 0, { impressions: 0 }),
      row('campaign', 'c1', '2026-10-11', 20, 2), row('campaign', 'c2', '2026-10-11', 10, 1), row('campaign', 'x', '2026-10-12', 20, 0),
    ] });
  });
  it('exports every object even when the on-screen cap is lower', async () => {
    const exported = await exportAdsComparison(actor, { compare: 'accounts' }, now);
    expect(exported.rowCount).toBe(3);
  });
  it('exports the daily series with recomputed ratios, empty unknowns and a daily file name', async () => {
    const exported = await exportAdsComparison(actor, { compare: 'accounts' }, now, 'daily');
    expect(exported.section).toBe('daily');
    expect(exported.fileName).toMatch(/-comparison-daily-/);
    const lines = exported.csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('group,currency,accounts,date,spend,impressions,clicks,ctr_percent,cpc,cpm,range_from,range_to_exclusive');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"2026-10-11",30,300,3,1,10,100');
    expect(lines[2]).toContain('"2026-10-12",20,0,0,,,');
  });
  it('rejects an unknown section and serves daily through MCP', async () => {
    await expect(exportAdsComparison(actor, {}, now, 'weekly' as never)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeAdsAnalysisTool(actor, 'compare_ads_performance', { compare: 'accounts', format: 'csv', section: 'daily' })).resolves.toMatchObject({ section: 'daily', rowCount: 2 });
    await expect(executeAdsAnalysisTool(actor, 'compare_ads_performance', { section: 'daily' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('directory CSV', () => {
  beforeEach(() => {
    state.dataset.mockResolvedValue({ accounts: [account], pageSize: 25, maxRows: 100, insights: [
      row('campaign', 'c1', '2026-10-11', 20, 2), row('campaign', 'x', '2026-10-12', 0, 0),
    ] });
  });
  it('exports all matching objects with last delivery day and neutralised formulas', async () => {
    const exported = await exportAdsDirectory(actor, { level: 'campaign' }, now);
    expect(exported.rowCount).toBe(2);
    expect(exported.csv.split('\r\n')[0]).toContain('last_delivery_day');
    expect(exported.csv).toContain(`"'=evil()"`);
    expect(exported.fileName).toMatch(/^ads-report-campaigns-/);
  });
  it('refuses paging options and oversize lists instead of truncating', async () => {
    await expect(exportAdsDirectory(actor, { offset: 1 }, now)).rejects.toMatchObject({ code: 'invalid_request' });
    state.outputPolicy.mockResolvedValue({ exportMaxBytes: 50, exportFileName: 'ads-report.csv' });
    await expect(exportAdsDirectory(actor, {}, now)).rejects.toThrow(/size limit/);
    state.outputPolicy.mockResolvedValue({ exportMaxBytes: 100_000, exportFileName: 'ads-report.csv' });
    state.readPolicy.mockResolvedValue({ pageSize: 25, maxRows: 1 });
    await expect(exportAdsDirectory(actor, {}, now)).rejects.toThrow(/Too many/);
  });
  it('serves csv through MCP honouring the result ceiling', async () => {
    await expect(executeAdsDirectoryTool(actor, 'list_ads_objects', { format: 'csv' })).resolves.toMatchObject({ rowCount: 2 });
    await expect(executeAdsDirectoryTool(actor, 'list_ads_objects', { format: 'csv' }, 1)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeAdsDirectoryTool(actor, 'list_ads_objects', { format: 'xml' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('copy', () => {
  it('keeps en and fr keys identical', () => {
    expect(Object.keys(adsCopy.fr).sort()).toEqual(Object.keys(adsCopy.en).sort());
  });
});
