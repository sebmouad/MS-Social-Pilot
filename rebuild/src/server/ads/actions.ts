import { randomBytes } from 'node:crypto';
import type { AdMutationRequest, FacebookCampaignObjective } from '@/platforms/types';
import { configuredFacebookEngine } from '@/server/platforms/facebook';
import { configuredCreateFacebookAdSet, type AdSetOptimizationGoal } from '@/server/ads/facebook-ads';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { loadEntitlements, canUseFeature } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { runtimeConfig } from '@/server/config/store';

const MANAGER_ROLES = new Set(['owner', 'admin']);
const OBJECT_TYPES = new Set<AdMutationRequest['objectType']>(['campaign', 'adset', 'ad']);
const SCOPE_MANAGEMENT = 'ads_management';

export type AdsActionActor = { userId: string; workspaceId: string };
export type AdsActionInput = {
  adAccountId: string;
  objectId: string;
  objectType: AdMutationRequest['objectType'];
  status?: 'active' | 'paused';
  dailyBudgetMinor?: number;
  lifetimeBudgetMinor?: number;
  confirmation: string;
};
export type AdsCampaignCreateInput = { adAccountId: string; name: string; objective: FacebookCampaignObjective; confirmation: string };
export type AdsAdSetCreateInput = { adAccountId: string; campaignId: string; name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: AdSetOptimizationGoal; confirmation: string };
export type AdsObjectReadInput = { adAccountId: string; objectId: string; objectType: AdMutationRequest['objectType'] };
const OBJECTIVES = new Set<FacebookCampaignObjective>(['OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_APP_PROMOTION']);

export function campaignCreationConfirmation(adAccountId: string, name: string, objective: string) {
  return `CREATE PAUSED FACEBOOK CAMPAIGN ${JSON.stringify(name.trim())} IN ACCOUNT ${adAccountId} WITH OBJECTIVE ${objective}`;
}

export function adSetCreationConfirmation(input: Omit<AdsAdSetCreateInput, 'confirmation'>) {
  return `CREATE PAUSED FACEBOOK AD SET ${JSON.stringify(input.name.trim())} UNDER CAMPAIGN ${input.campaignId} IN ACCOUNT ${input.adAccountId} WITH DAILY BUDGET ${input.dailyBudgetMinor} MINOR UNITS TARGETING ${input.countryCode} OPTIMIZED FOR ${input.optimizationGoal}`;
}

