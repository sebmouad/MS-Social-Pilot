import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    membership: { findUnique: vi.fn() },
    adAccount: { findFirst: vi.fn() },
    adInsight: { findFirst: vi.fn() },
    $executeRaw: vi.fn(),
  },
  config: vi.fn(),
  secret: vi.fn(),
  decrypt: vi.fn(),
  engine: { updateAd: vi.fn(), createCampaign: vi.fn(), readAdObject: vi.fn() },
  configuredEngine: vi.fn(),
  createFacebookAdSet: vi.fn(),
  entitlements: vi.fn(),
  permissions: vi.fn(),
  canUseFeature: vi.fn(),
  hasPlatformCapability: vi.fn(),
  canAccessFeature: vi.fn(),
  perform: vi.fn(),
}));
vi.mock('../src/modules/ads/management/server', () => ({ performAdsManagement: mocks.perform }));

vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config, runtimeSecret: mocks.secret }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: mocks.decrypt }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: mocks.configuredEngine, configuredFacebookAdapter: vi.fn(), configuredFacebookOAuth: vi.fn() }));
vi.mock('../src/server/platforms/registry', () => ({
  platformAds: vi.fn(async (provider: string) => {
    if (await mocks.config(`platforms.${provider}.enabled`) !== true) return null;
    const { facebookAdsHost } = await import('../src/platforms/facebook/ads');
    return {
      ...facebookAdsHost,
      read: mocks.engine.readAdObject, update: mocks.engine.updateAd, createCampaign: mocks.engine.createCampaign, createAdSet: mocks.createFacebookAdSet,
    };
  }),
}));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: mocks.canUseFeature, hasPlatformCapability: mocks.hasPlatformCapability }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: mocks.canAccessFeature }));

import { canManageWorkspaceAds, canReadWorkspaceAds, createWorkspaceAdCampaign, createWorkspaceAdSet, readWorkspaceAdObject, updateWorkspaceAd } from '../src/server/ads/actions';
import { platformAds } from '../src/server/platforms/registry';
import { OperationError } from '../src/lib/operation-error';

const actor = { userId: 'user-1', workspaceId: 'workspace-1' };
const requestId = 'request-0001';
const statusChange = {
  adAccountId: 'local-account-1', objectId: 'campaign-44', objectType: 'campaign' as const,
  status: 'paused' as const, confirmation: 'preview-derived confirmation', requestId,
};
const applied = { outcome: 'succeeded' as const, operationId: 'adsop_1', remoteId: null, recorded: true };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.membership.findUnique.mockResolvedValue({ role: 'owner' });
  mocks.entitlements.mockResolvedValue({});
  mocks.permissions.mockResolvedValue({ pageScope: { all: true } });
  mocks.canUseFeature.mockReturnValue(true);
  mocks.hasPlatformCapability.mockReturnValue(true);
  mocks.canAccessFeature.mockReturnValue(true);
  mocks.prisma.adAccount.findFirst.mockResolvedValue({
    id: 'local-account-1', actId: 'act_99',
    socialAccount: { id: 'social-1', provider: 'facebook', accessToken: 'encrypted-token', scopes: 'ads_read,ads_management', invalidatedAt: null, tokenExpiresAt: null },
  });
  mocks.prisma.adInsight.findFirst.mockResolvedValue({ id: 'insight-1' });
  mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : key === 'meta.appSecretProofEnabled' ? false : ['ads_management']);
  mocks.secret.mockResolvedValue(null);
  mocks.decrypt.mockReturnValue('secret-token-value');
  mocks.configuredEngine.mockResolvedValue(mocks.engine);
  mocks.engine.updateAd.mockResolvedValue(undefined);
  mocks.engine.createCampaign.mockResolvedValue({ remoteId: 'campaign-new' });
  mocks.engine.readAdObject.mockResolvedValue({ id: 'campaign-44', name: 'Spring', accountId: '99', configuredStatus: 'PAUSED', effectiveStatus: 'CAMPAIGN_PAUSED' });
  mocks.createFacebookAdSet.mockResolvedValue({ remoteId: 'adset-new' });
  mocks.prisma.$executeRaw.mockResolvedValue(1);
  mocks.perform.mockResolvedValue(applied);
});

