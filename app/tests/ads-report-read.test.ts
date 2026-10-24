vi.mock('@/modules/ads/server/copy', async () => { const { defaultAdsCatalogs, customerText } = await import('../src/modules/ads/copy'); return { withAdsCopySnapshot: (operation: () => Promise<unknown>) => operation(), loadAdsCopy: async () => defaultAdsCatalogs, adsServiceText: async (key: Parameters<typeof customerText>[2]) => customerText(defaultAdsCatalogs.customer, 'en', key) }; });
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: vi.fn(), accounts: vi.fn(), dataset: vi.fn(), reportPolicy: vi.fn(), outputPolicy: vi.fn(), readPolicy: vi.fn(), normalize: vi.fn() }));
vi.mock('../src/modules/ads/server/access', () => ({ authorizeAdsRead: state.access }));
vi.mock('@/modules/ads/server/queries', () => ({ getAdsAccounts: state.accounts, getAdsDataset: state.dataset }));
vi.mock('../src/modules/ads/server/report-policy', () => ({ loadAdsReportPolicy: state.reportPolicy }));
vi.mock('../src/modules/ads/server/read-policy', () => ({ loadAdsReadPolicy: state.readPolicy }));
vi.mock('../src/modules/ads/server/output-policy', () => ({ loadAdsOutputPolicy: state.outputPolicy }));
vi.mock('../src/modules/ads/report-data', () => ({ normalizeAdsDailyRow: state.normalize }));

import { readAdsDailyRows } from '../src/modules/ads/server/report-read';

const row = { id: 'i1', adAccountId: 'account-a', level: 'campaign', objectId: 'campaign-a', objectName: 'Campaign A', date: new Date('2026-10-15T00:00:00Z'), adAccount: { id: 'account-a', name: 'Account A', currency: 'USD' } };
const resultPolicy = { presets: [{ id: '7d', days: 7, label: 'Last 7 days' }], defaultPreset: '7d', maxRangeDays: 30, maxFilterCharacters: 80 };

describe('Ads daily report read service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.access.mockResolvedValue({ actor: { userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: ['target-a'] }, allowedTargetIds: ['target-a'], allowedProviders: ['facebook'] });
    state.accounts.mockResolvedValue([{ id: 'account-a' }]);
    state.reportPolicy.mockResolvedValue(resultPolicy);
    state.outputPolicy.mockResolvedValue({ detailMaxBytes: 1048576, exportMaxBytes: 10485760, exportFileName: 'ads-report.csv' });
    state.readPolicy.mockResolvedValue({ pageSize: 25, maxRows: 100 });
    state.normalize.mockImplementation((value: unknown) => ({ ...(value as Record<string, unknown>), date: '2026-10-15' }));
    state.dataset.mockResolvedValue({ insights: [row], pageSize: 25, maxRows: 100 });
  });

  it('validates strict filters and pagination, applies scoped levels before reads, then returns normalized complete page metadata', async () => {
    const result = await readAdsDailyRows({ userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: ['target-a'] }, { period: 'custom', start: '2026-10-15', end: '2026-10-15', accountId: 'account-a', level: 'campaign', objectId: 'campaign-a', offset: 0, limit: 10 }, { maxItems: 1 });
    expect(state.dataset).toHaveBeenCalledWith('workspace-a', expect.objectContaining({ accountId: 'account-a' }), ['target-a'], ['facebook'], { levels: ['campaign'], objectId: 'campaign-a' });
    expect(result).toMatchObject({ format: 'ms-social-pilot-ads-daily', version: 1, resultCount: 1, offset: 0, limit: 1, rows: [{ date: '2026-10-15' }], range: { from: '2026-10-15', to: '2026-10-16', endExclusive: true } });
  });

  it.each([
    { objectId: 'campaign-a' }, { level: 'campaign', objectId: '' }, { level: 'campaign', objectId: 'x'.repeat(81), accountId: 'account-a' },
    { offset: -1 }, { limit: 0 }, { limit: 1.5 }, { limit: '10' }, { extra: 'scope' }, { start: '2026-10-01', period: '7d' },
  ])('rejects malformed or unbound input before querying insights: %j', async input => {
    await expect(readAdsDailyRows({ userId: 'user-a', workspaceId: 'workspace-a' }, input)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.dataset).not.toHaveBeenCalled();
  });

  it('defaults to every daily level and sorts the full result stably before paging', async () => {
    const later = { ...row, id: 'i2', level: 'account', objectId: 'account-a', date: new Date('2026-10-16T00:00:00Z') };
    state.dataset.mockResolvedValue({ insights: [row, later], pageSize: 25, maxRows: 100 });
    state.normalize.mockImplementation((value: unknown) => ({ ...(value as Record<string, unknown>), date: (value as typeof row).date.toISOString().slice(0, 10) }));
    const result = await readAdsDailyRows({ userId: 'user-a', workspaceId: 'workspace-a' });
    expect(state.dataset).toHaveBeenCalledWith('workspace-a', expect.any(Object), ['target-a'], ['facebook'], {});
    expect(result.rows.map(item => item.id)).toEqual(['i2', 'i1']);
    expect(result.resultCount).toBe(2);
  });

  it('requires the account to remain visible in the authorized provider and target scope', async () => {
    state.accounts.mockResolvedValue([]);
    await expect(readAdsDailyRows({ userId: 'user-a', workspaceId: 'workspace-a' }, { accountId: 'account-a' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(state.dataset).not.toHaveBeenCalled();
  });

  it('refuses full detail payloads above the configured byte limit instead of returning partial rows', async () => {
    state.outputPolicy.mockResolvedValue({ detailMaxBytes: 1024, exportMaxBytes: 10485760, exportFileName: 'ads-report.csv' });
    state.normalize.mockReturnValue({ fields: { oversized: 'x'.repeat(2000) } });
    await expect(readAdsDailyRows({ userId: 'user-a', workspaceId: 'workspace-a' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
