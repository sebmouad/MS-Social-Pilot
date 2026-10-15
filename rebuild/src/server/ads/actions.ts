import { randomBytes } from 'node:crypto';
import type { AdMutationRequest } from '@/platforms/types';
import { configuredFacebookEngine } from '@/server/platforms/facebook';
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

/** Server-rendering gate for action controls; mutation still repeats these checks. */
export async function canManageWorkspaceAds(actor: AdsActionActor, adAccountId: string): Promise<boolean> {
  const [membership, entitlements, permissions, configuredScopes, managementEnabled] = await Promise.all([
    prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
    loadEntitlements(actor.userId, actor.workspaceId),
    loadPermissions(actor.userId, actor.workspaceId),
    runtimeConfig('meta.adsManageScopes') as Promise<string[]>,
    runtimeConfig('ads.managementEnabled') as Promise<boolean>,
  ]);
  if (!membership || !MANAGER_ROLES.has(membership.role) || managementEnabled !== true || !entitlements || !permissions) return false;
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

  const configuredScopes = await runtimeConfig('meta.adsManageScopes') as string[];
  const managementEnabled = await runtimeConfig('ads.managementEnabled') as boolean;
  if (managementEnabled !== true) throw new Error('Ads management is disabled in Root configuration.');
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
