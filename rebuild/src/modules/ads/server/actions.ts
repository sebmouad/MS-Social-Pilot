import type { AdMutationRequest } from '@/platforms/types';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { loadEntitlements, canUseFeature, hasPlatformCapability } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import type { ScopedPageAccess } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { runtimeConfig } from '@/server/config/store';
import { platformAds } from '@/server/platforms/registry';
import type { PlatformAdsHost } from '@/server/platforms/host';
import { OperationError } from '@/lib/operation-error';
import { performAdsManagement, type AdsManagementOutcome } from '@/modules/ads/management/server';
import { adsOpsHostFor } from '@/modules/ads/management/registry';

const MANAGER_ROLES = new Set(['owner', 'admin']);
const OBJECT_TYPES = new Set<AdMutationRequest['objectType']>(['campaign', 'adset', 'ad']);
const ACCOUNT_WHERE = { enabled: true } as const;

/** `allowedAdAccountIds` is an independent ad-account ceiling: [] allows none, undefined adds no restriction. */
export type AdsActionActor = { userId: string; workspaceId: string; allowedTargetIds?: readonly string[]; allowedAdAccountIds?: readonly string[] };
const accountCeiling = (ids: readonly string[] | undefined) => ids === undefined ? {} : { AND: [{ id: { in: [...ids] } }] };
export type AdsActionInput = {
  adAccountId: string;
  objectId: string;
  objectType: AdMutationRequest['objectType'];
  status?: 'active' | 'paused';
  dailyBudgetMinor?: number;
  lifetimeBudgetMinor?: number;
  /** Preview-derived confirmation text the caller must repeat exactly. */
  confirmation: string;
  /** Idempotency key; retries with the same key replay the recorded outcome. */
  requestId: string;
};
export type AdsCampaignCreateInput = { adAccountId: string; name: string; objective: string; confirmation: string; /** Idempotency key shared with the management journal. */ requestId: string };
export type AdsAdSetCreateInput = { adAccountId: string; campaignId: string; name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string; confirmation: string; requestId: string };
export type AdsObjectReadInput = { adAccountId: string; objectId: string; objectType: AdMutationRequest['objectType'] };

function scopes(value: string) { return value.split(',').map(scope => scope.trim()).filter(Boolean); }

async function adsHostReady(host: PlatformAdsHost): Promise<boolean> {
  if (!host.isReady) return true;
  try { return await host.isReady() === true; } catch { return false; }
}

/** Resolve the selected account's module before producing its module-owned confirmation text. */
export async function campaignCreationConfirmation(workspaceId: string, adAccountId: string, name: string, objective: string, allowedAdAccountIds?: readonly string[]) {
  if (allowedAdAccountIds !== undefined && !allowedAdAccountIds.includes(adAccountId)) throw new OperationError('unavailable', 'The selected advertising account is unavailable.');
  const account = await prisma.adAccount.findFirst({
    where: { id: adAccountId, workspaceId, ...ACCOUNT_WHERE, socialAccount: { is: { workspaceId, invalidatedAt: null } } },
    select: { currency: true, socialAccount: { select: { provider: true } } },
  });
  const host = account?.socialAccount ? await platformAds(account.socialAccount.provider) : null;
  const ops = host ? host.operations ?? adsOpsHostFor(account!.socialAccount!.provider) : null;
  if (!account || !ops) throw new OperationError('unavailable', 'The selected advertising account is unavailable.');
  const operation = { type: 'campaign.create' as const, objectType: 'campaign' as const, name: name.trim(), objective };
  ops.validate(operation);
  return ops.confirmation(operation, { adAccountId, currency: account.currency });
}

/** Server-rendering gate for action controls; mutation still repeats these checks. */
export async function canManageWorkspaceAds(actor: AdsActionActor, adAccountId: string): Promise<boolean> {
  if (actor.allowedAdAccountIds !== undefined && !actor.allowedAdAccountIds.includes(adAccountId)) return false;
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
  if (!(await adsHostReady(host))) return false;
  const required = await host.manageScopes();
  try { host.validateManageScopes(required, scopes(connection.scopes)); return true; } catch { return false; }
}

/** Read access is independent from spend-changing management enablement and scope. */
export async function canReadWorkspaceAds(actor: AdsActionActor, adAccountId: string, allowedTargetIds?: readonly string[]): Promise<boolean> {
  if (actor.allowedAdAccountIds !== undefined && !actor.allowedAdAccountIds.includes(adAccountId)) return false;
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
  return !!host && await adsHostReady(host) && host.hasReadScopes(await host.readScopes(), scopes(connection.scopes));
}

