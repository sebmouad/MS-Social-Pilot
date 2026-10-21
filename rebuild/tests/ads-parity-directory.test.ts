import { ADS_MANAGEMENT_DEFAULT_POLICY } from '../src/modules/ads/management/config';
vi.mock('@/modules/ads/server/copy', async () => { const { defaultAdsCatalogs, customerText } = await import('../src/modules/ads/copy'); return { withAdsCopySnapshot: (operation: () => Promise<unknown>) => operation(), loadAdsCopy: async () => defaultAdsCatalogs, adsServiceText: async (key: Parameters<typeof customerText>[2]) => customerText(defaultAdsCatalogs.customer, 'en', key) }; });
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: vi.fn(), accounts: vi.fn(), dataset: vi.fn(), reportPolicy: vi.fn(), readPolicy: vi.fn(), config: vi.fn(), live: vi.fn(), describe: vi.fn(), platformAds: vi.fn() }));
vi.mock('../src/modules/ads/server/access', () => ({ authorizeAdsRead: state.access }));
vi.mock('@/modules/ads/server/queries', () => ({ getAdsAccounts: state.accounts, getAdsDataset: state.dataset }));
vi.mock('@/modules/ads/server/actions', () => ({ readWorkspaceAdObject: state.live }));
vi.mock('../src/modules/ads/server/report-policy', () => ({ loadAdsReportPolicy: state.reportPolicy }));
vi.mock('../src/modules/ads/server/read-policy', () => ({ loadAdsReadPolicy: state.readPolicy }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
vi.mock('../src/modules/ads/directory/management-port', () => ({ adsDirectoryManagementPort: () => ({ describe: state.describe, listChanges: vi.fn() }) }));
vi.mock('../src/server/platforms/registry', () => ({ platformAds: state.platformAds }));

import { ADS_ANALYSIS_DEFAULT_POLICY } from '../src/modules/ads/analysis/metrics';
import { readAdsDirectory, readAdsObjectDetail } from '../src/modules/ads/directory/server';
import { executeAdsDirectoryTool } from '../src/modules/ads/directory/mcp';

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const row = (objectId: string, name: string, date: string, spend: number, clicks: number, fields: unknown = null, accountId = 'a1') => ({
  adAccountId: accountId, level: 'adset', objectId, objectName: name, date: day(date), fetchedAt: new Date('2026-10-17T06:00:00Z'), spend, impressions: clicks * 100, clicks, fields,
  adAccount: { id: accountId, name: `Account ${accountId}`, currency: 'USD' },
});
const actor = { userId: 'u1', workspaceId: 'w1' };
const now = new Date('2026-10-17T12:00:00Z');

describe('Ads object directory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.access.mockResolvedValue({ actor, allowedTargetIds: ['t1'], allowedProviders: ['facebook'] });
    state.accounts.mockResolvedValue([{ id: 'a1', name: 'Account a1', currency: 'USD', socialAccount: { provider: 'test-platform' } }]);
    state.platformAds.mockResolvedValue({ parentObjectId: ({ level, fields }: { level: string; fields: unknown }) => level === 'adset' && fields && typeof fields === 'object' ? ((fields as Record<string, unknown>).parentRef as string | undefined) ?? null : null });
    state.reportPolicy.mockResolvedValue({ presets: [{ id: '7d', days: 7, label: 'Last 7 days' }], defaultPreset: '7d', maxRangeDays: 30, maxFilterCharacters: 80 });
    state.readPolicy.mockResolvedValue({ pageSize: 2, maxRows: 100 });
    state.config.mockImplementation(async (key: string) => key === 'ads.managementPolicy' ? ADS_MANAGEMENT_DEFAULT_POLICY : ADS_ANALYSIS_DEFAULT_POLICY);
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 2, maxRows: 100, insights: [
      row('s1', 'Spring', '2026-10-12', 10, 5, { campaign_id: 'ignored', parentRef: 'c1' }), row('s1', 'Spring', '2026-10-13', 5, 5, { campaign_id: 'ignored', parentRef: 'c1' }),
      row('s2', 'Summer', '2026-10-12', 50, 1, { campaign_id: 'ignored', parentRef: 'c2' }), row('s3', 'Autumn', '2026-10-12', 0, 0),
    ] });
  });

  it('aggregates per object, sorts, pages and reads only the scoped level', async () => {
    const page = await readAdsDirectory(actor, { level: 'adset', period: 'custom', start: '2026-10-10', end: '2026-10-16' }, now);
    expect(state.dataset).toHaveBeenCalledWith('w1', expect.anything(), ['t1'], ['facebook'], { levels: ['adset'] });
    expect(page.total).toBe(3);
    expect(page.items.map(item => item.objectId)).toEqual(['s2', 's1']);
    expect(page.items[1]).toMatchObject({ spend: 15, clicks: 10, parentId: 'c1', lastDeliveryDate: '2026-10-13' });
    expect(page.nextOffset).toBe(2);
    const second = await readAdsDirectory(actor, { level: 'adset', offset: 2 }, now);
    expect(second.items.map(item => item.objectId)).toEqual(['s3']);
    expect(second.items[0]!.lastDeliveryDate).toBeNull();
  });

  it('filters by parent and literal search', async () => {
    expect((await readAdsDirectory(actor, { level: 'adset', parentId: 'c2' }, now)).items.map(item => item.objectId)).toEqual(['s2']);
    expect((await readAdsDirectory(actor, { level: 'adset', q: 'SUM.*' }, now)).total).toBe(0);
    expect((await readAdsDirectory(actor, { level: 'adset', q: 'aut' }, now)).items.map(item => item.objectId)).toEqual(['s3']);
  });

  it('uses the provider neutral relation resolver and reports missing hosts', async () => {
    const filtered = await readAdsDirectory(actor, { level: 'adset', parentId: 'c1' }, now);
    expect(filtered.items.map(item => item.objectId)).toEqual(['s1']);
    state.platformAds.mockResolvedValueOnce(null);
    const withoutHost = await readAdsDirectory(actor, { level: 'adset' }, now);
    expect(withoutHost.parentLinks).toBe('unavailable');
  });

  it.each([[{ level: 'account' }], [{ parentId: 'bad id!' }], [{ limit: 0 }], [{ limit: '5' }], [{ offset: -1 }], [{ sort: 'reach' }], [{ extra: true }], [null]])('rejects %j before reading', async input => {
    await expect(readAdsDirectory(actor, input, now)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(state.dataset).not.toHaveBeenCalled();
  });

  it('does not read data when authorization fails', async () => {
    state.access.mockRejectedValue(Object.assign(new Error('denied'), { code: 'forbidden' }));
    await expect(readAdsDirectory(actor, {}, now)).rejects.toThrow('denied');
    expect(state.dataset).not.toHaveBeenCalled();
  });

  it('shows object detail with live status and only the changes available at that level', async () => {
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 2, maxRows: 100, insights: [row('s1', 'Spring', '2026-10-12', 10, 5)] });
    state.live.mockResolvedValue({ configuredStatus: 'PAUSED', effectiveStatus: 'PAUSED' });
    state.describe.mockResolvedValue({ canManage: true, operations: [{ id: 'status.set', objectTypes: ['adset'], spendChanging: true, label: 'x' }, { id: 'creative.assign', objectTypes: ['ad'], spendChanging: false, label: 'y' }] });
    const detail = await readAdsObjectDetail(actor, { accountId: 'a1', level: 'adset', objectId: 's1' }, now);
    expect(state.dataset).toHaveBeenCalledWith('w1', expect.anything(), ['t1'], ['facebook'], { levels: ['adset'], objectId: 's1' });
    expect(detail.live).toEqual({ available: true, configuredStatus: 'PAUSED', effectiveStatus: 'PAUSED' });
    expect(detail.management.operations.map(op => op.id)).toEqual(['status.set']);
  });

  it('keeps stored figures when live status fails and 404s unknown objects', async () => {
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 2, maxRows: 100, insights: [row('s1', 'Spring', '2026-10-12', 10, 5)] });
    state.live.mockRejectedValue(new Error('provider down with secret'));
    state.describe.mockResolvedValue({ canManage: false, operations: [] });
    const detail = await readAdsObjectDetail(actor, { accountId: 'a1', level: 'adset', objectId: 's1' }, now);
    expect(detail.live).toEqual({ available: false });
    expect(JSON.stringify(detail)).not.toContain('secret');
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 2, maxRows: 100, insights: [] });
    await expect(readAdsObjectDetail(actor, { accountId: 'a1', level: 'adset', objectId: 'zzz' }, now)).rejects.toMatchObject({ code: 'not_found' });
    await expect(readAdsObjectDetail(actor, { accountId: 'a1', level: 'adset' }, now)).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('keeps scoped read detail available when management host metadata fails', async () => {
    state.dataset.mockResolvedValue({ accounts: [], pageSize: 2, maxRows: 100, insights: [row('s1', 'Spring', '2026-10-12', 10, 5)] });
    state.live.mockResolvedValue({ configuredStatus: null, effectiveStatus: null });
    state.describe.mockRejectedValue(new Error('management ledger not installed'));
    const detail = await readAdsObjectDetail(actor, { accountId: 'a1', level: 'adset', objectId: 's1' }, now);
    expect(state.dataset).toHaveBeenCalledWith('w1', expect.anything(), ['t1'], ['facebook'], { levels: ['adset'], objectId: 's1' });
    expect(detail.management).toEqual({ available: false, canManage: false, operations: [] });
    expect(detail.daily).toHaveLength(1);
  });

  it('dispatches MCP tools', async () => {
    await expect(executeAdsDirectoryTool(actor, 'list_ads_objects', { level: 'adset' })).resolves.toMatchObject({ level: 'adset' });
    await expect(executeAdsDirectoryTool(actor, 'x', {})).rejects.toMatchObject({ code: 'invalid_request' });
  });
it('enforces the same non-default parent identifier bound for directory and MCP reads', async () => {
  state.config.mockImplementation(async (key: string) => key === 'ads.managementPolicy' ? { ...ADS_MANAGEMENT_DEFAULT_POLICY, parentIdMaxCharacters: 2 } : ADS_ANALYSIS_DEFAULT_POLICY);
  await expect(readAdsDirectory(actor, { parentId: 'abc' }, now)).rejects.toMatchObject({ code: 'invalid_request' });
  await expect(executeAdsDirectoryTool(actor, 'list_ads_objects', { parentId: 'abc' })).rejects.toMatchObject({ code: 'invalid_request' });
});

});
