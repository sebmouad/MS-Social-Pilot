import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    membership: { findUnique: vi.fn() },
    adAccount: { findFirst: vi.fn() },
    adInsight: { findFirst: vi.fn() },
    $executeRaw: vi.fn(),
  },
  config: vi.fn(),
  decrypt: vi.fn(),
  engine: { updateAd: vi.fn() },
  configuredEngine: vi.fn(),
  entitlements: vi.fn(),
  permissions: vi.fn(),
  canUseFeature: vi.fn(),
  canAccessFeature: vi.fn(),
}));

vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: mocks.decrypt }));
vi.mock('../src/server/platforms/facebook', () => ({ configuredFacebookEngine: mocks.configuredEngine }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: mocks.canUseFeature }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: mocks.canAccessFeature }));

import { canManageWorkspaceAds, updateWorkspaceAd } from '../src/server/ads/actions';

const actor = { userId: 'user-1', workspaceId: 'workspace-1' };
const statusChange = {
  adAccountId: 'local-account-1', objectId: 'campaign-44', objectType: 'campaign' as const,
  status: 'paused' as const, confirmation: 'SET AD STATUS campaign-44 TO PAUSED',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.membership.findUnique.mockResolvedValue({ role: 'owner' });
  mocks.entitlements.mockResolvedValue({});
  mocks.permissions.mockResolvedValue({});
  mocks.canUseFeature.mockReturnValue(true);
  mocks.canAccessFeature.mockReturnValue(true);
  mocks.prisma.adAccount.findFirst.mockResolvedValue({
    id: 'local-account-1', actId: 'act_99',
    socialAccount: { id: 'social-1', accessToken: 'encrypted-token', scopes: 'ads_read,ads_management', invalidatedAt: null, tokenExpiresAt: null },
  });
  mocks.prisma.adInsight.findFirst.mockResolvedValue({ id: 'insight-1' });
  mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? true : ['ads_management']);
  mocks.decrypt.mockReturnValue('secret-token-value');
  mocks.configuredEngine.mockResolvedValue(mocks.engine);
  mocks.engine.updateAd.mockResolvedValue(undefined);
  mocks.prisma.$executeRaw.mockResolvedValue(1);
});

describe('workspace Ads actions', () => {
  it('shows controls only when Root enablement and the recorded management grant are present', async () => {
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(true);
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? false : ['ads_management']);
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(false);
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? true : ['ads_management']);
    mocks.prisma.adAccount.findFirst.mockResolvedValue({ socialAccount: { scopes: 'ads_read', invalidatedAt: null, tokenExpiresAt: null } });
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(false);
  });

  it('rechecks role and blocks a non-manager before looking up any account', async () => {
    mocks.prisma.membership.findUnique.mockResolvedValue({ role: 'editor' });
    await expect(updateWorkspaceAd(actor, statusChange)).rejects.toThrow(/owners and admins/);
    expect(mocks.prisma.adAccount.findFirst).not.toHaveBeenCalled();
    expect(mocks.engine.updateAd).not.toHaveBeenCalled();
  });

  it('requires Root management enablement and the configured scope grant', async () => {
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? false : ['ads_management']);
    await expect(updateWorkspaceAd(actor, statusChange)).rejects.toThrow(/disabled in Root/);
    expect(mocks.engine.updateAd).not.toHaveBeenCalled();

    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? true : ['ads_management']);
    mocks.prisma.adAccount.findFirst.mockResolvedValue({
      id: 'local-account-1', actId: 'act_99',
      socialAccount: { id: 'social-1', accessToken: 'encrypted-token', scopes: 'ads_read', invalidatedAt: null, tokenExpiresAt: null },
    });
    await expect(updateWorkspaceAd(actor, statusChange)).rejects.toThrow(/grant the configured/);
    expect(mocks.engine.updateAd).not.toHaveBeenCalled();
  });

  it('rejects caller-provided objects that are not in this account’s stored insight history', async () => {
    mocks.prisma.adInsight.findFirst.mockResolvedValue(null);
    await expect(updateWorkspaceAd(actor, statusChange)).rejects.toThrow(/cannot be verified/);
    expect(mocks.prisma.adInsight.findFirst.mock.calls[0][0].where).toEqual({ adAccountId: 'local-account-1', level: 'campaign', objectId: 'campaign-44' });
    expect(mocks.engine.updateAd).not.toHaveBeenCalled();
  });

  it('requires the exact new budget in minor units, applies the mutation, and audits without credentials', async () => {
    const budgetChange = {
      adAccountId: 'local-account-1', objectId: 'adset-12', objectType: 'adset' as const,
      dailyBudgetMinor: 1250, confirmation: 'SET AD BUDGET adset-12 TO 1250 MINOR UNITS',
    };
    await expect(updateWorkspaceAd(actor, { ...budgetChange, confirmation: 'yes' })).rejects.toThrow(/confirmation exactly/);
    expect(mocks.engine.updateAd).not.toHaveBeenCalled();

    await updateWorkspaceAd(actor, budgetChange);
    expect(mocks.engine.updateAd).toHaveBeenCalledWith({
      credential: { accessToken: 'secret-token-value' }, accountId: 'act_99', objectId: 'adset-12', objectType: 'adset', dailyBudgetMinor: 1250,
    });
    const rawValues = mocks.prisma.$executeRaw.mock.calls[0] as unknown[];
    expect(JSON.stringify(rawValues)).toContain('1250');
    expect(JSON.stringify(rawValues)).not.toContain('secret-token-value');
  });

  it('denies mutations when the Root feature or workspace write permission is off', async () => {
    mocks.canUseFeature.mockReturnValue(false);
    await expect(updateWorkspaceAd(actor, statusChange)).rejects.toThrow(/not enabled/);
    mocks.canUseFeature.mockReturnValue(true);
    mocks.canAccessFeature.mockReturnValue(false);
    await expect(updateWorkspaceAd(actor, statusChange)).rejects.toThrow(/not enabled/);
    expect(mocks.prisma.adAccount.findFirst).not.toHaveBeenCalled();
  });
});
