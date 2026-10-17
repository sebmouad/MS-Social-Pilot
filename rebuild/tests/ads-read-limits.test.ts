import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ targets: vi.fn(), accounts: vi.fn(), insights: vi.fn() }));
const settings = vi.hoisted(() => ({ values: new Map<string, unknown>(), failure: undefined as unknown }));

vi.mock('../src/server/data', () => ({ prisma: {
  target: { findMany: db.targets },
  adAccount: { findMany: db.accounts },
  adInsight: { findMany: db.insights },
} }));
vi.mock('../src/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: vi.fn(async (_workspaceId: string, providers: readonly string[]) => ({ provider: { in: [...providers] }, enabled: true })) }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: vi.fn(async (key: string) => {
  if (settings.failure) throw settings.failure;
  return settings.values.get(key);
}) }));

import { ADS_CONFIG } from '../src/modules/ads/config';
import { loadAdsReadPolicy } from '../src/modules/ads/server/read-policy';
import { getAdsDataset, parseAdsFilters } from '../src/server/ads/queries';

describe('bounded stored Ads reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settings.values = new Map([['ads.reportPageSize', 25], ['ads.reportMaxRows', 20000]]);
    settings.failure = undefined;
    db.targets.mockResolvedValue([{ socialAccountId: 'social-a' }]);
    db.accounts.mockResolvedValue([{ id: 'ad-a', socialAccountId: 'social-a' }]);
    db.insights.mockResolvedValue([]);
  });

  it('declares bounded active Ads reporting controls with one schema each', () => {
    expect(ADS_CONFIG.filter(setting => ['ads.reportPageSize', 'ads.reportMaxRows'].includes(setting.key))).toMatchObject([
      { key: 'ads.reportPageSize', group: 'Ads · Reporting', kind: 'number', defaultValue: 25, consumption: 'active' },
      { key: 'ads.reportMaxRows', group: 'Ads · Reporting', kind: 'number', defaultValue: 20000, consumption: 'active' },
    ]);
    expect(ADS_CONFIG.find(setting => setting.key === 'ads.reportPageSize')?.schema.safeParse(1).success).toBe(true);
    expect(ADS_CONFIG.find(setting => setting.key === 'ads.reportPageSize')?.schema.safeParse(101).success).toBe(false);
    expect(ADS_CONFIG.find(setting => setting.key === 'ads.reportMaxRows')?.schema.safeParse(1).success).toBe(true);
    expect(ADS_CONFIG.find(setting => setting.key === 'ads.reportMaxRows')?.schema.safeParse(100001).success).toBe(false);
  });

  it('loads the stored page and row bounds from the active Root settings', async () => {
    settings.values = new Map([['ads.reportPageSize', 40], ['ads.reportMaxRows', 300]]);
    await expect(loadAdsReadPolicy()).resolves.toEqual({ pageSize: 40, maxRows: 300 });
  });

  it('fails closed with customer-safe text when Root read limits are unavailable or invalid', async () => {
    settings.failure = new Error('database secret detail');
    await expect(loadAdsReadPolicy()).rejects.toMatchObject({ name: 'OperationError', message: expect.not.stringContaining('database secret detail') });
    settings.failure = undefined;
    settings.values.set('ads.reportPageSize', 0);
    await expect(loadAdsReadPolicy()).rejects.toMatchObject({ name: 'OperationError' });
  });

  it('requests one row beyond the configured maximum and accepts exactly the maximum', async () => {
    settings.values.set('ads.reportMaxRows', 2);
    const filters = parseAdsFilters({ period: '7d' }, ['ad-a'], new Date('2026-10-15T00:00:00Z'));
    db.insights.mockResolvedValue([{ id: 'i1' }, { id: 'i2' }]);
    const result = await getAdsDataset('workspace-a', filters, ['target-a'], ['facebook']);
    expect(db.insights).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    expect(result.insights).toHaveLength(2);
    expect(result.pageSize).toBe(25);
  });

  it('rejects over-limit reads before returning partial rows', async () => {
    settings.values.set('ads.reportMaxRows', 2);
    const filters = parseAdsFilters({ period: '7d' }, ['ad-a'], new Date('2026-10-15T00:00:00Z'));
    db.insights.mockResolvedValue([{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }]);
    await expect(getAdsDataset('workspace-a', filters, ['target-a'], ['facebook'])).rejects.toMatchObject({
      name: 'AdsReportLimitError', code: 'invalid_request',
      message: 'Too much report data for one request. Choose fewer accounts or a shorter date range. No results were loaded.',
    });
  });

  it('does not query accounts or insights when the active policy cannot be loaded', async () => {
    settings.failure = new Error('database unavailable');
    const filters = parseAdsFilters({}, ['ad-a']);
    await expect(getAdsDataset('workspace-a', filters, ['target-a'], ['facebook'])).rejects.toMatchObject({ name: 'OperationError' });
    expect(db.accounts).not.toHaveBeenCalled();
    expect(db.insights).not.toHaveBeenCalled();
  });

  it('reapplies selected, enabled connection scope to the insight account relation', async () => {
    const filters = parseAdsFilters({}, ['ad-a']);
    await getAdsDataset('workspace-a', filters, ['target-a'], ['facebook']);
    const args = db.insights.mock.calls[0]?.[0];
    expect(args.where.adAccount).toMatchObject({
      workspaceId: 'workspace-a', id: { in: ['ad-a'] }, enabled: true,
      socialAccount: { is: { provider: { in: ['facebook'] }, enabled: true } },
      socialAccountId: { in: ['social-a'] },
    });
  });

  it('rejects an empty or unknown level filter before reading accounts', async () => {
    const filters = parseAdsFilters({}, ['ad-a']);
    await expect(getAdsDataset('workspace-a', filters, ['target-a'], ['facebook'], { levels: [] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(getAdsDataset('workspace-a', filters, ['target-a'], ['facebook'], { levels: ['unknown' as 'account'] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(getAdsDataset('workspace-a', filters, ['target-a'], ['facebook'], { levels: 'campaign' as unknown as readonly ('account' | 'campaign' | 'adset' | 'ad')[] })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(db.accounts).not.toHaveBeenCalled();
  });

  it('applies the trusted level scope in the database query before the row cap', async () => {
    const filters = parseAdsFilters({}, ['ad-a']);
    await getAdsDataset('workspace-a', filters, ['target-a'], ['facebook'], { levels: ['campaign', 'adset', 'ad'] });
    expect(db.insights).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ level: { in: ['campaign', 'adset', 'ad'] } }),
      take: 20001,
    }));
  });
});