/** Server-rendering gate for action controls; mutation still repeats these checks. */
export async function canManageWorkspaceAds(actor: AdsActionActor, adAccountId: string): Promise<boolean> {
  const [membership, entitlements, permissions, configuredScopes, managementEnabled, facebookEnabled] = await Promise.all([
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
    loadEntitlements(actor.userId, actor.workspaceId),
    loadPermissions(actor.userId, actor.workspaceId),
    runtimeConfig('meta.adsManageScopes') as Promise<string[]>,
    runtimeConfig('ads.managementEnabled') as Promise<boolean>,
    runtimeConfig('platforms.facebook.enabled') as Promise<boolean>,
  ]);
  if (!membership || !MANAGER_ROLES.has(membership.role) || managementEnabled !== true || facebookEnabled !== true || !entitlements || !permissions) return false;
  if (!canUseFeature(entitlements, 'ads/campaigns') || !canAccessFeature(permissions, 'ads/campaigns', 'write')) return false;
  const requiredScopes = [...new Set(configuredScopes.map(scope => scope.trim()).filter(Boolean))];
  if (!requiredScopes.includes(SCOPE_MANAGEMENT)) return false;
  const account = await prisma.adAccount.findFirst({
    where: { id: adAccountId, workspaceId: actor.workspaceId, enabled: true, socialAccount: { is: { workspaceId: actor.workspaceId, provider: 'facebook', invalidatedAt: null } } },
    select: { socialAccount: { select: { scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
  });
  if (!account?.socialAccount || account.socialAccount.invalidatedAt || (account.socialAccount.tokenExpiresAt && account.socialAccount.tokenExpiresAt <= new Date())) return false;
  const grantedScopes = new Set(account.socialAccount.scopes.split(',').map(scope => scope.trim()).filter(Boolean));
  return requiredScopes.every(scope => grantedScopes.has(scope));
}

/** Read access is independent from spend-changing management enablement and scope. */
export async function canReadWorkspaceAds(actor: AdsActionActor, adAccountId: string, allowedTargetIds?: readonly string[]): Promise<boolean> {
  const [entitlements, permissions, requiredScopes, facebookEnabled] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId),
    loadPermissions(actor.userId, actor.workspaceId),
    runtimeConfig('meta.adsReadScopes') as Promise<string[]>,
    runtimeConfig('platforms.facebook.enabled') as Promise<boolean>,
  ]);
  if (facebookEnabled !== true || !entitlements || !permissions) return false;
  if (!canUseFeature(entitlements, 'ads/campaigns') || !canAccessFeature(permissions, 'ads/campaigns', 'read')) return false;
  const scopes = [...new Set(requiredScopes.map(scope => scope.trim()).filter(Boolean))];
  if (!scopes.length) return false;
  const account = await prisma.adAccount.findFirst({
    where: {
      id: adAccountId, workspaceId: actor.workspaceId, enabled: true,
      socialAccount: { is: {
        workspaceId: actor.workspaceId, provider: 'facebook', invalidatedAt: null,
        ...(allowedTargetIds ? { targets: { some: { workspaceId: actor.workspaceId, id: { in: [...allowedTargetIds] } } } } : {}),
      } },
    },
    select: { socialAccount: { select: { scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
  });
  if (!account?.socialAccount || account.socialAccount.invalidatedAt || (account.socialAccount.tokenExpiresAt && account.socialAccount.tokenExpiresAt <= new Date())) return false;
  const grantedScopes = new Set(account.socialAccount.scopes.split(',').map(scope => scope.trim()).filter(Boolean));
  return scopes.every(scope => grantedScopes.has(scope));
}

/** Read the live state of one account-verified ad object shown in stored insights. */
export async function readWorkspaceAdObject(actor: AdsActionActor, input: AdsObjectReadInput, allowedTargetIds?: readonly string[]) {
  if (!OBJECT_TYPES.has(input.objectType) || !/^[A-Za-z0-9_-]{1,100}$/.test(input.objectId)) throw new Error('Invalid ad object.');
  if (!(await canReadWorkspaceAds(actor, input.adAccountId, allowedTargetIds))) throw new Error('Ads performance access is unavailable.');

  const account = await prisma.adAccount.findFirst({
    where: {
      id: input.adAccountId, workspaceId: actor.workspaceId, enabled: true,
      socialAccount: { is: {
        workspaceId: actor.workspaceId, provider: 'facebook', invalidatedAt: null,
        ...(allowedTargetIds ? { targets: { some: { workspaceId: actor.workspaceId, id: { in: [...allowedTargetIds] } } } } : {}),
      } },
    },
    select: { id: true, actId: true, socialAccount: { select: { accessToken: true, invalidatedAt: true, tokenExpiresAt: true } } },
  });
  if (!account?.socialAccount || account.socialAccount.invalidatedAt || (account.socialAccount.tokenExpiresAt && account.socialAccount.tokenExpiresAt <= new Date())) {
    throw new Error('This advertising account is unavailable.');
  }
  const ownedObject = await prisma.adInsight.findFirst({
    where: { adAccountId: account.id, level: input.objectType, objectId: input.objectId }, select: { id: true },
  });
  if (!ownedObject) throw new Error('This ad object cannot be verified for the selected account.');
  const accessToken = decryptSecret(account.socialAccount.accessToken);
  if (!accessToken) throw new Error('This advertising account is unavailable.');
  const engine = await configuredFacebookEngine();
  if (!engine.readAdObject) throw new Error('Facebook ad object reads are unavailable.');
  return engine.readAdObject({ credential: { accessToken }, accountId: account.actId, objectId: input.objectId, objectType: input.objectType });
}

/** Mutate one previously observed Facebook object after rechecking every server-side boundary. */
export async function updateWorkspaceAd(actor: AdsActionActor, input: AdsActionInput) {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } },
    select: { role: true },
  });
  if (!membership) throw new Error('You are no longer a member of this workspace.');
  if (!MANAGER_ROLES.has(membership.role)) throw new Error('Only workspace owners and admins can manage ads.');

  const [entitlements, permissions] = await Promise.all([
    loadEntitlements(actor.userId, actor.workspaceId),
    loadPermissions(actor.userId, actor.workspaceId),
  ]);
  if (!entitlements || !permissions) throw new Error('Workspace access is unavailable.');
  if (!canUseFeature(entitlements, 'ads/campaigns') || !canAccessFeature(permissions, 'ads/campaigns', 'write')) {
    throw new Error('Ads management is not enabled for this workspace.');
  }

  const hasStatus = input.status !== undefined;
  const hasDailyBudget = input.dailyBudgetMinor !== undefined;
  const hasLifetimeBudget = input.lifetimeBudgetMinor !== undefined;
  if (!OBJECT_TYPES.has(input.objectType) || !input.objectId || !/^[A-Za-z0-9_-]{1,100}$/.test(input.objectId)) throw new Error('Invalid ad object.');
  if (![hasStatus, hasDailyBudget, hasLifetimeBudget].filter(Boolean).length || (hasDailyBudget && hasLifetimeBudget)) throw new Error('Choose one valid ad change.');
  if (hasStatus && input.status !== 'active' && input.status !== 'paused') throw new Error('Invalid ad status.');
  const budget = hasDailyBudget ? input.dailyBudgetMinor : input.lifetimeBudgetMinor;
  if (budget !== undefined && (!Number.isSafeInteger(budget) || budget < 1)) throw new Error('Budgets must be positive whole minor currency units.');
  const confirmation = budget !== undefined
    ? `SET AD BUDGET ${input.objectId} TO ${budget} MINOR UNITS`
    : `SET AD STATUS ${input.objectId} TO ${input.status!.toUpperCase()}`;
  if (input.confirmation !== confirmation) throw new Error(`Confirmation required. Repeat with confirmation exactly: ${confirmation}`);

  const account = await prisma.adAccount.findFirst({
    where: { id: input.adAccountId, workspaceId: actor.workspaceId, enabled: true, socialAccount: { is: { workspaceId: actor.workspaceId, provider: 'facebook', invalidatedAt: null } } },
    select: {
      id: true, actId: true,
      socialAccount: { select: { id: true, accessToken: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } },
    },
  });
  if (!account?.socialAccount || account.socialAccount.invalidatedAt || (account.socialAccount.tokenExpiresAt && account.socialAccount.tokenExpiresAt <= new Date())) {
    throw new Error('This advertising account or its connection is unavailable. Reconnect it before managing ads.');
  }

  // Caller-supplied IDs are never sufficient evidence of ownership. Only objects
  // present in this account's stored insight history can cross the mutation boundary.
  const ownedObject = await prisma.adInsight.findFirst({
    where: { adAccountId: account.id, level: input.objectType, objectId: input.objectId },
    select: { id: true },
  });
  if (!ownedObject) throw new Error('This ad object cannot be verified for the selected account.');

  const [configuredScopes, managementEnabled, facebookEnabled] = await Promise.all([
    runtimeConfig('meta.adsManageScopes') as Promise<string[]>,
    runtimeConfig('ads.managementEnabled') as Promise<boolean>,
    runtimeConfig('platforms.facebook.enabled') as Promise<boolean>,
  ]);
  if (managementEnabled !== true) throw new Error('Ads management is disabled in Root configuration.');
  if (facebookEnabled !== true) throw new Error('The Facebook platform is disabled in Root configuration.');
  const requiredScopes = [...new Set(configuredScopes.map(scope => scope.trim()).filter(Boolean))];
  if (!requiredScopes.length || !requiredScopes.includes(SCOPE_MANAGEMENT)) throw new Error('Root has not configured the ads_management scope.');
  const grantedScopes = new Set(account.socialAccount.scopes.split(',').map(scope => scope.trim()).filter(Boolean));
  if (requiredScopes.some(scope => !grantedScopes.has(scope))) throw new Error('Reconnect this Facebook source and grant the configured ads management scopes.');

  const accessToken = decryptSecret(account.socialAccount.accessToken);
  if (!accessToken) throw new Error('This Facebook connection is unavailable. Reconnect it before managing ads.');
  const engine = await configuredFacebookEngine();
  await engine.updateAd({
    credential: { accessToken }, accountId: account.actId, objectId: input.objectId, objectType: input.objectType,
    ...(hasStatus ? { status: input.status } : {}),
    ...(hasDailyBudget ? { dailyBudgetMinor: input.dailyBudgetMinor } : {}),
    ...(hasLifetimeBudget ? { lifetimeBudgetMinor: input.lifetimeBudgetMinor } : {}),
  });
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`ads_${randomBytes(12).toString('hex')}`}, ${actor.userId}, 'ads.object_updated', ${JSON.stringify({ workspaceId: actor.workspaceId, adAccountId: account.id, objectId: input.objectId, objectType: input.objectType, ...(hasStatus ? { status: input.status } : {}), ...(hasDailyBudget ? { dailyBudgetMinor: input.dailyBudgetMinor } : {}), ...(hasLifetimeBudget ? { lifetimeBudgetMinor: input.lifetimeBudgetMinor } : {}) })}::jsonb, NOW())`;
}

/** Create one paused campaign after rechecking workspace, account, Root and provider boundaries. */
export async function createWorkspaceAdCampaign(actor: AdsActionActor, input: AdsCampaignCreateInput) {
  const membership = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
  if (!membership) throw new Error('You are no longer a member of this workspace.');
  if (!MANAGER_ROLES.has(membership.role)) throw new Error('Only workspace owners and admins can manage ads.');
  const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId), loadPermissions(actor.userId, actor.workspaceId)]);
  if (!entitlements || !permissions) throw new Error('Workspace access is unavailable.');
  if (!canUseFeature(entitlements, 'ads/campaigns') || !canAccessFeature(permissions, 'ads/campaigns', 'write')) throw new Error('Ads management is not enabled for this workspace.');

  const name = input.name.trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Campaign names must contain 1 to 100 printable characters.');
  if (!OBJECTIVES.has(input.objective)) throw new Error('Choose a supported campaign objective.');
  const confirmation = campaignCreationConfirmation(input.adAccountId, name, input.objective);
  if (input.confirmation !== confirmation) throw new Error(`Confirmation required. Repeat with confirmation exactly: ${confirmation}`);

  const account = await prisma.adAccount.findFirst({
    where: { id: input.adAccountId, workspaceId: actor.workspaceId, enabled: true, socialAccount: { is: { workspaceId: actor.workspaceId, provider: 'facebook', invalidatedAt: null } } },
    select: { id: true, actId: true, socialAccount: { select: { accessToken: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
  });
  if (!account?.socialAccount || account.socialAccount.invalidatedAt || (account.socialAccount.tokenExpiresAt && account.socialAccount.tokenExpiresAt <= new Date())) throw new Error('This advertising account or its connection is unavailable. Reconnect it before managing ads.');
  const [configuredScopes, managementEnabled, facebookEnabled] = await Promise.all([
    runtimeConfig('meta.adsManageScopes') as Promise<string[]>, runtimeConfig('ads.managementEnabled') as Promise<boolean>, runtimeConfig('platforms.facebook.enabled') as Promise<boolean>,
  ]);
  if (managementEnabled !== true) throw new Error('Ads management is disabled in Root configuration.');
  if (facebookEnabled !== true) throw new Error('The Facebook platform is disabled in Root configuration.');
  const requiredScopes = [...new Set(configuredScopes.map(scope => scope.trim()).filter(Boolean))];
  if (!requiredScopes.length || !requiredScopes.includes(SCOPE_MANAGEMENT)) throw new Error('Root has not configured the ads_management scope.');
  const grantedScopes = new Set(account.socialAccount.scopes.split(',').map(scope => scope.trim()).filter(Boolean));
  if (requiredScopes.some(scope => !grantedScopes.has(scope))) throw new Error('Reconnect this Facebook source and grant the configured ads management scopes.');
  const accessToken = decryptSecret(account.socialAccount.accessToken);
  if (!accessToken) throw new Error('This Facebook connection is unavailable. Reconnect it before managing ads.');
  const engine = await configuredFacebookEngine();
  if (!engine.createCampaign) throw new Error('Facebook campaign creation is unavailable.');
  const result = await engine.createCampaign({ credential: { accessToken }, accountId: account.actId, name, objective: input.objective });
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`ads_${randomBytes(12).toString('hex')}`}, ${actor.userId}, 'ads.campaign_created', ${JSON.stringify({ workspaceId: actor.workspaceId, adAccountId: account.id, campaignId: result.remoteId, name, objective: input.objective, status: 'PAUSED' })}::jsonb, NOW())`;
  return { campaignId: result.remoteId };
}

