import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ targets: vi.fn(), accounts: vi.fn(), insights: vi.fn() }));
vi.mock('../src/server/platforms/registry', () => ({ enabledSocialAccountWhere: vi.fn(async () => ({ provider: { in: ['facebook'] } })) }));
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
    const filters = parseAdsFilters({ period: '7d', account: 'ad-hidden' }, ['ad-allowed'], new Date('2026-10-15T00:00:00Z'));
    const data = await getAdsDataset('workspace-a', filters, ['target-allowed']);
    expect(data.accounts).toHaveLength(1);
    expect(db.targets).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-a', id: { in: ['target-allowed'] } }, select: { socialAccountId: true } });
    expect(db.accounts).toHaveBeenCalledWith(expect.objectContaining({ where: {
      workspaceId: 'workspace-a', enabled: true, socialAccountId: { in: ['social-allowed'] },
      socialAccount: { is: { workspaceId: 'workspace-a', invalidatedAt: null, provider: { in: ['facebook'] } } },
    } }));
    expect(db.insights).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ adAccount: { workspaceId: 'workspace-a', id: { in: ['ad-allowed'] } } }) }));
  });

  it('returns no accounts or insights for an empty channel scope', async () => {
    db.targets.mockResolvedValue([]);
    db.accounts.mockResolvedValue([]);
    await getAdsAccounts('workspace-a', []);
    expect(db.accounts).toHaveBeenCalledWith(expect.objectContaining({ where: {
      workspaceId: 'workspace-a', enabled: true, socialAccountId: { in: [] },
      socialAccount: { is: { workspaceId: 'workspace-a', invalidatedAt: null, provider: { in: ['facebook'] } } },
    } }));
    await getAdsDataset('workspace-a', parseAdsFilters({}, [], new Date('2026-10-15T00:00:00Z')), []);
    expect(db.insights).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ adAccount: { workspaceId: 'workspace-a', id: { in: [] } } }) }));
  });

  it('applies account and connection visibility even when no channel restriction is supplied', async () => {
    await getAdsAccounts('workspace-a');
    expect(db.targets).not.toHaveBeenCalled();
    expect(db.accounts).toHaveBeenCalledWith(expect.objectContaining({ where: {
      workspaceId: 'workspace-a', enabled: true,
      socialAccount: { is: { workspaceId: 'workspace-a', invalidatedAt: null, provider: { in: ['facebook'] } } },
    } }));
  });
});
