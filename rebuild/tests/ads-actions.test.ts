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
  createFacebookAdSet: vi.fn(),
  entitlements: vi.fn(),
  permissions: vi.fn(),
  canUseFeature: vi.fn(),
  canAccessFeature: vi.fn(),
}));

vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: mocks.decrypt }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: mocks.configuredEngine, configuredFacebookAdapter: vi.fn(), configuredFacebookOAuth: vi.fn() }));
vi.mock('../src/platforms/facebook/ads', () => ({
  FACEBOOK_AD_OBJECTIVES: new Set(['OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_APP_PROMOTION']),
  FACEBOOK_ADS_MANAGEMENT_SCOPE: 'ads_management',
  validateFacebookCampaign: (name: string, objective: string) => { if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Campaign names must contain 1 to 100 printable characters.'); if (!['OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_APP_PROMOTION'].includes(objective)) throw new Error('Choose a supported campaign objective.'); },
  validateFacebookAdSet: (input: { name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) => { if (!input.name || input.name.length > 100 || /[\u0000-\u001f\u007f]/.test(input.name)) throw new Error('Ad set names must contain 1 to 100 printable characters.'); if (!Number.isSafeInteger(input.dailyBudgetMinor) || input.dailyBudgetMinor < 1) throw new Error('Daily budgets must be positive whole minor currency units.'); if (!/^[A-Z]{2}$/.test(input.countryCode)) throw new Error('Country code must be a two-letter uppercase code.'); },
  facebookCampaignConfirmation: (_id: string, name: string, objective: string) => `CREATE PAUSED FACEBOOK CAMPAIGN ${JSON.stringify(name.trim())} IN ACCOUNT local-account-1 WITH OBJECTIVE ${objective}`,
  facebookAdSetConfirmation: (input: { name: string; campaignId: string; adAccountId: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) => `CREATE PAUSED FACEBOOK AD SET ${JSON.stringify(input.name.trim())} UNDER CAMPAIGN ${input.campaignId} IN ACCOUNT ${input.adAccountId} WITH DAILY BUDGET ${input.dailyBudgetMinor} MINOR UNITS TARGETING ${input.countryCode} OPTIMIZED FOR ${input.optimizationGoal}`,
  type: {},
}));
vi.mock('../src/server/platforms/registry', () => ({
  platformAds: vi.fn(async (provider: string) => {
    if (await mocks.config(`platforms.${provider}.enabled`) !== true) return null;
    return {
      readScopes: async () => await mocks.config('meta.adsReadScopes'), manageScopes: async () => await mocks.config('meta.adsManageScopes'),
      hasReadScopes: (required: string[], granted: string[]) => required.length > 0 && required.every(scope => granted.includes(scope)),
      validateManageScopes: (required: string[], granted: string[]) => {
        if (!required.length || !required.includes('ads_management')) throw new Error('Root has not configured the ads_management scope.');
        if (required.some(scope => !granted.includes(scope))) throw new Error('Reconnect this Facebook source and grant the configured ads management scopes.');
      },
      validateCampaign: (name: string, objective: string) => { if (!name || name.length > 100) throw new Error('Campaign names must contain 1 to 100 printable characters.'); if (!['OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_APP_PROMOTION'].includes(objective)) throw new Error('Choose a supported campaign objective.'); },
      campaignConfirmation: (_id: string, name: string, objective: string) => `CREATE PAUSED FACEBOOK CAMPAIGN ${JSON.stringify(name.trim())} IN ACCOUNT local-account-1 WITH OBJECTIVE ${objective}`,
      validateAdSet: (input: { name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) => { if (!input.name || input.name.length > 100) throw new Error('Ad set names must contain 1 to 100 printable characters.'); if (!Number.isSafeInteger(input.dailyBudgetMinor) || input.dailyBudgetMinor < 1) throw new Error('Daily budgets must be positive whole minor currency units.'); if (!/^[A-Z]{2}$/.test(input.countryCode)) throw new Error('Country code must be a two-letter uppercase code.'); },
      adSetConfirmation: (input: { name: string; campaignId: string; adAccountId: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) => `CREATE PAUSED FACEBOOK AD SET ${JSON.stringify(input.name.trim())} UNDER CAMPAIGN ${input.campaignId} IN ACCOUNT ${input.adAccountId} WITH DAILY BUDGET ${input.dailyBudgetMinor} MINOR UNITS TARGETING ${input.countryCode} OPTIMIZED FOR ${input.optimizationGoal}`,
      read: mocks.engine.readAdObject, update: mocks.engine.updateAd, createCampaign: mocks.engine.createCampaign, createAdSet: mocks.createFacebookAdSet,
    };
  }),
}));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: mocks.canUseFeature }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: mocks.canAccessFeature }));

import { canManageWorkspaceAds, canReadWorkspaceAds, createWorkspaceAdCampaign, createWorkspaceAdSet, readWorkspaceAdObject, updateWorkspaceAd } from '../src/server/ads/actions';
import { platformAds } from '../src/server/platforms/registry';

const actor = { userId: 'user-1', workspaceId: 'workspace-1' };
const statusChange = {
  adAccountId: 'local-account-1', objectId: 'campaign-44', objectType: 'campaign' as const,
  status: 'paused' as const, confirmation: 'SET AD STATUS campaign-44 TO PAUSED',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.membership.findUnique.mockResolvedValue({ role: 'owner' });
  mocks.entitlements.mockResolvedValue({});
  mocks.permissions.mockResolvedValue({ pageScope: { all: true } });
  mocks.canUseFeature.mockReturnValue(true);
  mocks.canAccessFeature.mockReturnValue(true);
  mocks.prisma.adAccount.findFirst.mockResolvedValue({
    id: 'local-account-1', actId: 'act_99',
    socialAccount: { id: 'social-1', provider: 'facebook', accessToken: 'encrypted-token', scopes: 'ads_read,ads_management', invalidatedAt: null, tokenExpiresAt: null },
  });
  mocks.prisma.adInsight.findFirst.mockResolvedValue({ id: 'insight-1' });
  mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : ['ads_management']);
  mocks.decrypt.mockReturnValue('secret-token-value');
  mocks.configuredEngine.mockResolvedValue(mocks.engine);
  mocks.engine.updateAd.mockResolvedValue(undefined);
  mocks.engine.createCampaign.mockResolvedValue({ remoteId: 'campaign-new' });
  mocks.engine.readAdObject.mockResolvedValue({ id: 'campaign-44', name: 'Spring', accountId: '99', configuredStatus: 'PAUSED', effectiveStatus: 'CAMPAIGN_PAUSED' });
  mocks.createFacebookAdSet.mockResolvedValue({ remoteId: 'adset-new' });
  mocks.prisma.$executeRaw.mockResolvedValue(1);
});

