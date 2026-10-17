import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ targets: vi.fn(), accounts: vi.fn(), insights: vi.fn() }));
const readPolicy = vi.hoisted(() => vi.fn(async () => ({ pageSize: 25, maxRows: 20000 })));
vi.mock('../src/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: vi.fn(async (_workspaceId: string, providers: readonly string[]) => ({ provider: { in: [...providers] } })) }));
vi.mock('../src/modules/ads/server/read-policy', () => ({ loadAdsReadPolicy: readPolicy }));
vi.mock('../src/server/data', () => ({ prisma: {
  target: { findMany: db.targets },
  adAccount: { findMany: db.accounts },
  adInsight: { findMany: db.insights },
} }));

import { getAdsAccounts, getAdsDataset, parseAdsFilters } from '../src/server/ads/queries';

describe('Ads channel scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.targets.mockResolvedValue([{ socialAccountId: 'social-allowed' }]);
    db.accounts.mockResolvedValue([{ id: 'ad-allowed', socialAccountId: 'social-allowed' }]);
    db.insights.mockResolvedValue([]);
  });

  it('derives account visibility from permitted workspace targets and bounds insight reads', async () => {
    const filters = parseAdsFilters({ period: '7d', account: 'ad-allowed' }, ['ad-allowed'], new Date('2026-10-15T00:00:00Z'));
    const data = await getAdsDataset('workspace-a', filters, ['target-allowed'], ['facebook']);
    expect(data.accounts).toHaveLength(1);
    expect(db.targets).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-a', id: { in: ['target-allowed'] } }, select: { socialAccountId: true } });
    expect(db.accounts).toHaveBeenCalledWith(expect.objectContaining({ where: {
      workspaceId: 'workspace-a', enabled: true, socialAccountId: { in: ['social-allowed'] },
      socialAccount: { is: { provider: { in: ['facebook'] } } },
    } }));
    expect(db.insights).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ adAccount: {
      workspaceId: 'workspace-a', enabled: true, id: { in: ['ad-allowed'] },
      socialAccount: { is: { provider: { in: ['facebook'] } } }, socialAccountId: { in: ['social-allowed'] },
    } }) }));
  });

  it('keeps the mandatory account intersection even for a directly supplied unavailable selection', async () => {
    const filters = { ...parseAdsFilters({}, ['ad-allowed']), accountId: 'ad-hidden' };
    await getAdsDataset('workspace-a', filters, ['target-allowed'], ['facebook']);
    expect(db.insights).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ adAccount: expect.objectContaining({ workspaceId: 'workspace-a', id: { in: [] }, enabled: true }) }) }));
  });

  it('returns no accounts or insights for an empty channel scope', async () => {
    db.targets.mockResolvedValue([]);
    db.accounts.mockResolvedValue([]);
    await getAdsAccounts('workspace-a', [], []);
    expect(db.accounts).toHaveBeenCalledWith(expect.objectContaining({ where: {
      workspaceId: 'workspace-a', enabled: true, socialAccountId: { in: [] },
      socialAccount: { is: { provider: { in: [] } } },
    } }));
    await getAdsDataset('workspace-a', parseAdsFilters({}, [], new Date('2026-10-15T00:00:00Z')), [], []);
    expect(db.insights).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ adAccount: expect.objectContaining({ workspaceId: 'workspace-a', id: { in: [] }, enabled: true }) }) }));
  });

  it('applies account and connection visibility even when no channel restriction is supplied', async () => {
    await getAdsAccounts('workspace-a', undefined, ['facebook']);
    expect(db.targets).not.toHaveBeenCalled();
    expect(db.accounts).toHaveBeenCalledWith(expect.objectContaining({ where: {
      workspaceId: 'workspace-a', enabled: true,
      socialAccount: { is: { provider: { in: ['facebook'] } } },
    } }));
  });
  it('threads only entitled providers into the selected account predicate', async () => {
    await getAdsAccounts('workspace-a', undefined, []);
    expect(db.accounts).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ socialAccount: { is: { provider: { in: [] } } } }) }));
  });
});
