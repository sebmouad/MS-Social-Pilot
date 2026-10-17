import { randomBytes } from 'node:crypto';
import type { AdMutationRequest } from '@/platforms/types';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { loadEntitlements, canUseFeature, hasPlatformCapability } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import type { ScopedPageAccess } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { runtimeConfig } from '@/server/config/store';
import { platformAds } from '@/server/platforms/registry';
import { OperationError } from '@/lib/operation-error';

const MANAGER_ROLES = new Set(['owner', 'admin']);
const OBJECT_TYPES = new Set<AdMutationRequest['objectType']>(['campaign', 'adset', 'ad']);
const ACCOUNT_WHERE = { enabled: true } as const;

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
export type AdsCampaignCreateInput = { adAccountId: string; name: string; objective: string; confirmation: string };
export type AdsAdSetCreateInput = { adAccountId: string; campaignId: string; name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string; confirmation: string };
export type AdsObjectReadInput = { adAccountId: string; objectId: string; objectType: AdMutationRequest['objectType'] };

function scopes(value: string) { return value.split(',').map(scope => scope.trim()).filter(Boolean); }

const creationAuditWarning = 'Creation succeeded and the object is paused, but its audit record could not be saved. Do not submit this creation again.';
async function recordAdsCreationAudit(actor: AdsActionActor, action: 'ads.campaign_created' | 'ads.adset_created', detail: Record<string, unknown>, logContext: Record<string, unknown>) {
  try {
    await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`ads_${randomBytes(12).toString('hex')}`}, ${actor.userId}, ${action}, ${JSON.stringify({ workspaceId: actor.workspaceId, ...detail })}::jsonb, NOW())`;
    return true;
  } catch {
    console.error('Ads creation succeeded but its audit record could not be saved.', { workspaceId: actor.workspaceId, actorId: actor.userId, ...logContext });
    return false;
  }
}

/** Resolve the selected account's module before producing provider-specific confirmation text. */
export async function campaignCreationConfirmation(workspaceId: string, adAccountId: string, name: string, objective: string) {
  const account = await prisma.adAccount.findFirst({
    where: { id: adAccountId, workspaceId, ...ACCOUNT_WHERE, socialAccount: { is: { workspaceId, invalidatedAt: null } } },
    select: { socialAccount: { select: { provider: true } } },
  });
  const host = account?.socialAccount ? await platformAds(account.socialAccount.provider) : null;
  if (!host) throw new OperationError('unavailable', 'The selected advertising account is unavailable.');
  const normalizedName = name.trim();
  host.validateCampaign(normalizedName, objective);
  return host.campaignConfirmation(adAccountId, normalizedName, objective);
}

/** Server-rendering gate for action controls; mutation still repeats these checks. */
export async function canManageWorkspaceAds(actor: AdsActionActor, adAccountId: string): Promise<boolean> {
  const [membership, entitlements, permissions, managementEnabled] = await Promise.all([
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
    loadEntitlements(actor.userId, actor.workspaceId), loadPermissions(actor.userId, actor.workspaceId), runtimeConfig('ads.managementEnabled') as Promise<boolean>,
  ]);
  if (!membership || !MANAGER_ROLES.has(membership.role) || managementEnabled !== true || !entitlements || !permissions) return false;
  if (!canUseFeature(entitlements, 'ads/campaigns') || !canAccessFeature(permissions, 'ads/campaigns', 'write')) return false;
  const account = await prisma.adAccount.findFirst({
    where: { id: adAccountId, workspaceId: actor.workspaceId, ...ACCOUNT_WHERE, socialAccount: { is: scopedConnectionWhere(actor.workspaceId, permissions.pageScope) } },
    select: { socialAccount: { select: { provider: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
  });
  const connection = account?.socialAccount;
  if (!connection || connection.invalidatedAt || (connection.tokenExpiresAt && connection.tokenExpiresAt <= new Date())) return false;
  if (!hasPlatformCapability(entitlements, connection.provider)) return false;
  const host = await platformAds(connection.provider);
  if (!host) return false;
  const required = await host.manageScopes();
  try { host.validateManageScopes(required, scopes(connection.scopes)); return true; } catch { return false; }
}

/** Read access is independent from spend-changing management enablement and scope. */
export async function canReadWorkspaceAds(actor: AdsActionActor, adAccountId: string, allowedTargetIds?: readonly string[]): Promise<boolean> {
  const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId), loadPermissions(actor.userId, actor.workspaceId)]);
  if (!entitlements || !permissions) return false;
  if (!canUseFeature(entitlements, 'ads/campaigns') || !canAccessFeature(permissions, 'ads/campaigns', 'read')) return false;
  const account = await prisma.adAccount.findFirst({
    where: {
      id: adAccountId, workspaceId: actor.workspaceId, ...ACCOUNT_WHERE,
      socialAccount: { is: { workspaceId: actor.workspaceId, invalidatedAt: null, ...(allowedTargetIds ? { targets: { some: { workspaceId: actor.workspaceId, id: { in: [...allowedTargetIds] } } } } : {}) } },
    },
    select: { socialAccount: { select: { provider: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
  });
  const connection = account?.socialAccount;
  if (!connection || connection.invalidatedAt || (connection.tokenExpiresAt && connection.tokenExpiresAt <= new Date())) return false;
  if (!hasPlatformCapability(entitlements, connection.provider)) return false;
  const host = await platformAds(connection.provider);
  return !!host && host.hasReadScopes(await host.readScopes(), scopes(connection.scopes));
}

/** Read one stored-history-verified ad object using its account's provider module. */
export async function readWorkspaceAdObject(actor: AdsActionActor, input: AdsObjectReadInput, allowedTargetIds?: readonly string[]) {
  if (!OBJECT_TYPES.has(input.objectType) || !/^[A-Za-z0-9_-]{1,100}$/.test(input.objectId)) throw new OperationError('invalid_request', 'Invalid ad object.');
  if (!(await canReadWorkspaceAds(actor, input.adAccountId, allowedTargetIds))) throw new OperationError('forbidden', 'Ads performance access is unavailable.');
  const account = await prisma.adAccount.findFirst({
    where: {
      id: input.adAccountId, workspaceId: actor.workspaceId, ...ACCOUNT_WHERE,
      socialAccount: { is: { workspaceId: actor.workspaceId, invalidatedAt: null, ...(allowedTargetIds ? { targets: { some: { workspaceId: actor.workspaceId, id: { in: [...allowedTargetIds] } } } } : {}) } },
    },
    select: { id: true, actId: true, socialAccount: { select: { provider: true, accessToken: true, invalidatedAt: true, tokenExpiresAt: true } } },
  });
  const connection = account?.socialAccount;
  if (!account || !connection || connection.invalidatedAt || (connection.tokenExpiresAt && connection.tokenExpiresAt <= new Date())) throw new OperationError('unavailable', 'This advertising account is unavailable.');
  const owned = await prisma.adInsight.findFirst({ where: { adAccountId: account.id, level: input.objectType, objectId: input.objectId }, select: { id: true } });
  if (!owned) throw new OperationError('not_found', 'This ad object cannot be verified for the selected account.');
  const accessToken = decryptSecret(connection.accessToken);
  if (!accessToken) throw new OperationError('unavailable', 'This advertising account is unavailable.');
  const ads = await platformAds(connection.provider);
  if (!ads) throw new OperationError('unavailable', 'Ads object reads are unavailable.');
  return ads.read({ credential: { accessToken }, accountId: account.actId, objectId: input.objectId, objectType: input.objectType });
}

async function requireAdsManager(actor: AdsActionActor) {
  const membership = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
  if (!membership) throw new OperationError('unauthorized', 'You are no longer a member of this workspace.');
  if (!MANAGER_ROLES.has(membership.role)) throw new OperationError('forbidden', 'Only workspace owners and admins can manage ads.');
  const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId), loadPermissions(actor.userId, actor.workspaceId)]);
  if (!entitlements || !permissions) throw new OperationError('unavailable', 'Workspace access is unavailable.');
  if (!canUseFeature(entitlements, 'ads/campaigns') || !canAccessFeature(permissions, 'ads/campaigns', 'write')) throw new OperationError('forbidden', 'Ads management is not available for this workspace.');
  return { permissions, entitlements };
}

function scopedConnectionWhere(workspaceId: string, pageScope: ScopedPageAccess) {
  return {
    workspaceId, invalidatedAt: null,
    ...(!pageScope.all ? { targets: { some: { workspaceId, id: { in: [...pageScope.ids] } } } } : {}),
  };
}

async function managedAccount(actor: AdsActionActor, adAccountId: string, access: { permissions: NonNullable<Awaited<ReturnType<typeof loadPermissions>>>; entitlements: NonNullable<Awaited<ReturnType<typeof loadEntitlements>>> }) {
  const account = await prisma.adAccount.findFirst({
    where: { id: adAccountId, workspaceId: actor.workspaceId, ...ACCOUNT_WHERE, socialAccount: { is: scopedConnectionWhere(actor.workspaceId, access.permissions.pageScope) } },
    select: { id: true, actId: true, socialAccount: { select: { provider: true, accessToken: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
  });
  const connection = account?.socialAccount;
  if (!account || !connection || connection.invalidatedAt || (connection.tokenExpiresAt && connection.tokenExpiresAt <= new Date())) throw new OperationError('reconnect_required', 'This advertising account or its connection is unavailable. Reconnect it before managing ads.');
  if (!hasPlatformCapability(access.entitlements, connection.provider)) throw new OperationError('unavailable', 'This advertising account is unavailable.');
  const ads = await platformAds(connection.provider);
  if (!ads) throw new OperationError('unavailable', 'Advertising changes are currently unavailable.');
  const [required, managementEnabled] = await Promise.all([ads.manageScopes(), runtimeConfig('ads.managementEnabled') as Promise<boolean>]);
  if (managementEnabled !== true) throw new OperationError('unavailable', 'Ads management is currently unavailable.');
  ads.validateManageScopes(required, scopes(connection.scopes));
  const accessToken = decryptSecret(connection.accessToken);
  if (!accessToken) throw new OperationError('reconnect_required', 'This advertising connection is unavailable. Reconnect it before managing ads.');
  return { account, connection, ads, credential: { accessToken } };
}

/** Mutate one previously observed object after rechecking every server-side boundary. */
export async function updateWorkspaceAd(actor: AdsActionActor, input: AdsActionInput) {
  const access = await requireAdsManager(actor);
  const hasStatus = input.status !== undefined, hasDailyBudget = input.dailyBudgetMinor !== undefined, hasLifetimeBudget = input.lifetimeBudgetMinor !== undefined;
  if (!OBJECT_TYPES.has(input.objectType) || !input.objectId || !/^[A-Za-z0-9_-]{1,100}$/.test(input.objectId)) throw new OperationError('invalid_request', 'Invalid ad object.');
  if ([hasStatus, hasDailyBudget, hasLifetimeBudget].filter(Boolean).length !== 1) throw new OperationError('invalid_request', 'Choose one valid ad change.');
  if (hasStatus && input.status !== 'active' && input.status !== 'paused') throw new OperationError('invalid_request', 'Invalid ad status.');
  const budget = hasDailyBudget ? input.dailyBudgetMinor : input.lifetimeBudgetMinor;
  if (budget !== undefined && (!Number.isSafeInteger(budget) || budget < 1)) throw new OperationError('invalid_request', 'Budgets must be positive whole minor currency units.');
  const confirmation = budget !== undefined ? `SET AD BUDGET ${input.objectId} TO ${budget} MINOR UNITS` : `SET AD STATUS ${input.objectId} TO ${input.status!.toUpperCase()}`;
  if (input.confirmation !== confirmation) throw new OperationError('invalid_request', `Confirmation required. Repeat with confirmation exactly: ${confirmation}`);
  const { account, ads, credential } = await managedAccount(actor, input.adAccountId, access);
  const owned = await prisma.adInsight.findFirst({ where: { adAccountId: account.id, level: input.objectType, objectId: input.objectId }, select: { id: true } });
  if (!owned) throw new OperationError('not_found', 'This ad object cannot be verified for the selected account.');
  await ads.update({ credential, accountId: account.actId, objectId: input.objectId, objectType: input.objectType,
    ...(hasStatus ? { status: input.status } : {}), ...(hasDailyBudget ? { dailyBudgetMinor: input.dailyBudgetMinor } : {}), ...(hasLifetimeBudget ? { lifetimeBudgetMinor: input.lifetimeBudgetMinor } : {}) });
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`ads_${randomBytes(12).toString('hex')}`}, ${actor.userId}, 'ads.object_updated', ${JSON.stringify({ workspaceId: actor.workspaceId, adAccountId: account.id, objectId: input.objectId, objectType: input.objectType, ...(hasStatus ? { status: input.status } : {}), ...(hasDailyBudget ? { dailyBudgetMinor: input.dailyBudgetMinor } : {}), ...(hasLifetimeBudget ? { lifetimeBudgetMinor: input.lifetimeBudgetMinor } : {}) })}::jsonb, NOW())`;
}