describe('workspace Ads actions', () => {
  it('denies stored and live Ads reads when the selected platform is not entitled', async () => {
    mocks.hasPlatformCapability.mockReturnValue(false);
    expect(await canReadWorkspaceAds(actor, 'local-account-1')).toBe(false);
    await expect(readWorkspaceAdObject(actor, { adAccountId: 'local-account-1', objectId: 'campaign-44', objectType: 'campaign' })).rejects.toThrow(/performance access is unavailable/);
    expect(platformAds).not.toHaveBeenCalled();
    expect(mocks.engine.readAdObject).not.toHaveBeenCalled();
  });
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
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : key === 'meta.appSecretProofEnabled' ? false : ['ads_management']);
    mocks.prisma.adAccount.findFirst.mockResolvedValue({ socialAccount: { provider: 'facebook', scopes: 'ads_read', invalidatedAt: null, tokenExpiresAt: null } });
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(false);
  });

  it('hides live read and manage readiness when required request signing has no app secret', async () => {
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' || key === 'meta.appSecretProofEnabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : ['ads_management']);
    mocks.secret.mockResolvedValue(null);

    expect(await canReadWorkspaceAds(actor, 'local-account-1')).toBe(false);
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(false);
    await expect(readWorkspaceAdObject(actor, { adAccountId: 'local-account-1', objectId: 'campaign-44', objectType: 'campaign' })).rejects.toThrow(/performance access is unavailable/);
    expect(mocks.engine.readAdObject).not.toHaveBeenCalled();
  });

  it('keeps Ads read and manage readiness when signing is explicitly disabled without a secret', async () => {
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : key === 'meta.appSecretProofEnabled' ? false : ['ads_management']);
    mocks.secret.mockResolvedValue(null);

    expect(await canReadWorkspaceAds(actor, 'local-account-1')).toBe(true);
    expect(await canManageWorkspaceAds(actor, 'local-account-1')).toBe(true);
  });

  it('fails closed when Ads readiness cannot load Root signing configuration', async () => {
    mocks.config.mockImplementation(async (key: string) => {
      if (key === 'meta.appSecretProofEnabled') throw new Error('private config failure');
      return key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : key === 'meta.adsReadScopes' ? ['ads_read'] : ['ads_management'];
    });

    expect(await canReadWorkspaceAds(actor, 'local-account-1')).toBe(false);
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
    await expect(createWorkspaceAdCampaign(actor, input)).rejects.toThrow(/Advertising changes are currently unavailable/);
    mocks.config.mockImplementation(async (key: string) => key === 'ads.managementEnabled' || key === 'platforms.facebook.enabled' ? true : ['ads_read']);
    await expect(createWorkspaceAdCampaign(actor, input)).rejects.toThrow(/Advertising changes are currently unavailable/);
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

  it('maps a status change to one neutral operation and delegates with the request identity and confirmation', async () => {
    await expect(updateWorkspaceAd(actor, statusChange)).resolves.toEqual(applied);
    expect(mocks.perform).toHaveBeenCalledTimes(1);
    expect(mocks.perform).toHaveBeenCalledWith(
      { userId: 'user-1', workspaceId: 'workspace-1' },
      { adAccountId: 'local-account-1', operation: { type: 'status.set', objectType: 'campaign', objectId: 'campaign-44', status: 'paused' }, confirmation: 'preview-derived confirmation', requestId },
    );
    expect(mocks.engine.updateAd).not.toHaveBeenCalled();
  });

  it('maps daily and lifetime budgets to neutral budget operations', async () => {
    const base = { adAccountId: 'local-account-1', objectId: 'adset-12', objectType: 'adset' as const, confirmation: 'c', requestId };
    await updateWorkspaceAd(actor, { ...base, dailyBudgetMinor: 1250 });
    await updateWorkspaceAd(actor, { ...base, lifetimeBudgetMinor: 90000 });
    expect(mocks.perform.mock.calls[0][1].operation).toEqual({ type: 'budget.set', objectType: 'adset', objectId: 'adset-12', budget: { kind: 'daily', minor: 1250 } });
    expect(mocks.perform.mock.calls[1][1].operation).toEqual({ type: 'budget.set', objectType: 'adset', objectId: 'adset-12', budget: { kind: 'lifetime', minor: 90000 } });
    expect(mocks.engine.updateAd).not.toHaveBeenCalled();
  });

  it('retains the caller’s allowed target scope when delegating', async () => {
    await updateWorkspaceAd({ ...actor, allowedTargetIds: ['target-a'] }, statusChange);
    expect(mocks.perform.mock.calls[0][0]).toEqual({ userId: 'user-1', workspaceId: 'workspace-1', allowedTargetIds: ['target-a'] });
  });

  it('rejects zero or multiple changes before delegating', async () => {
    await expect(updateWorkspaceAd(actor, { ...statusChange, dailyBudgetMinor: 500 })).rejects.toThrow('Choose one valid ad change.');
    await expect(updateWorkspaceAd(actor, { adAccountId: 'a', objectId: 'o', objectType: 'campaign', confirmation: 'c', requestId })).rejects.toThrow('Choose one valid ad change.');
    expect(mocks.perform).not.toHaveBeenCalled();
  });

  it('never calls the provider update directly and surfaces service refusals and structured outcomes unchanged', async () => {
    mocks.perform.mockRejectedValueOnce(new OperationError('forbidden', 'Only workspace owners and admins can manage ads.'));
    await expect(updateWorkspaceAd(actor, statusChange)).rejects.toThrow(/owners and admins/);
    const uncertain = { outcome: 'uncertain' as const, operationId: 'adsop_2', message: 'unknown' };
    mocks.perform.mockResolvedValueOnce(uncertain);
    await expect(updateWorkspaceAd(actor, statusChange)).resolves.toBe(uncertain);
    expect(mocks.engine.updateAd).not.toHaveBeenCalled();
    expect(mocks.prisma.adInsight.findFirst).not.toHaveBeenCalled();
  });
});
