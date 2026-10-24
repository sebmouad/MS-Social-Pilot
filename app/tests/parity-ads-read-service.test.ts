import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ authorize: vi.fn(), accounts: vi.fn(), dataset: vi.fn(), summarize: vi.fn(), options: vi.fn(), manageable: vi.fn(), platform: vi.fn(), account: vi.fn(), where: vi.fn() }));
vi.mock('@/modules/ads/server/access', () => ({ authorizeAdsRead: m.authorize }));
vi.mock('@/modules/ads/server/queries', () => ({ getAdsAccounts: m.accounts, getAdsDataset: m.dataset, getAdsAccountWhere: m.where }));
vi.mock('@/modules/ads/server/summary', () => ({ summarizeInsights: m.summarize }));
vi.mock('@/modules/ads/server/read-policy', () => ({ loadAdsReadPolicy: async () => ({ pageSize: 2, maxRows: 20 }) }));
vi.mock('@/modules/ads/server/report-policy', () => ({ loadAdsReportPolicy: async () => ({ presets: [{ id: 'last7', label: 'Last 7 days', days: 7 }], defaultPreset: 'last7', maxDays: 365, filterMaxCharacters: 200 }) }));
vi.mock('@/modules/ads/server/actions', () => ({ canManageWorkspaceAds: m.manageable }));
vi.mock('@/server/platforms/registry', () => ({ platformAds: m.platform }));
vi.mock('@/server/data', () => ({ prisma: { adAccount: { findFirst: m.account } } }));
import { listAdsAccounts, readAdsPerformance } from '@/modules/ads/server/performance';
import { readAdsCreationOptions } from '@/modules/ads/server/creation-options';
const actor = { userId: 'u', workspaceId: 'w', allowedAdAccountIds: ['a'] };
beforeEach(() => {
  vi.clearAllMocks();
  m.authorize.mockResolvedValue({ actor, allowedTargetIds: ['channel'], allowedAdAccountIds: ['a'], allowedProviders: ['installed'] });
  m.accounts.mockResolvedValue([{ id: 'a', name: 'Sample', currency: 'USD', enabled: true, actId: 'remote', socialAccount: { accessToken: 'must-not-leak' } }]);
  m.dataset.mockResolvedValue({ insights: [], pageSize: 2 }); m.summarize.mockReturnValue([]);
  m.where.mockResolvedValue({ workspaceId: 'w', id: { in: ['a'] } });
  m.account.mockResolvedValue({ id: 'a', currency: 'USD', socialAccount: { provider: 'installed' } });
  m.manageable.mockResolvedValue(true); m.platform.mockResolvedValue({ ui: { campaign: { options: [], nameMaxLength: 30 }, adSet: { options: [] } } });
});
it('returns safe paginated accounts within fresh independent resource ceilings', async () => {
  const result = await listAdsAccounts(actor, {}, 1);
  expect(m.authorize).toHaveBeenCalledWith(actor);
  expect(m.accounts).toHaveBeenCalledWith('w', ['channel'], ['installed'], ['a']);
  expect(result.accountCount).toBe(1); expect(JSON.stringify(result)).not.toContain('must-not-leak');
  await expect(listAdsAccounts(actor, { offset: -1 })).rejects.toMatchObject({ code: 'invalid_request' });
  await expect(listAdsAccounts(actor, { workspaceId: 'other' })).rejects.toMatchObject({ code: 'invalid_request' });
});
it('shares performance filter semantics and refuses caller-controlled scope', async () => {
  const result = await readAdsPerformance(actor, {}, 1);
  expect(result.accountCount).toBe(1);
  expect(m.dataset).toHaveBeenCalledWith('w', expect.anything(), ['channel'], ['installed'], { levels: ['campaign', 'adset', 'ad'], allowedAdAccountIds: ['a'] });
  await expect(readAdsPerformance(actor, { workspaceId: 'other' }, 1)).rejects.toMatchObject({ code: 'invalid_request' });
  await expect(readAdsPerformance(actor, { offset: -1 }, 1)).rejects.toMatchObject({ code: 'invalid_request' });
});
it('returns account-specific module creation options while omitting unsupported scoped ad-set creation', async () => {
  const result = await readAdsCreationOptions(actor, { adAccountId: 'a' });
  expect(result.campaign).toMatchObject({ nameMaxLength: 30 }); expect(result.adSet).toBeNull();
  expect(m.where).toHaveBeenCalledWith('w', ['channel'], ['installed'], ['a']);
  m.manageable.mockResolvedValue(false);
  await expect(readAdsCreationOptions(actor, { adAccountId: 'a' })).rejects.toMatchObject({ code: 'unavailable' });
});
