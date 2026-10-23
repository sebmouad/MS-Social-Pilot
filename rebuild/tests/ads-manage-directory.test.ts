vi.mock('../src/modules/ads/server/object-store', () => ({ listStoredAdObjects: vi.fn(async () => []), findStoredAdObject: vi.fn(async () => null) }));
import { ADS_MANAGEMENT_DEFAULT_POLICY } from '../src/modules/ads/management/config';
vi.mock('@/modules/ads/server/copy', async () => { const { defaultAdsCatalogs, customerText } = await import('../src/modules/ads/copy'); return { withAdsCopySnapshot: (operation: () => Promise<unknown>) => operation(), loadAdsCopy: async () => defaultAdsCatalogs, adsServiceText: async (key: Parameters<typeof customerText>[2]) => customerText(defaultAdsCatalogs.customer, 'en', key) }; });
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: vi.fn(), accounts: vi.fn(), dataset: vi.fn(), reportPolicy: vi.fn(), readPolicy: vi.fn(), config: vi.fn(), platformAds: vi.fn() }));
vi.mock('../src/modules/ads/server/access', () => ({ authorizeAdsRead: state.access }));
vi.mock('@/modules/ads/server/queries', () => ({ getAdsAccounts: state.accounts, getAdsDataset: state.dataset }));
vi.mock('../src/modules/ads/server/report-policy', () => ({ loadAdsReportPolicy: state.reportPolicy }));
vi.mock('../src/modules/ads/server/read-policy', () => ({ loadAdsReadPolicy: state.readPolicy }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('../src/server/platforms/registry', () => ({ platformAds: state.platformAds }));

import { listStoredAdObjects } from '../src/modules/ads/server/object-store';
import { ADS_ANALYSIS_DEFAULT_POLICY } from '../src/modules/ads/analysis/metrics';
import { readAdsDirectory } from '../src/modules/ads/directory/server';

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const row = (objectId: string, name: string, date: string, spend: number, accountId = 'a1') => ({
  adAccountId: accountId, level: 'adset', objectId, objectName: name, date: day(date), fetchedAt: new Date('2026-10-17T06:00:00Z'), spend, impressions: 100, clicks: 5, fields: null,
  adAccount: { id: accountId, name: `Account ${accountId}`, currency: 'USD' },
});
const actor = { userId: 'u1', workspaceId: 'w1' };
const now = new Date('2026-10-17T12:00:00Z');

describe('manage directory status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.access.mockResolvedValue({ actor, allowedTargetIds: ['t1'], allowedProviders: ['facebook'] });
    state.accounts.mockResolvedValue([{ id: 'a1', name: 'Account a1', currency: 'USD', socialAccount: { provider: 'test-platform' } }]);
    state.platformAds.mockResolvedValue(null);
    state.reportPolicy.mockResolvedValue({ presets: [{ id: '7d', days: 7, label: 'Last 7 days' }], defaultPreset: '7d', maxRangeDays: 30, maxFilterCharacters: 80 });
    state.readPolicy.mockResolvedValue({ pageSize: 10, maxRows: 100 });
    state.config.mockImplementation(async (key: string) => key === 'ads.managementPolicy' ? ADS_MANAGEMENT_DEFAULT_POLICY : ADS_ANALYSIS_DEFAULT_POLICY);
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 10, maxRows: 100, insights: [
      row('s1', 'Spring', '2026-10-12', 10), row('s3', 'Autumn', '2026-10-12', 0),
    ] });
    vi.mocked(listStoredAdObjects).mockResolvedValue([
      { adAccountId: 'a1', level: 'adset', objectId: 's1', name: 'Spring launch', parentId: 'c9', status: 'paused', fetchedAt: new Date('2026-10-16T06:00:00Z') },
      { adAccountId: 'a1', level: 'adset', objectId: 's9', name: 'Held set', parentId: 'c9', status: 'active', fetchedAt: new Date('2026-10-16T06:00:00Z') },
    ]);
  });

  it('carries the stored status into rows with and without delivery', async () => {
    const page = await readAdsDirectory(actor, { level: 'adset', sort: 'name' }, now);
    expect(page.items).toHaveLength(3);
    expect(page.items.find(item => item.objectId === 's1')).toMatchObject({ name: 'Spring launch', parentId: 'c9', status: 'paused', spend: 10 });
    expect(page.items.find(item => item.objectId === 's3')).toMatchObject({ status: null });
    expect(page.items.find(item => item.objectId === 's9')).toMatchObject({ name: 'Held set', status: 'active', spend: 0, lastDeliveryDate: null });
  });

  it('refuses unknown levels, sorts and directions', async () => {
    await expect(readAdsDirectory(actor, { level: 'creative' }, now)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readAdsDirectory(actor, { level: 'adset', sort: 'budget' }, now)).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(readAdsDirectory(actor, { level: 'adset', direction: 'sideways' }, now)).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
