import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  targets: vi.fn(), adAccounts: vi.fn(), pageInsights: vi.fn(), adInsights: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: {
  target: { findMany: db.targets }, adAccount: { findMany: db.adAccounts },
  pageInsight: { findMany: db.pageInsights }, adInsight: { findMany: db.adInsights },
} }));

import { facebookAnalyticsHost } from '../src/platforms/facebook/analytics';

const page = (id: string, socialAccountId: string) => ({ id, name: id, type: 'page', providerId: id, socialAccountId });
const account = { id: 'ad-a', name: 'Ad account A', currency: 'USD' };

describe('Facebook analytics selection reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.targets.mockResolvedValue([page('page-a', 'source-a'), page('page-b', 'source-b')]);
    db.adAccounts.mockResolvedValue([account]);
    db.pageInsights.mockResolvedValue([]);
    db.adInsights.mockResolvedValue([]);
  });

  it('can read selected ad accounts without selected channels for an unscoped owner', async () => {
    db.targets.mockResolvedValue([]);
    const result = await facebookAnalyticsHost.load({ workspaceId: 'w', range: { from: new Date('2026-10-01'), to: new Date('2026-10-31') }, selectedTargetIds: [], selectedAdAccountIds: ['ad-a'] });
    expect(db.adAccounts).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'w', enabled: true }) }));
    expect(db.adAccounts.mock.calls[0]![0].where).not.toHaveProperty('socialAccountId');
    expect(result.selectedAdAccountIds).toEqual(['ad-a']);
    expect(db.adInsights.mock.calls[0]![0].where.adAccount).not.toHaveProperty('socialAccountId');
  });

  it('limits scoped ad accounts to allowed channel sources even when no channel is selected', async () => {
    await facebookAnalyticsHost.load({ workspaceId: 'w', range: { from: new Date('2026-10-01'), to: new Date('2026-10-31') }, selectedTargetIds: [], allowedTargetIds: ['page-a'], selectedAdAccountIds: ['ad-a'] });
    expect(db.adAccounts.mock.calls[0]![0].where.socialAccountId).toEqual({ in: ['source-a'] });
  });
});
