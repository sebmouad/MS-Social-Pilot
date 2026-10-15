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
  engine: { updateAd: vi.fn(), createCampaign: vi.fn(), readAdObject: vi.fn() },
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

import { canManageWorkspaceAds, canReadWorkspaceAds, createWorkspaceAdCampaign, readWorkspaceAdObject, updateWorkspaceAd } from '../src/server/ads/actions';

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
  mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : ['ads_management']);
  mocks.decrypt.mockReturnValue('secret-token-value');
  mocks.configuredEngine.mockResolvedValue(mocks.engine);
  mocks.engine.updateAd.mockResolvedValue(undefined);
  mocks.engine.createCampaign.mockResolvedValue({ remoteId: 'campaign-new' });
  mocks.engine.readAdObject.mockResolvedValue({ id: 'campaign-44', name: 'Spring', accountId: '99', configuredStatus: 'PAUSED', effectiveStatus: 'CAMPAIGN_PAUSED' });
  mocks.prisma.$executeRaw.mockResolvedValue(1);
});

describe('workspace Ads actions', () => {
  it('allows read-authorized members to inspect live status without ads_management or the spend-change switch', async () => {
    mocks.prisma.membership.findUnique.mockResolvedValue({ role: 'viewer' });
    mocks.config.mockImplementation(async (key: string) => key === 'platforms.facebook.enabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : false);
    mocks.prisma.adAccount.findFirst.mockResolvedValue({
      id: 'local-account-1', actId: 'act_99',
      socialAccount: { id: 'social-1', accessToken: 'encrypted-token', scopes: 'ads_read', invalidatedAt: null, tokenExpiresAt: null },
    });
    expect(await canReadWorkspaceAds(actor, 'local-account-1', ['target-a'])).toBe(true);
    expect(mocks.prisma.adAccount.findFirst.mock.calls[0][0].where.socialAccount.is.targets.some).toEqual({ workspaceId: actor.workspaceId, id: { in: ['target-a'] } });
    await expect(readWorkspaceAdObject(actor, { adAccountId: 'local-account-1', objectId: 'campaign-44', objectType: 'campaign' }, ['target-a'])).resolves.toMatchObject({
      id: 'campaign-44', configuredStatus: 'PAUSED', effectiveStatus: 'CAMPAIGN_PAUSED',
    });
    expect(mocks.prisma.adInsight.findFirst.mock.calls[0][0].where).toEqual({ adAccountId: 'local-account-1', level: 'campaign', objectId: 'campaign-44' });
    expect(mocks.engine.readAdObject).toHaveBeenCalledWith({ credential: { accessToken: 'secret-token-value' }, accountId: 'act_99', objectId: 'campaign-44', objectType: 'campaign' });
  });

  it('blocks live status reads for unknown objects and when required read scopes are missing', async () => {
    mocks.prisma.adInsight.findFirst.mockResolvedValue(null);
    await expect(readWorkspaceAdObject(actor, { adAccountId: 'local-account-1', objectId: 'campaign-44', objectType: 'campaign' })).rejects.toThrow(/cannot be verified/);
    expect(mocks.engine.readAdObject).not.toHaveBeenCalled();
    mocks.prisma.adInsight.findFirst.mockResolvedValue({ id: 'insight-1' });
    mocks.config.mockImplementation(async (key: string) => key === 'platforms.facebook.enabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : false);
    mocks.prisma.adAccount.findFirst.mockResolvedValue({
      id: 'local-account-1', actId: 'act_99',
      socialAccount: { id: 'social-1', accessToken: 'encrypted-token', scopes: 'ads_management', invalidatedAt: null, tokenExpiresAt: null },
    });
    await expect(readWorkspaceAdObject(actor, { adAccountId: 'local-account-1', objectId: 'campaign-44', objectType: 'campaign' })).rejects.toThrow(/performance access is unavailable/);
    expect(mocks.engine.readAdObject).not.toHaveBeenCalled();
  });

  it('shows controls only when Root enablement and the recorded management grant are present', async () => {
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(true);
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? false : key === 'platforms.facebook.enabled' ? true : ['ads_management']);
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(false);
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : ['ads_management']);
    mocks.prisma.adAccount.findFirst.mockResolvedValue({ socialAccount: { scopes: 'ads_read', invalidatedAt: null, tokenExpiresAt: null } });
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(false);
  });

  it('requires exact confirmation, sends a paused campaign, and audits without the credential', async () => {
    mocks.engine.createCampaign.mockClear().mockResolvedValue({ remoteId: 'campaign-new' });
    const input = { adAccountId: 'local-account-1', name: 'Spring launch', objective: 'OUTCOME_TRAFFIC' as const,
      confirmation: 'CREATE PAUSED FACEBOOK CAMPAIGN "Spring launch" IN ACCOUNT local-account-1 WITH OBJECTIVE OUTCOME_TRAFFIC' };
    await expect(createWorkspaceAdCampaign(actor, { ...input, confirmation: 'yes' })).rejects.toThrow(/confirmation exactly/);
    expect(mocks.engine.createCampaign).not.toHaveBeenCalled();
    await expect(createWorkspaceAdCampaign(actor, input)).resolves.toEqual({ campaignId: 'campaign-new' });
    expect(mocks.engine.createCampaign).toHaveBeenCalledWith({ credential: { accessToken: 'secret-token-value' }, accountId: 'act_99', name: 'Spring launch', objective: 'OUTCOME_TRAFFIC' });
    const rawValues = mocks.prisma.$executeRaw.mock.calls[0] as unknown[];
    expect(JSON.stringify(rawValues)).toContain('campaign-new');
    expect(JSON.stringify(rawValues)).toContain('PAUSED');
    expect(JSON.stringify(rawValues)).not.toContain('secret-token-value');
  });

  it('blocks campaign creation when the Facebook channel is disabled or the scope is absent', async () => {
    mocks.engine.createCampaign.mockClear();
    const input = { adAccountId: 'local-account-1', name: 'Spring launch', objective: 'OUTCOME_TRAFFIC' as const,
      confirmation: 'CREATE PAUSED FACEBOOK CAMPAIGN "Spring launch" IN ACCOUNT local-account-1 WITH OBJECTIVE OUTCOME_TRAFFIC' };
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? true : key === 'platforms.facebook.enabled' ? false : ['ads_management']);
    await expect(createWorkspaceAdCampaign(actor, input)).rejects.toThrow(/Facebook platform is disabled/);
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : ['ads_read']);
    await expect(createWorkspaceAdCampaign(actor, input)).rejects.toThrow(/Root has not configured/);
    expect(mocks.engine.createCampaign).not.toHaveBeenCalled();
  });

  it('rechecks role and blocks a non-manager before looking up any account', async () => {
    mocks.prisma.membership.findUnique.mockResolvedValue({ role: 'editor' });
    await expect(updateWorkspaceAd(actor, statusChange)).rejects.toThrow(/owners and admins/);
    expect(mocks.prisma.adAccount.findFirst).not.toHaveBeenCalled();
    expect(mocks.engine.updateAd).not.toHaveBeenCalled();
  });

  it('requires Root management enablement and the configured scope grant', async () => {
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? false : key === 'platforms.facebook.enabled' ? true : ['ads_management']);
    await expect(updateWorkspaceAd(actor, statusChange)).rejects.toThrow(/disabled in Root/);
    expect(mocks.engine.updateAd).not.toHaveBeenCalled();

    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : ['ads_management']);
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