/** Create a paused campaign after rechecking workspace, account and provider boundaries. */
export async function createWorkspaceAdCampaign(actor: AdsActionActor, input: AdsCampaignCreateInput) {
  const access = await requireAdsManager(actor);
  const { account, ads, credential } = await managedAccount(actor, input.adAccountId, access);
  const name = input.name.trim();
  ads.validateCampaign(name, input.objective);
  const confirmation = ads.campaignConfirmation(input.adAccountId, name, input.objective);
  if (input.confirmation !== confirmation) throw new OperationError('invalid_request', `Confirmation required. Repeat with confirmation exactly: ${confirmation}`);
  const result = await ads.createCampaign({ credential, accountId: account.actId, name, objective: input.objective });
  const auditRecorded = await recordAdsCreationAudit(actor, 'ads.campaign_created', { adAccountId: account.id, campaignId: result.remoteId, name, objective: input.objective, status: 'PAUSED' }, { adAccountId: account.id, campaignId: result.remoteId });
  return { created: true as const, campaignId: result.remoteId, status: 'paused' as const, auditRecorded, ...(auditRecorded ? {} : { warning: creationAuditWarning }) };
}

/** Create a paused ad set under a campaign verified in this account's insight history. */
export async function createWorkspaceAdSet(actor: AdsActionActor, input: AdsAdSetCreateInput, pageScopeAll: boolean) {
  if (!pageScopeAll) throw new OperationError('forbidden', 'Ad set creation is unavailable for limited page access.');
  const access = await requireAdsManager(actor);
  if (!access.permissions.pageScope.all) throw new OperationError('forbidden', 'Ad set creation is unavailable for limited page access.');
  const { account, ads, credential } = await managedAccount(actor, input.adAccountId, access);
  const name = input.name.trim();
  ads.validateAdSet({ ...input, name });
  const confirmation = ads.adSetConfirmation({ ...input, name });
  if (input.confirmation !== confirmation) throw new OperationError('invalid_request', `Confirmation required. Repeat with confirmation exactly: ${confirmation}`);
  const parentCampaign = await prisma.adInsight.findFirst({ where: { adAccountId: account.id, level: 'campaign', objectId: input.campaignId }, select: { id: true } });
  if (!parentCampaign) throw new OperationError('not_found', 'This campaign cannot be verified for the selected account.');
  const result = await ads.createAdSet({ credential, accountId: account.actId, campaignId: input.campaignId, name, dailyBudgetMinor: input.dailyBudgetMinor, countryCode: input.countryCode, optimizationGoal: input.optimizationGoal });
  const auditRecorded = await recordAdsCreationAudit(actor, 'ads.adset_created', { adAccountId: account.id, campaignId: input.campaignId, adSetId: result.remoteId, name, dailyBudgetMinor: input.dailyBudgetMinor, countryCode: input.countryCode, optimizationGoal: input.optimizationGoal, status: 'PAUSED' }, { adAccountId: account.id, campaignId: input.campaignId, adSetId: result.remoteId });
  return { created: true as const, adSetId: result.remoteId, status: 'paused' as const, auditRecorded, ...(auditRecorded ? {} : { warning: creationAuditWarning }) };
}
