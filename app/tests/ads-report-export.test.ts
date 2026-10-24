vi.mock('@/modules/ads/server/copy', async () => { const { defaultAdsCatalogs, customerText } = await import('../src/modules/ads/copy'); return { withAdsCopySnapshot: (operation: () => Promise<unknown>) => operation(), loadAdsCopy: async () => defaultAdsCatalogs, adsServiceText: async (key: Parameters<typeof customerText>[2]) => customerText(defaultAdsCatalogs.customer, 'en', key) }; });
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: vi.fn(), accounts: vi.fn(), dataset: vi.fn(), reportPolicy: vi.fn(), outputPolicy: vi.fn(), readPolicy: vi.fn(), normalize: vi.fn(), csv: vi.fn() }));
vi.mock('../src/modules/ads/server/access', () => ({ authorizeAdsRead: state.access }));
vi.mock('@/modules/ads/server/queries', () => ({ getAdsAccounts: state.accounts, getAdsDataset: state.dataset }));
vi.mock('../src/modules/ads/server/report-policy', () => ({ loadAdsReportPolicy: state.reportPolicy }));
vi.mock('../src/modules/ads/server/read-policy', () => ({ loadAdsReadPolicy: state.readPolicy }));
vi.mock('../src/modules/ads/server/output-policy', () => ({ loadAdsOutputPolicy: state.outputPolicy }));
vi.mock('../src/modules/ads/report-data', () => ({ normalizeAdsDailyRow: state.normalize }));
vi.mock('../src/modules/ads/report-csv', () => ({ buildAdsReportCsv: state.csv }));

import { exportAdsReport } from '../src/modules/ads/server/export';
import { ADS_CONFIG } from '../src/modules/ads/config';

const row = { id: 'i1', adAccountId: 'account-a', level: 'campaign', objectId: 'campaign-a', objectName: 'Campaign A', date: new Date('2026-10-15T00:00:00Z'), adAccount: { id: 'account-a', name: 'Account A', currency: 'USD' } };
const reportPolicy = { presets: [{ id: '7d', days: 7, label: 'Last 7 days' }], defaultPreset: '7d', maxRangeDays: 30, maxFilterCharacters: 80 };

describe('Ads CSV export service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.access.mockResolvedValue({ allowedTargetIds: ['target-a'], allowedProviders: ['facebook'] });
    state.accounts.mockResolvedValue([{ id: 'account-a' }]);
    state.reportPolicy.mockResolvedValue(reportPolicy);
    state.readPolicy.mockResolvedValue({ pageSize: 25, maxRows: 100 });
    state.outputPolicy.mockResolvedValue({ detailMaxBytes: 1048576, exportMaxBytes: 1024, exportFileName: 'ads-report.csv' });
    state.normalize.mockReturnValue({ redactedPaths: [] });
    state.dataset.mockResolvedValue({ insights: [row], pageSize: 25, maxRows: 100 });
    state.csv.mockReturnValue({ csv: 'header\r\nrow\r\n', rowCount: 1, byteLength: 14 });
  });

  it('exports the complete normalized dataset and returns the configured filename and receipt metadata', async () => {
    const result = await exportAdsReport({ userId: 'user-a', workspaceId: 'workspace-a' }, { period: 'custom', start: '2026-10-15', end: '2026-10-15', accountId: 'account-a', level: 'campaign' });
    expect(state.dataset).toHaveBeenCalledWith('workspace-a', expect.any(Object), ['target-a'], ['facebook'], { levels: ['campaign'] });
    expect(state.csv).toHaveBeenCalledWith([{ redactedPaths: [] }], 1024);
    expect(result).toMatchObject({ format: 'ms-social-pilot-ads-csv', version: 1, csv: 'header\r\nrow\r\n', fileName: 'ads-report.csv', rowCount: 1, byteLength: 14, range: { from: '2026-10-15', to: '2026-10-16', endExclusive: true }, sensitiveFieldsRedacted: 0 });
  });

  it('rejects oversized item scopes in full instead of truncating CSV rows', async () => {
    state.dataset.mockResolvedValue({ insights: [row, row], pageSize: 25, maxRows: 100 });
    await expect(exportAdsReport({ userId: 'user-a', workspaceId: 'workspace-a' }, {}, { maxItems: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.csv).not.toHaveBeenCalled();
  });

  it('rejects offset and limit input instead of exporting a partial page', async () => {
    await expect(exportAdsReport({ userId: 'user-a', workspaceId: 'workspace-a' }, { offset: 0, limit: 10 })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.dataset).not.toHaveBeenCalled();
  });

  it('declares strict active Root controls and loads validated values without exposing setup errors', async () => {
    expect(ADS_CONFIG.filter(setting => ['ads.detailMaxBytes', 'ads.exportMaxBytes', 'ads.exportFileName'].includes(setting.key)))
      .toMatchObject([
        { key: 'ads.detailMaxBytes', defaultValue: 1048576, consumption: 'active' },
        { key: 'ads.exportMaxBytes', defaultValue: 10485760, consumption: 'active' },
        { key: 'ads.exportFileName', defaultValue: 'ads-report.csv', consumption: 'active' },
      ]);
    const settings: Record<string, unknown> = { 'ads.detailMaxBytes': 2048, 'ads.exportMaxBytes': 4096, 'ads.exportFileName': 'monthly.csv' };
    const { loadAdsOutputPolicy } = await vi.importActual<typeof import('../src/modules/ads/server/output-policy')>('../src/modules/ads/server/output-policy');
    const readConfig = async (key: string): Promise<unknown> => settings[key];
    await expect(loadAdsOutputPolicy(readConfig as never))
      .resolves.toEqual({ detailMaxBytes: 2048, exportMaxBytes: 4096, exportFileName: 'monthly.csv' });
    await expect(loadAdsOutputPolicy(async () => { throw new Error('private setting failure'); }))
      .rejects.toMatchObject({ code: 'unavailable', message: 'Ads reports are temporarily unavailable. Try again later.' });
  });
});