/** Create a paused ad set under a campaign verified in this account's insight history. */
export async function createWorkspaceAdSet(actor: AdsActionActor, input: AdsAdSetCreateInput, pageScopeAll: boolean) {
  if (!pageScopeAll) throw new Error('Ad set creation is unavailable for limited page access.');
  const membership = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
  if (!membership) throw new Error('You are no longer a member of this workspace.');
  if (!MANAGER_ROLES.has(membership.role)) throw new Error('Only workspace owners and admins can manage ads.');
  const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId), loadPermissions(actor.userId, actor.workspaceId)]);
  if (!entitlements || !permissions) throw new Error('Workspace access is unavailable.');
  if (!canUseFeature(entitlements, 'ads/campaigns') || !canAccessFeature(permissions, 'ads/campaigns', 'write')) throw new Error('Ads management is not enabled for this workspace.');

  const name = input.name.trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Ad set names must contain 1 to 100 printable characters.');
  if (!Number.isSafeInteger(input.dailyBudgetMinor) || input.dailyBudgetMinor < 1) throw new Error('Daily budgets must be positive whole minor currency units.');
  if (!/^[A-Z]{2}$/.test(input.countryCode)) throw new Error('Country code must be a two-letter uppercase code.');
  const confirmation = adSetCreationConfirmation({ ...input, name });
  if (input.confirmation !== confirmation) throw new Error(`Confirmation required. Repeat with confirmation exactly: ${confirmation}`);

  const account = await prisma.adAccount.findFirst({
    where: { id: input.adAccountId, workspaceId: actor.workspaceId, enabled: true, socialAccount: { is: { workspaceId: actor.workspaceId, provider: 'facebook', invalidatedAt: null } } },
    select: { id: true, actId: true, socialAccount: { select: { accessToken: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
  });
  if (!account?.socialAccount || account.socialAccount.invalidatedAt || (account.socialAccount.tokenExpiresAt && account.socialAccount.tokenExpiresAt <= new Date())) throw new Error('This advertising account or its connection is unavailable. Reconnect it before managing ads.');
  const parentCampaign = await prisma.adInsight.findFirst({ where: { adAccountId: account.id, level: 'campaign', objectId: input.campaignId }, select: { id: true } });
  if (!parentCampaign) throw new Error('This campaign cannot be verified for the selected account.');

  const [configuredScopes, managementEnabled, facebookEnabled] = await Promise.all([
    runtimeConfig('meta.adsManageScopes') as Promise<string[]>, runtimeConfig('ads.managementEnabled') as Promise<boolean>, runtimeConfig('platforms.facebook.enabled') as Promise<boolean>,
  ]);
  if (managementEnabled !== true) throw new Error('Ads management is disabled in Root configuration.');
  if (facebookEnabled !== true) throw new Error('The Facebook platform is disabled in Root configuration.');
  const requiredScopes = [...new Set(configuredScopes.map(scope => scope.trim()).filter(Boolean))];
  if (!requiredScopes.length || !requiredScopes.includes(SCOPE_MANAGEMENT)) throw new Error('Root has not configured the ads_management scope.');
  const grantedScopes = new Set(account.socialAccount.scopes.split(',').map(scope => scope.trim()).filter(Boolean));
  if (requiredScopes.some(scope => !grantedScopes.has(scope))) throw new Error('Reconnect this Facebook source and grant the configured ads management scopes.');
  const accessToken = decryptSecret(account.socialAccount.accessToken);
  if (!accessToken) throw new Error('This Facebook connection is unavailable. Reconnect it before managing ads.');
  const result = await configuredCreateFacebookAdSet({
    credential: { accessToken }, accountId: account.actId, campaignId: input.campaignId, name, dailyBudgetMinor: input.dailyBudgetMinor,
    countryCode: input.countryCode, optimizationGoal: input.optimizationGoal,
  });
  try {
    await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`ads_${randomBytes(12).toString('hex')}`}, ${actor.userId}, 'ads.adset_created', ${JSON.stringify({ workspaceId: actor.workspaceId, adAccountId: account.id, campaignId: input.campaignId, adSetId: result.remoteId, name, dailyBudgetMinor: input.dailyBudgetMinor, countryCode: input.countryCode, optimizationGoal: input.optimizationGoal, status: 'PAUSED' })}::jsonb, NOW())`;
    return { adSetId: result.remoteId, auditRecorded: true };
  } catch {
    // The provider operation already succeeded. Return that result so a client
    // does not retry creation and generate a second remote ad set.
    console.error('Ad set created but its audit record could not be saved.', { adSetId: result.remoteId, adAccountId: account.id, campaignId: input.campaignId });
    return { adSetId: result.remoteId, auditRecorded: false };
  }
}
