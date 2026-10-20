import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), accounts: vi.fn(), dataset: vi.fn(), config: vi.fn(), policy: vi.fn(), viewer: vi.fn() }));
vi.mock('../server/access', () => ({ authorizeAdsRead: mocks.access }));
vi.mock('../server/queries', () => ({ getAdsAccounts: mocks.accounts, getAdsDataset: mocks.dataset }));
vi.mock('../server/report-policy', () => ({ loadAdsReportPolicy: mocks.policy }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/server/context', () => ({ requireViewer: mocks.viewer }));
import { GET } from '@/app/api/ads/compare/route';
import { ADS_ANALYSIS_DEFAULT_POLICY } from './metrics';
import { exportAdsComparison, readAdsComparison } from './server';
import { executeAdsAnalysisTool } from './mcp';
import { buildAdsComparisonCsv } from './csv';
const actor = { userId: 'user', workspaceId: 'workspace' };
const now = new Date('2026-10-20T12:00:00Z');
const account = { id: 'a1', name: 'Exemple café', currency: 'EUR' };
const row = (level: string, objectId: string, date: string, spend: number, clicks: number, adAccount = account) => ({
  level, objectId, adAccountId: adAccount.id, objectName: '=formula', date: new Date(`${date}T00:00:00Z`), fetchedAt: now,
  spend, clicks, impressions: 1000, adAccount,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.viewer.mockResolvedValue({ user: { id: actor.userId }, workspaceId: actor.workspaceId });
  mocks.access.mockResolvedValue({ allowedTargetIds: ['target'], allowedProviders: ['test'], allowedAdAccountIds: ['a1'] });
  mocks.accounts.mockResolvedValue([account]);
  mocks.policy.mockResolvedValue({ presets: [{ id: '7d', days: 7, label: '7 days' }], defaultPreset: '7d', maxRangeDays: 30, maxFilterCharacters: 80 });
  mocks.config.mockImplementation(async (key: string) => ({
    'ads.analysisPolicy': { ...ADS_ANALYSIS_DEFAULT_POLICY, maxObjects: 1 }, 'ads.exportMaxBytes': 100000,
    'ads.detailMaxBytes': 100000, 'ads.exportFileName': 'ads.csv',
  })[key]);
  mocks.dataset.mockImplementation(async (_workspace, filters, _targets, _providers, options) => ({
    accounts: [account], maxRows: 100, pageSize: 25,
    insights: filters.since < new Date('2026-10-14')
      ? [row('account', 'a1', '2026-10-10', 10, 10), row(options.levels[1], 'one', '2026-10-10', 10, 10)]
      : [row('account', 'a1', '2026-10-19', 30, 15), row(options.levels[1], 'one', '2026-10-19', 20, 10), row(options.levels[1], 'two', '2026-10-20', 10, 5)],
  }));
});
it.each(['campaign', 'adset', 'ad'])('exports complete %s objects, exact-object baselines and daily trends', async level => {
  const result = await readAdsComparison(actor, { level }, now);
  expect(result.groups[0]!.objects).toHaveLength(1);
  expect(result.groups[0]!.totals?.spend).toBe(30);
  expect(result.groups[0]!.previous?.spend).toBe(10); // exclude prior object rows
  const object = result.groups[0]!.objects[0]!;
  expect(object.kpis.find(kpi => kpi.key === 'spend')?.current).toBe(20);
  expect(object.trend).toEqual([expect.objectContaining({ date: '2026-10-19', spend: 20, ctr: 1, cpc: 2 })]);
  const exported = await exportAdsComparison(actor, { level }, now);
  expect(exported.rowCount).toBe(2);
  expect(exported.csv).toContain('daily_trend_json');
  expect(exported.csv).toContain('spend_change_percent');
  expect(exported.csv).toContain(',10,1000,10,1,1,10,100,0,0,0,100,100,');
  expect(exported.csv).toContain('Not available');
  expect(exported.csv).toContain('"\'=formula"');
  expect(exported.byteLength).toBe(Buffer.byteLength(exported.csv));
  for (const call of mocks.dataset.mock.calls) {
    expect(call[0]).toBe(actor.workspaceId);
    expect(call[2]).toEqual(['target']);
    expect(call[3]).toEqual(['test']);
    expect(call[4].allowedAdAccountIds).toEqual(['a1']);
    expect([['account'], ['account', level]]).toContainEqual(call[4].levels);
  }
});
it('exports localized findings through the shared service and MCP with credential ceilings', async () => {
  const exported = await exportAdsComparison(actor, {}, now, { kind: 'findings', locale: 'fr' });
  expect(exported.csv).toContain('finding_key');
  expect(exported.csv).toContain('Les clics coûtent');
  expect(exported.fileName).toContain('-findings-');
  expect(exported.rowCount).toBeGreaterThan(0);
  await expect(executeAdsAnalysisTool(actor, 'compare_ads_performance', { format: 'csv', exportKind: 'findings', locale: 'fr' }, 1)).rejects.toMatchObject({ code: 'invalid_request' });
  await expect(executeAdsAnalysisTool(actor, 'compare_ads_performance', { format: 'csv' }, 1)).rejects.toMatchObject({ code: 'invalid_request' });
});
it('refuses byte overflow including UTF-8 and headers, never a partial CSV', async () => {
  const result = await readAdsComparison(actor, {}, now);
  result.groups[0]!.objectCount = result.groups[0]!.objects.length;
  const built = buildAdsComparisonCsv(result, 100000);
  expect(buildAdsComparisonCsv(result, built.byteLength).byteLength).toBe(built.byteLength);
  expect(() => buildAdsComparisonCsv(result, built.byteLength - 1)).toThrow(/size limit/);
  expect(() => buildAdsComparisonCsv(result, 1, 'findings', 'fr')).toThrow(/size limit/);
});
it('refuses authorization and invalid filters before stored reads', async () => {
  mocks.access.mockRejectedValueOnce(new Error('denied'));
  await expect(exportAdsComparison(actor, {}, now)).rejects.toThrow('denied');
  expect(mocks.dataset).not.toHaveBeenCalled();
  await expect(exportAdsComparison(actor, { accountId: 'foreign' }, now)).rejects.toThrow();
  await expect(exportAdsComparison(actor, { level: 'invalid' }, now)).rejects.toThrow();
  await expect(exportAdsComparison(actor, {}, now, { locale: 'xx' })).rejects.toThrow();
  expect(mocks.dataset).not.toHaveBeenCalled();
});
it('accounts comparison has no invented baseline and preserves separate currency groups', async () => {
  const other = { id: 'a2', name: 'Other', currency: 'USD' };
  mocks.accounts.mockResolvedValue([account, other]);
  mocks.dataset.mockResolvedValue({ accounts: [account, other], insights: [row('campaign', 'one', '2026-10-19', 10, 0), row('campaign', 'one', '2026-10-19', 20, 5, other)] });
  const result = await readAdsComparison(actor, { compare: 'accounts' }, now);
  expect(result.groups.map(group => group.currency).sort()).toEqual(['EUR', 'USD']);
  for (const group of result.groups) {
    expect(group.objects[0]!.previous).toBeNull();
    expect(group.objects[0]!.kpis.every(kpi => kpi.changePercent === null)).toBe(true);
  }
});

it('HTTP uses the same stored export and rejects repeated/invalid output options', async () => {
  const response = await GET(new Request('https://example.test/api/ads/compare?format=csv&exportKind=findings&locale=fr'));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-type')).toContain('text/csv');
  expect(await response.text()).toContain('Les clics coûtent');
  expect(mocks.access).toHaveBeenCalledWith(actor, 'ads/compare');
  for (const query of ['format=xml', 'format=csv&locale=xx', 'format=csv&level=ad&level=campaign', 'locale=fr', 'format=csv&exportKind=invalid']) {
    const rejected = await GET(new Request(`https://example.test/api/ads/compare?${query}`));
    expect(rejected.status).toBe(400);
  }
});
it('propagates the report row ceiling without producing a CSV', async () => {
  const { AdsReportLimitError } = await import('../read-policy');
  mocks.dataset.mockRejectedValue(new AdsReportLimitError());
  await expect(exportAdsComparison(actor, {}, now)).rejects.toMatchObject({ code: 'invalid_request' });
});
it('does not invent an infinite change against a zero baseline or missing daily rows', async () => {
  mocks.dataset.mockImplementation(async (_workspace, filters) => ({
    accounts: [account], insights: [row('campaign', 'one', filters.since < new Date('2026-10-14') ? '2026-10-10' : '2026-10-19', filters.since < new Date('2026-10-14') ? 0 : 20, 0)],
  }));
  const result = await exportAdsComparison(actor, {}, now);
  expect(result.csv).toContain('Not available');
  expect(result.csv).not.toContain('Infinity');
  expect(result.csv).not.toContain('2026-10-18');
});

it('enforces an MCP credential ceiling on nested exported object trend days', async () => {
  mocks.dataset.mockResolvedValue({ accounts: [account], insights: [row('campaign', 'one', '2026-10-19', 10, 5), row('campaign', 'one', '2026-10-20', 20, 10)] });
  await expect(executeAdsAnalysisTool(actor, 'compare_ads_performance', { format: 'csv', compare: 'accounts' }, 1)).rejects.toMatchObject({ code: 'invalid_request' });
});