describe('workspace Ads actions', () => {
  it('dispatches live reads through the provider recorded on the selected ad account', async () => {
    mocks.config.mockImplementation(async (key: string) => key === 'platforms.instagram.enabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : false);
    mocks.prisma.adAccount.findFirst.mockResolvedValue({
      id: 'local-account-1', actId: 'remote-account',
      socialAccount: { id: 'social-1', provider: 'instagram', accessToken: 'encrypted-token', scopes: 'ads_read', invalidatedAt: null, tokenExpiresAt: null },
    });
    await expect(readWorkspaceAdObject(actor, { adAccountId: 'local-account-1', objectId: 'campaign-44', objectType: 'campaign' })).resolves.toMatchObject({ id: 'campaign-44' });
    expect(platformAds).toHaveBeenCalledWith('instagram');
  });

  it('allows read-authorized members to inspect live status without ads_management or the spend-change switch', async () => {
    mocks.prisma.membership.findUnique.mockResolvedValue({ role: 'viewer' });
    mocks.config.mockImplementation(async (key: string) => key === 'platforms.facebook.enabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : false);
    mocks.prisma.adAccount.findFirst.mockResolvedValue({
      id: 'local-account-1', actId: 'act_99',
      socialAccount: { id: 'social-1', provider: 'facebook', accessToken: 'encrypted-token', scopes: 'ads_read', invalidatedAt: null, tokenExpiresAt: null },
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
      socialAccount: { id: 'social-1', provider: 'facebook', accessToken: 'encrypted-token', scopes: 'ads_management', invalidatedAt: null, tokenExpiresAt: null },
    });
    await expect(readWorkspaceAdObject(actor, { adAccountId: 'local-account-1', objectId: 'campaign-44', objectType: 'campaign' })).rejects.toThrow(/performance access is unavailable/);
    expect(mocks.engine.readAdObject).not.toHaveBeenCalled();
  });

  it('shows controls only when Root enablement and the recorded management grant are present', async () => {
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(true);
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' ? false : key === 'platforms.facebook.enabled' ? true : ['ads_management']);
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(false);
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : ['ads_management']);
    mocks.prisma.adAccount.findFirst.mockResolvedValue({ socialAccount: { provider: 'facebook', scopes: 'ads_read', invalidatedAt: null, tokenExpiresAt: null } });
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(false);
  });

  it('limits manage visibility and mutations to ad accounts linked to permitted channels', async () => {
    mocks.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['target-allowed'] } });
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(true);
    const scopedWhere = mocks.prisma.adAccount.findFirst.mock.calls[0][0].where;
    expect(scopedWhere.socialAccount.is.targets.some).toEqual({ workspaceId: actor.workspaceId, id: { in: ['target-allowed'] } });
    mocks.prisma.adAccount.findFirst.mockResolvedValueOnce(null);
    expect(await canManageWorkspaceAds(actor, 'account-linked-only-to-forbidden-channel')).toBe(false);

    mocks.prisma.adAccount.findFirst.mockResolvedValueOnce(null);
    await expect(updateWorkspaceAd(actor, statusChange)).rejects.toThrow(/unavailable/);
    const mutationWhere = mocks.prisma.adAccount.findFirst.mock.calls[2][0].where;
    expect(mutationWhere.socialAccount.is.targets.some).toEqual({ workspaceId: actor.workspaceId, id: { in: ['target-allowed'] } });
    expect(mocks.engine.updateAd).not.toHaveBeenCalled();

    mocks.prisma.adAccount.findFirst.mockResolvedValueOnce(null);
    await expect(createWorkspaceAdCampaign(actor, { adAccountId: 'local-account-1', name: 'Spring', objective: 'OUTCOME_TRAFFIC', confirmation: 'anything' })).rejects.toThrow(/unavailable/);
    expect(mocks.engine.createCampaign).not.toHaveBeenCalled();
  });

  it('requires exact confirmation, sends a paused campaign, and audits without the credential', async () => {
    mocks.engine.createCampaign.mockClear().mockResolvedValue({ remoteId: 'campaign-new' });
    const input = { adAccountId: 'local-account-1', name: 'Spring launch', objective: 'OUTCOME_TRAFFIC' as const,
      confirmation: 'CREATE PAUSED FACEBOOK CAMPAIGN "Spring launch" IN ACCOUNT local-account-1 WITH OBJECTIVE OUTCOME_TRAFFIC' };
    await expect(createWorkspaceAdCampaign(actor, { ...input, confirmation: 'yes' })).rejects.toThrow(/confirmation exactly/);
    expect(mocks.engine.createCampaign).not.toHaveBeenCalled();
    await expect(createWorkspaceAdCampaign(actor, input)).resolves.toEqual({ created: true, campaignId: 'campaign-new', status: 'paused', auditRecorded: true });
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
    await expect(createWorkspaceAdCampaign(actor, input)).rejects.toThrow(/platform is disabled or Ads capability is unavailable/);
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : ['ads_read']);
    await expect(createWorkspaceAdCampaign(actor, input)).rejects.toThrow(/Root has not configured/);
    expect(mocks.engine.createCampaign).not.toHaveBeenCalled();
  });

  it('returns confirmed campaign success when only the local audit write fails', async () => {
    const input = { adAccountId: 'local-account-1', name: 'Spring launch', objective: 'OUTCOME_TRAFFIC' as const,
      confirmation: 'CREATE PAUSED FACEBOOK CAMPAIGN "Spring launch" IN ACCOUNT local-account-1 WITH OBJECTIVE OUTCOME_TRAFFIC' };
    mocks.engine.createCampaign.mockClear().mockResolvedValue({ remoteId: 'campaign-confirmed' });
    mocks.prisma.$executeRaw.mockRejectedValueOnce(new Error('database unavailable'));
    const auditLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(createWorkspaceAdCampaign(actor, input)).resolves.toEqual({ created: true, campaignId: 'campaign-confirmed', status: 'paused', auditRecorded: false, warning: expect.stringContaining('Do not submit this creation again.') });
    expect(mocks.engine.createCampaign).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith('Ads creation succeeded but its audit record could not be saved.', { workspaceId: actor.workspaceId, actorId: actor.userId, adAccountId: 'local-account-1', campaignId: 'campaign-confirmed' });
    auditLog.mockRestore();
  });

  it('creates a paused ad set only for an account-owned campaign and audits without credentials', async () => {
    const input = { adAccountId: 'local-account-1', campaignId: 'campaign-44', name: 'Prospecting', dailyBudgetMinor: 5000,
      countryCode: 'MA', optimizationGoal: 'LINK_CLICKS' as const,
      confirmation: 'CREATE PAUSED FACEBOOK AD SET "Prospecting" UNDER CAMPAIGN campaign-44 IN ACCOUNT local-account-1 WITH DAILY BUDGET 5000 MINOR UNITS TARGETING MA OPTIMIZED FOR LINK_CLICKS' };
    await expect(createWorkspaceAdSet(actor, { ...input, confirmation: 'yes' }, true)).rejects.toThrow(/confirmation exactly/);
    expect(mocks.createFacebookAdSet).not.toHaveBeenCalled();
    await expect(createWorkspaceAdSet(actor, input, true)).resolves.toEqual({ created: true, adSetId: 'adset-new', status: 'paused', auditRecorded: true });
    expect(mocks.prisma.adInsight.findFirst).toHaveBeenCalledWith({ where: { adAccountId: 'local-account-1', level: 'campaign', objectId: 'campaign-44' }, select: { id: true } });
    expect(mocks.createFacebookAdSet).toHaveBeenCalledWith(expect.objectContaining({ credential: { accessToken: 'secret-token-value' }, accountId: 'act_99', campaignId: 'campaign-44', name: 'Prospecting', dailyBudgetMinor: 5000, countryCode: 'MA', optimizationGoal: 'LINK_CLICKS' }));
    const rawValues = mocks.prisma.$executeRaw.mock.calls[0] as unknown[];
    expect(JSON.stringify(rawValues)).toContain('adset-new');
    expect(JSON.stringify(rawValues)).toContain('PAUSED');
    expect(JSON.stringify(rawValues)).not.toContain('secret-token-value');
  });

  it('rejects an ad set with an unverified campaign and does not send it to Meta', async () => {
    mocks.prisma.adInsight.findFirst.mockResolvedValue(null);
    const input = { adAccountId: 'local-account-1', campaignId: 'campaign-foreign', name: 'Prospecting', dailyBudgetMinor: 5000,
      countryCode: 'MA', optimizationGoal: 'LINK_CLICKS' as const,
      confirmation: 'CREATE PAUSED FACEBOOK AD SET "Prospecting" UNDER CAMPAIGN campaign-foreign IN ACCOUNT local-account-1 WITH DAILY BUDGET 5000 MINOR UNITS TARGETING MA OPTIMIZED FOR LINK_CLICKS' };
    await expect(createWorkspaceAdSet(actor, input, true)).rejects.toThrow(/cannot be verified/);
    expect(mocks.createFacebookAdSet).not.toHaveBeenCalled();
  });

  it('enforces all-page scope inside ad set creation even when the caller claims full scope', async () => {
    const input = { adAccountId: 'local-account-1', campaignId: 'campaign-44', name: 'Prospecting', dailyBudgetMinor: 5000,
      countryCode: 'MA', optimizationGoal: 'LINK_CLICKS' as const,
      confirmation: 'CREATE PAUSED FACEBOOK AD SET "Prospecting" UNDER CAMPAIGN campaign-44 IN ACCOUNT local-account-1 WITH DAILY BUDGET 5000 MINOR UNITS TARGETING MA OPTIMIZED FOR LINK_CLICKS' };
    mocks.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['target-a'] } });
    await expect(createWorkspaceAdSet(actor, input, true)).rejects.toThrow(/unavailable for limited page access/);
    expect(mocks.prisma.adAccount.findFirst).not.toHaveBeenCalled();
    expect(mocks.createFacebookAdSet).not.toHaveBeenCalled();
  });

  it('returns a created result with audit recovery status instead of encouraging a duplicate retry', async () => {
    const input = { adAccountId: 'local-account-1', campaignId: 'campaign-44', name: 'Prospecting', dailyBudgetMinor: 5000,
      countryCode: 'MA', optimizationGoal: 'LINK_CLICKS' as const,
      confirmation: 'CREATE PAUSED FACEBOOK AD SET "Prospecting" UNDER CAMPAIGN campaign-44 IN ACCOUNT local-account-1 WITH DAILY BUDGET 5000 MINOR UNITS TARGETING MA OPTIMIZED FOR LINK_CLICKS' };
    mocks.prisma.$executeRaw.mockRejectedValueOnce(new Error('database unavailable'));
    const auditLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(createWorkspaceAdSet(actor, input, true)).resolves.toEqual({ created: true, adSetId: 'adset-new', status: 'paused', auditRecorded: false, warning: expect.stringContaining('Do not submit this creation again.') });
    expect(mocks.createFacebookAdSet).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith('Ads creation succeeded but its audit record could not be saved.', { workspaceId: actor.workspaceId, actorId: actor.userId, adAccountId: 'local-account-1', campaignId: 'campaign-44', adSetId: 'adset-new' });
    auditLog.mockRestore();
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

    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : ['ads_management']);
    mocks.prisma.adAccount.findFirst.mockResolvedValue({
      id: 'local-account-1', actId: 'act_99',
      socialAccount: { id: 'social-1', provider: 'facebook', accessToken: 'encrypted-token', scopes: 'ads_read', invalidatedAt: null, tokenExpiresAt: null },
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