/** Read one stored-history-verified ad object using its account's provider module. */
export async function readWorkspaceAdObject(actor: AdsActionActor, input: AdsObjectReadInput, allowedTargetIds?: readonly string[]) {
  if (!OBJECT_TYPES.has(input.objectType) || !/^[A-Za-z0-9_-]{1,100}$/.test(input.objectId)) throw new OperationError('invalid_request', 'Invalid ad object.');
  if (!(await canReadWorkspaceAds(actor, input.adAccountId, allowedTargetIds))) throw new OperationError('forbidden', 'Ads performance access is unavailable.');
  const account = await prisma.adAccount.findFirst({
    where: {
      id: input.adAccountId, ...accountCeiling(actor.allowedAdAccountIds), workspaceId: actor.workspaceId, ...ACCOUNT_WHERE,
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

function scopedConnectionWhere(workspaceId: string, pageScope: ScopedPageAccess) {
  return {
    workspaceId, invalidatedAt: null,
    ...(!pageScope.all ? { targets: { some: { workspaceId, id: { in: [...pageScope.ids] } } } } : {}),
  };
}

/**
 * Map the single legacy-shaped change to one neutral operation and delegate to the
 * Ads management service, which owns authorization, preview-derived confirmation,
 * the durable ledger, provider dispatch and the structured outcome.
 */
export async function updateWorkspaceAd(actor: AdsActionActor, input: AdsActionInput): Promise<AdsManagementOutcome> {
  const hasStatus = input.status !== undefined, hasDailyBudget = input.dailyBudgetMinor !== undefined, hasLifetimeBudget = input.lifetimeBudgetMinor !== undefined;
  if ([hasStatus, hasDailyBudget, hasLifetimeBudget].filter(Boolean).length !== 1) throw new OperationError('invalid_request', 'Choose one valid ad change.');
  const base = { objectType: input.objectType, objectId: input.objectId };
  const operation = hasStatus
    ? { type: 'status.set', ...base, status: input.status }
    : { type: 'budget.set', ...base, budget: hasDailyBudget ? { kind: 'daily', minor: input.dailyBudgetMinor } : { kind: 'lifetime', minor: input.lifetimeBudgetMinor } };
  return performAdsManagement(
    performerOf(actor),
    { adAccountId: input.adAccountId, operation, confirmation: input.confirmation, requestId: input.requestId },
  );
}

function performerOf(actor: AdsActionActor) {
  return { userId: actor.userId, workspaceId: actor.workspaceId, ...(actor.allowedTargetIds ? { allowedTargetIds: actor.allowedTargetIds } : {}), ...(actor.allowedAdAccountIds ? { allowedAdAccountIds: actor.allowedAdAccountIds } : {}) };
}

/**
 * Create a paused campaign through the shared Ads management journal (intent before provider I/O,
 * request replay, selection lock, recovery). Legacy `campaignId` is present only when the provider proved success.
 */
export async function createWorkspaceAdCampaign(actor: AdsActionActor, input: AdsCampaignCreateInput): Promise<AdsManagementOutcome & { campaignId?: string }> {
  const outcome = await performAdsManagement(performerOf(actor), {
    adAccountId: input.adAccountId, confirmation: input.confirmation, requestId: input.requestId,
    operation: { type: 'campaign.create', objectType: 'campaign', name: input.name, objective: input.objective },
  });
  return outcome.outcome === 'succeeded' && outcome.created?.objectType === 'campaign' ? { ...outcome, campaignId: outcome.created.remoteId } : outcome;
}

/** Create a paused ad set under a campaign verified in this account's stored history, through the same journal. */
export async function createWorkspaceAdSet(actor: AdsActionActor, input: AdsAdSetCreateInput, pageScopeAll: boolean): Promise<AdsManagementOutcome & { adSetId?: string }> {
  if (!pageScopeAll) throw new OperationError('forbidden', 'Ad set creation is unavailable for limited page access.');
  const outcome = await performAdsManagement(performerOf(actor), {
    adAccountId: input.adAccountId, confirmation: input.confirmation, requestId: input.requestId,
    operation: { type: 'adset.create', objectType: 'adset', parentId: input.campaignId, name: input.name, dailyBudgetMinor: input.dailyBudgetMinor, countryCode: input.countryCode, optimizationGoal: input.optimizationGoal },
  });
  return outcome.outcome === 'succeeded' && outcome.created?.objectType === 'adset' ? { ...outcome, adSetId: outcome.created.remoteId } : outcome;
}
