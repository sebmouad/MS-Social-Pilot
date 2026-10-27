import { recordAdObjectChange, findStoredAdObject } from '../server/object-store';
import { withAdsCopySnapshot } from '@/modules/ads/server/copy';
import { defaultAdsText } from '@/modules/ads/copy';
import { adsServiceText } from '@/modules/ads/server/copy';
import type { TargetType } from '../../../../generated/client';
import { listWorkspaceImages, readWorkspaceImage } from '@/modules/publishing/server/media/storage';
import { createHash, randomBytes } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { postThumbnail } from '@/components/post-thumbnail';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { canUseFeature, hasPlatformCapability, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { lockSelectedResources, withSelectedResourceOperation } from '@/server/platforms/resource-lock';
import { runtimeConfig } from '@/server/config/store';
import { platformAdsLocale } from '@/server/platforms/host';
import { platformAds } from '@/server/platforms/registry';
import { ADS_MANAGEMENT_DEFAULT_POLICY, ADS_MANAGEMENT_POLICY_SCHEMA, type AdsManagementPolicy } from './config';
import { adsOpsHostFor } from './registry';
import { AdsNoDispatchError, asNoDispatch } from './errors';
import { AD_OBJECT_TYPES, AD_OPERATION_IDS, isCreationOperation, type AdsNeutralOperation, type AdsObjectType, type AdsOpsHost } from './types';

/** `allowedAdAccountIds` is an independent ceiling: [] allows no account (every read/write refuses), undefined adds no restriction. */
export type AdsManageActor = { userId: string; workspaceId: string; allowedTargetIds?: readonly string[]; allowedAdAccountIds?: readonly string[] };
const accountIdCeiling = (actor: AdsManageActor) => actor.allowedAdAccountIds === undefined ? {} : { AND: [{ id: { in: [...actor.allowedAdAccountIds] } }] };
const MANAGER_ROLES = new Set(['owner', 'admin']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const CREATE_TOKEN = /^[A-Za-z0-9_.-]{1,100}$/;
export const OPERATION_STATUSES = ['pending', 'succeeded', 'rejected', 'uncertain', 'resolved_applied', 'resolved_not_applied'] as const;
export type AdsOperationStatus = (typeof OPERATION_STATUSES)[number];

export async function loadAdsManagementPolicy(readConfig: typeof runtimeConfig = runtimeConfig): Promise<AdsManagementPolicy> {
  return withAdsCopySnapshot(async () => {
  try { return ADS_MANAGEMENT_POLICY_SCHEMA.parse(await readConfig('ads.managementPolicy')); }
  catch { throw new OperationError('unavailable', await adsServiceText('service032')); }

  });
}

function scopes(value: string) { return value.split(',').map(scope => scope.trim()).filter(Boolean); }
const objectLevel: Record<AdsObjectType, string> = { campaign: 'campaign', adset: 'adset', ad: 'ad' };
type AdsPageScope = { all: true } | { all: false; ids: readonly string[] };
function allowedTargets(actor: AdsManageActor, pageScope: AdsPageScope) {
  if (actor.allowedTargetIds === undefined) return pageScope.all ? null : [...pageScope.ids];
  return pageScope.all ? [...actor.allowedTargetIds] : pageScope.ids.filter(id => actor.allowedTargetIds!.includes(id));
}
function accountTargetScope(actor: AdsManageActor, pageScope: AdsPageScope) {
  const ids = allowedTargets(actor, pageScope);
  return ids === null ? {} : { targets: { some: { workspaceId: actor.workspaceId, id: { in: ids } } } };
}

/** Optional ad set targeting, shape-checked only (the module checks meaning): absent fields stay absent so older requests keep their exact confirmation. */
function adSetTargeting(value: Record<string, unknown>) {
  const bad = () => new OperationError('invalid_request', defaultAdsText('validation013'));
  const out: { extraCountryCodes?: string[]; ageMin?: number; ageMax?: number; endDate?: string } = {};
  if (value.extraCountryCodes !== undefined) {
    if (!Array.isArray(value.extraCountryCodes) || value.extraCountryCodes.length > 24 || value.extraCountryCodes.some(code => typeof code !== 'string' || !/^[A-Z]{2}$/.test(code))) throw bad();
    if (value.extraCountryCodes.length) out.extraCountryCodes = [...new Set(value.extraCountryCodes as string[])];
  }
  for (const key of ['ageMin', 'ageMax'] as const) if (value[key] !== undefined) {
    if (typeof value[key] !== 'number' || !Number.isInteger(value[key])) throw bad();
    out[key] = value[key] as number;
  }
  if (value.endDate !== undefined) { if (typeof value.endDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.endDate)) throw bad(); out.endDate = value.endDate; }
  return out;
}

/** Parse and bound an untrusted neutral operation. Shape checks only; the module validates semantics. */
export function parseNeutralOperation(raw: unknown, policy: AdsManagementPolicy = ADS_MANAGEMENT_DEFAULT_POLICY): AdsNeutralOperation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OperationError('invalid_request', defaultAdsText('validation007'));
  const value = raw as Record<string, unknown>;
  if (typeof value.parentId === 'string' && value.parentId.length > policy.parentIdMaxCharacters) throw new OperationError('invalid_request', defaultAdsText('validation012'));
  const { type, objectType, objectId } = value;
  if (typeof type !== 'string' || !AD_OPERATION_IDS.includes(type as never) || typeof objectType !== 'string' || ![...AD_OBJECT_TYPES, 'creative'].includes(objectType as never)) throw new OperationError('invalid_request', defaultAdsText('validation007'));
  const keys = (allowed: string[]) => { if (Object.keys(value).some(key => !allowed.includes(key))) throw new OperationError('invalid_request', defaultAdsText('validation007')); };
  const text = (field: unknown, pattern: RegExp, message: string) => { if (typeof field !== 'string' || !pattern.test(field)) throw new OperationError('invalid_request', message); return field; };
  // Creation has no objectId or delivery input. Delivery objects start paused; creatives stay unattached.
  if (type === 'campaign.create') {
    keys(['type', 'objectType', 'name', 'objective']);
    if (objectType !== 'campaign' || typeof value.name !== 'string') throw new OperationError('invalid_request', defaultAdsText('validation008'));
    return { type, objectType, name: value.name.trim(), objective: text(value.objective, CREATE_TOKEN, defaultAdsText('validation009')) };
  }
  if (type === 'adset.create') {
    keys(['type', 'objectType', 'parentId', 'name', 'dailyBudgetMinor', 'countryCode', 'optimizationGoal', 'extraCountryCodes', 'ageMin', 'ageMax', 'endDate']);
    if (objectType !== 'adset' || typeof value.name !== 'string') throw new OperationError('invalid_request', defaultAdsText('validation010'));
    if (typeof value.dailyBudgetMinor !== 'number' || !Number.isSafeInteger(value.dailyBudgetMinor) || value.dailyBudgetMinor < 1) throw new OperationError('invalid_request', defaultAdsText('validation011'));
    return {
      type, objectType, parentId: text(value.parentId, SAFE_ID, defaultAdsText('validation012')), name: value.name.trim(), dailyBudgetMinor: value.dailyBudgetMinor,
      countryCode: text(value.countryCode, /^[A-Z]{2}$/, defaultAdsText('validation013')), optimizationGoal: text(value.optimizationGoal, CREATE_TOKEN, defaultAdsText('validation014')),
      ...adSetTargeting(value),
    };
  }
  if (type === 'ad.create') {
    keys(['type', 'objectType', 'parentId', 'name', 'creativeId']);
    if (objectType !== 'ad' || typeof value.name !== 'string') throw new OperationError('invalid_request', defaultAdsText('adCreateName'));
    return { type, objectType, parentId: text(value.parentId, SAFE_ID, defaultAdsText('adCreateParent')), name: value.name.trim(), creativeId: text(value.creativeId, SAFE_ID, defaultAdsText('validation025')) };
  }
  if (type === 'creative.create' && value.format === 'post') {
    // Promote an already published post of the channel: no image, text or link of our own, only the platform post id.
    keys(['type', 'objectType', 'name', 'targetId', 'format', 'postId']);
    if (objectType !== 'creative' || typeof value.name !== 'string') throw new OperationError('invalid_request', defaultAdsText('validation015'));
    return { type, objectType, name: value.name.trim(), targetId: text(value.targetId, SAFE_ID, defaultAdsText('validation018')), format: 'post', postId: text(value.postId, /^[0-9]{1,40}_[0-9]{1,40}$/, defaultAdsText('validation015')) };
  }
  if (type === 'creative.create') {
    keys(['type', 'objectType', 'name', 'targetId', 'mediaId', 'format', 'message', 'title', 'linkUrl']);
    if (objectType !== 'creative' || typeof value.name !== 'string' || !['image', 'link'].includes(String(value.format)) || typeof value.message !== 'string' || typeof value.title !== 'string' || value.message.length > policy.creativeMessageMaxCharacters || value.title.length > policy.creativeTitleMaxCharacters) throw new OperationError('invalid_request', defaultAdsText('validation015'));
    let linkUrl: string | undefined;
    if (value.format === 'link') {
      try { const url = new URL(String(value.linkUrl)); if (url.protocol !== 'https:' || url.username || url.password || url.href.length > policy.creativeUrlMaxCharacters) throw new Error(); linkUrl = url.href; }
      catch { throw new OperationError('invalid_request', defaultAdsText('validation016')); }
    } else if (value.linkUrl !== undefined) throw new OperationError('invalid_request', defaultAdsText('validation017'));
    return { type, objectType, name: value.name.trim(), targetId: text(value.targetId, SAFE_ID, defaultAdsText('validation018')), mediaId: text(value.mediaId, /^[A-Za-z0-9_.-]{1,150}$/, defaultAdsText('validation019')), format: value.format as 'image' | 'link', message: value.message.trim(), title: value.title.trim(), ...(linkUrl ? { linkUrl } : {}) };
  }
  if (objectType === 'creative') throw new OperationError('invalid_request', defaultAdsText('validation020'));
  if (typeof objectId !== 'string' || !SAFE_ID.test(objectId)) throw new OperationError('invalid_request', defaultAdsText('validation021'));
  const base = { objectType: objectType as AdsObjectType, objectId };
  switch (type) {
    case 'status.set':
      keys(['type', 'objectType', 'objectId', 'status']);
      if (value.status !== 'active' && value.status !== 'paused') throw new OperationError('invalid_request', defaultAdsText('validation022'));
      return { type, ...base, status: value.status };
    case 'budget.set': {
      keys(['type', 'objectType', 'objectId', 'budget']);
      const budget = value.budget as Record<string, unknown> | undefined;
      if (!budget || typeof budget !== 'object' || Object.keys(budget).some(key => key !== 'kind' && key !== 'minor') || (budget.kind !== 'daily' && budget.kind !== 'lifetime') ||
        typeof budget.minor !== 'number' || !Number.isSafeInteger(budget.minor) || budget.minor < 1 || (objectType !== 'campaign' && objectType !== 'adset')) throw new OperationError('invalid_request', defaultAdsText('validation023'));
      return { type, objectType, objectId, budget: { kind: budget.kind, minor: budget.minor } };
    }
    case 'rename':
      keys(['type', 'objectType', 'objectId', 'name']);
      if (typeof value.name !== 'string') throw new OperationError('invalid_request', defaultAdsText('validation024'));
      return { type, ...base, name: value.name.trim() };
    case 'creative.assign':
      keys(['type', 'objectType', 'objectId', 'creativeId']);
      if (objectType !== 'ad' || typeof value.creativeId !== 'string' || !SAFE_ID.test(value.creativeId)) throw new OperationError('invalid_request', defaultAdsText('validation025'));
      return { type, objectType, objectId, creativeId: value.creativeId };
    default:
      keys(['type', 'objectType', 'objectId']);
      return { type: 'delete', ...base };
  }
}

async function authorizeManager(actor: AdsManageActor, level: 'read' | 'write') {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) throw new OperationError('unauthorized', await adsServiceText('service033'));
  const membership = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
  if (!membership) throw new OperationError('unauthorized', await adsServiceText('service034'));
  if (level === 'write' && !MANAGER_ROLES.has(membership.role)) throw new OperationError('forbidden', await adsServiceText('service035'));
  const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId)]);
  if (!entitlements || !permissions || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, 'ads/campaigns') || !canAccessFeature(permissions, 'ads/campaigns', level)) {
    throw new OperationError('forbidden', await adsServiceText('service036'));
  }
  await assertWorkspaceNotPurging(actor.workspaceId);
  return { role: membership.role, entitlements, permissions };
}

async function managedContext(actor: AdsManageActor, adAccountId: string, level: 'read' | 'write') {
  if (typeof adAccountId !== 'string' || !SAFE_ID.test(adAccountId)) throw new OperationError('invalid_request', await adsServiceText('service011'));
  const access = await authorizeManager(actor, level);
  const pageScope = access.permissions.pageScope;
  const account = await prisma.adAccount.findFirst({
    where: {
      id: adAccountId, ...accountIdCeiling(actor), workspaceId: actor.workspaceId, enabled: true,
      socialAccount: { is: { workspaceId: actor.workspaceId, invalidatedAt: null, ...accountTargetScope(actor, pageScope) } },
    },
    select: { id: true, actId: true, currency: true, socialAccount: { select: { provider: true, accessToken: true, scopes: true, invalidatedAt: true, tokenExpiresAt: true } } },
  });
  const connection = account?.socialAccount;
  if (!account || !connection || connection.invalidatedAt || (connection.tokenExpiresAt && connection.tokenExpiresAt <= new Date())) throw new OperationError('reconnect_required', await adsServiceText('service037'));
  if (!hasPlatformCapability(access.entitlements, connection.provider)) throw new OperationError('unavailable', await adsServiceText('service006'));
  const ads = await platformAds(connection.provider, platformAdsLocale());
  const ops = ads?.operations ?? adsOpsHostFor(connection.provider);
  if (!ads || !ops) throw new OperationError('unavailable', await adsServiceText('service038'));
  if (ads.isReady && (await ads.isReady().catch(() => false)) !== true) throw new OperationError('unavailable', await adsServiceText('service038'));
  const required = level === 'write' ? await ads.manageScopes() : await ads.readScopes();
  if (level === 'write') {
    if ((await runtimeConfig('ads.managementEnabled')) !== true) throw new OperationError('unavailable', await adsServiceText('service039'));
    ads.validateManageScopes(required, scopes(connection.scopes));
  } else if (!ads.hasReadScopes(required, scopes(connection.scopes))) throw new OperationError('reconnect_required', await adsServiceText('service040'));
  const accessToken = decryptSecret(connection.accessToken);
  if (!accessToken) throw new OperationError('reconnect_required', await adsServiceText('service041'));
  return { account, ops, credential: { accessToken }, provider: connection.provider, pageScope };
}

function supports(ops: AdsOpsHost, operation: AdsNeutralOperation) {
  const found = ops.operations.find(item => item.id === operation.type);
  if (!found || !found.objectTypes.includes(operation.objectType)) throw new OperationError('unavailable', defaultAdsText('validation026'));
  return found;
}

/**
 * Journal identity of the object a change targets. The ledger columns are NOT NULL and
 * the open-object unique index guards (account, objectType, objectId), so creations use a
 * deterministic placeholder: one unresolved campaign creation per account, and one unresolved
 * ad set creation per parent campaign. This makes a held creation block a duplicate creation.
 */
function ledgerObjectId(operation: AdsNeutralOperation) {
  if (operation.type === 'creative.create') return '@create-creative';
  if (operation.type === 'campaign.create') return '@create-campaign';
  if (operation.type === 'adset.create') return `@create-adset:${operation.parentId}`;
  if (operation.type === 'ad.create') return `@create-ad:${operation.parentId}`;
  return operation.objectId;
}

/** Ad set creation needs unrestricted page scope (the parent can't be bounded to channel targets). */
function assertCreationScope(operation: AdsNeutralOperation, pageScope: AdsPageScope, allowedTargetIds?: readonly string[]) {
  if ((operation.type === 'adset.create' || operation.type === 'ad.create') && (!pageScope.all || allowedTargetIds !== undefined)) throw new OperationError('forbidden', defaultAdsText('validation027'));
}

async function assertOwnedObject(ctx: Awaited<ReturnType<typeof managedContext>>, operation: AdsNeutralOperation) {
  if (operation.type === 'campaign.create' || operation.type === 'creative.create') return;
  const objectType = operation.type === 'adset.create' ? 'campaign' : operation.type === 'ad.create' ? 'adset' : operation.objectType;
  const objectId = 'parentId' in operation ? operation.parentId : 'objectId' in operation ? operation.objectId : '';
  const owned = await prisma.adInsight.findFirst({ where: { adAccountId: ctx.account.id, level: objectLevel[objectType], objectId }, select: { id: true } });
  if (owned) return;
  if (await findStoredAdObject(ctx.account.id, objectType, objectId)) return;
  // The provider host verifies both remote identity and account ownership before returning.
  const host = await platformAds(ctx.provider, platformAdsLocale());
  if (!host || typeof host.read !== 'function') throw new OperationError('not_found', await adsServiceText('service007'));
  const snapshot = await host.read({ credential: ctx.credential, accountId: ctx.account.actId, objectId, objectType });
  if (!snapshot || typeof snapshot !== 'object' || !('id' in snapshot) || snapshot.id !== objectId) throw new OperationError('not_found', await adsServiceText('service007'));

}

/** Resolve only a selected, currently scoped channel from the account's own connection. */
async function creativeContext(actor: AdsManageActor, ctx: Awaited<ReturnType<typeof managedContext>>, operation: AdsNeutralOperation) {
  if (operation.type !== 'creative.create') return undefined;
  const ids = allowedTargets(actor, ctx.pageScope);
  if (ids !== null && !ids.includes(operation.targetId)) throw new OperationError('forbidden', await adsServiceText('service043'));
  const target = await prisma.target.findFirst({
    where: { id: operation.targetId, workspaceId: actor.workspaceId, enabled: true, canPublish: true, socialAccount: { is: { adAccounts: { some: { id: ctx.account.id, workspaceId: actor.workspaceId, enabled: true } }, workspaceId: actor.workspaceId, provider: ctx.provider, invalidatedAt: null } } },
    select: { providerId: true, type: true },
  });
  if (!target || !ctx.ops.creativeIdentityKinds?.includes(String(target.type))) throw new OperationError('not_found', await adsServiceText('service044'));
  if (operation.format === 'post') {
    // Only a post this channel published and the app has synced: never an arbitrary remote id.
    const known = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok FROM post_targets WHERE "targetId" = ${operation.targetId} AND "remotePostId" = ${operation.postId} AND status = 'published'
      UNION ALL SELECT 1 FROM external_posts WHERE "targetId" = ${operation.targetId} AND "remoteId" = ${operation.postId} LIMIT 1`;
    if (!known.length || !operation.postId.startsWith(`${target.providerId}_`)) throw new OperationError('not_found', await adsServiceText('creativePostUnavailable'));
    return { identityId: target.providerId, identityKind: String(target.type) };
  }
  try { return { identityId: target.providerId, identityKind: String(target.type), image: await readWorkspaceImage(actor.workspaceId, operation.mediaId) }; }
  catch { throw new OperationError('not_found', await adsServiceText('service045')); }
}

/** Bounded, authorized choices shared by UI/HTTP/MCP; never exposes storage paths or holder records. */
export async function listAdsCreativeSources(actor: AdsManageActor, input: { adAccountId: string; imageAfter?: string; targetOffset?: number; limit?: number }) {
  return withAdsCopySnapshot(async () => {
  const ctx = await managedContext(actor, input.adAccountId, 'write');
  if (!ctx.ops.operations.some(op => op.id === 'creative.create') || !ctx.ops.creativeIdentityKinds?.length) throw new OperationError('unavailable', await adsServiceText('service046'));
  const policy = await loadAdsManagementPolicy();
  const offset = input.targetOffset ?? 0;
  const limit = Math.min(input.limit ?? policy.creativePageLimit, policy.creativePageLimit);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new OperationError('invalid_request', await adsServiceText('service047'));
  if (!Number.isSafeInteger(offset) || offset < 0 || input.imageAfter !== undefined && (typeof input.imageAfter !== 'string' || input.imageAfter.length > 2048)) throw new OperationError('invalid_request', await adsServiceText('service048'));
  const ids = allowedTargets(actor, ctx.pageScope);
  const [targets, images] = await Promise.all([
    prisma.target.findMany({ where: { workspaceId: actor.workspaceId, enabled: true, canPublish: true, ...(ids === null ? {} : { id: { in: ids } }), type: { in: [...ctx.ops.creativeIdentityKinds] as TargetType[] }, socialAccount: { is: { workspaceId: actor.workspaceId, provider: ctx.provider, invalidatedAt: null, adAccounts: { some: { id: ctx.account.id, enabled: true } } } } }, select: { id: true, name: true }, orderBy: { id: 'asc' }, skip: offset, take: limit + 1 }),
    // Image storage trouble must not hide the channels and their posts: promoting a published post needs no stored image.
    listWorkspaceImages(actor.workspaceId, { limit, ...(input.imageAfter ? { cursor: input.imageAfter } : {}) }).catch(() => ({ items: [] as Array<{ id: string; mimeType: string }>, nextCursor: null as string | null })),
  ]);
  // Recent published posts of the listed channels, newest first: the ones a "promote this post" creative can use.
  const shownTargets = targets.slice(0, limit).map(target => target.id);
  const posts = shownTargets.length ? await prisma.$queryRaw<Array<{ targetId: string; postId: string; text: string | null; publishedAt: Date | null; media: unknown; pictureUrl: string | null }>>`
    SELECT * FROM (
      SELECT pt."targetId", pt."remotePostId" AS "postId", p.message AS text, pt."publishedAt", p.media, NULL::text AS "pictureUrl"
      FROM post_targets pt JOIN posts p ON p.id = pt."postId"
      WHERE pt."targetId" = ANY(${shownTargets}::text[]) AND p."workspaceId" = ${actor.workspaceId} AND pt.status = 'published' AND pt."remotePostId" IS NOT NULL
      UNION ALL
      SELECT ep."targetId", ep."remoteId", ep.message, ep."createdTime", '[]'::jsonb, ep."pictureUrl"
      FROM external_posts ep
      WHERE ep."targetId" = ANY(${shownTargets}::text[]) AND NOT EXISTS (SELECT 1 FROM post_targets pt WHERE pt."targetId" = ep."targetId" AND pt."remotePostId" = ep."remoteId")
    ) recent WHERE "postId" ~ '^[0-9]+_[0-9]+$' ORDER BY "publishedAt" DESC NULLS LAST LIMIT ${policy.creativePageLimit}` : [];
  return { targets: targets.slice(0, limit), nextTargetOffset: targets.length > limit ? offset + limit : null, images: images.items.map(item => ({ id: item.id, mimeType: item.mimeType })), nextImageAfter: images.nextCursor,
    posts: posts.map(post => ({ targetId: post.targetId, postId: post.postId, text: (post.text ?? '').slice(0, 200), publishedAt: post.publishedAt?.toISOString() ?? null, thumbnailUrl: postThumbnail(post.media, post.pictureUrl)?.url ?? null })), nameMaxCharacters: policy.nameMaxCharacters, creativeMessageMaxCharacters: policy.creativeMessageMaxCharacters, creativeTitleMaxCharacters: policy.creativeTitleMaxCharacters, creativeUrlMaxCharacters: policy.creativeUrlMaxCharacters };

  });
}

/** Private UI preview uses the same active-account authorization and stored-image reader as creation. */
export async function readAdsCreativeImage(actor: AdsManageActor, input: { adAccountId: string; mediaId: string }) {
  return withAdsCopySnapshot(async () => {
  const ctx = await managedContext(actor, input.adAccountId, 'write');
  if (!ctx.ops.operations.some(op => op.id === 'creative.create')) throw new OperationError('unavailable', await adsServiceText('service046'));
  try { return await readWorkspaceImage(actor.workspaceId, input.mediaId); }
  catch { throw new OperationError('not_found', await adsServiceText('service045')); }

  });
}

/** Root-managed bounds apply to every module before its own validation; the module may only be stricter. */
async function validateWithPolicy(ops: AdsOpsHost, operation: AdsNeutralOperation) {
  const policy = await loadAdsManagementPolicy();
  if (operation.type === 'rename' && (!operation.name || operation.name.length > policy.nameMaxCharacters)) throw new OperationError('invalid_request', defaultAdsText('validation028', { value0: policy.nameMaxCharacters }));
  if (isCreationOperation(operation) && (!operation.name || operation.name.length > policy.nameMaxCharacters)) throw new OperationError('invalid_request', defaultAdsText('validation028', { value0: policy.nameMaxCharacters }));
  if (operation.type === 'adset.create' && operation.dailyBudgetMinor > policy.maxBudgetMinor) throw new OperationError('invalid_request', await adsServiceText('service049'));
  if (operation.type === 'budget.set' && operation.budget.minor > policy.maxBudgetMinor) throw new OperationError('invalid_request', await adsServiceText('service049'));
  ops.validate(operation, { nameMaxCharacters: policy.nameMaxCharacters, maxBudgetMinor: policy.maxBudgetMinor });
  await ops.validateCurrent?.(operation, { nameMaxCharacters: policy.nameMaxCharacters, maxBudgetMinor: policy.maxBudgetMinor });
}

/** What this actor may do on one account; the UI shows only advertised operations. */
export async function describeAdsManagement(actor: AdsManageActor, adAccountId: string) {
  return withAdsCopySnapshot(async () => {
  try {
    const ctx = await managedContext(actor, adAccountId, 'write');
    const policy = await loadAdsManagementPolicy();
    return { canManage: true as const, operations: ctx.ops.operations.map(item => ({ ...item })), canListCreatives: Boolean(ctx.ops.listCreatives), limits: { ...policy } };
  } catch (error) {
    if (error instanceof OperationError && ['forbidden', 'unauthorized', 'unavailable', 'reconnect_required', 'not_found'].includes(error.code)) return { canManage: false as const, needsReconnect: error.code === 'reconnect_required', operations: [], canListCreatives: false };
    throw error;
  }

  });
}

/** Returns the exact confirmation a caller must repeat. No remote or ledger write. */
export async function previewAdsManagement(actor: AdsManageActor, input: { adAccountId: string; operation: unknown }) {
  return withAdsCopySnapshot(async () => {
  const operation = parseNeutralOperation(input.operation, await loadAdsManagementPolicy());
  const ctx = await managedContext(actor, input.adAccountId, 'write');
  const support = supports(ctx.ops, operation);
  assertCreationScope(operation, ctx.pageScope, actor.allowedTargetIds);
  await validateWithPolicy(ctx.ops, operation);
  await assertOwnedObject(ctx, operation);
  await creativeContext(actor, ctx, operation);
  // Best effort: tells the caller an earlier unresolved change will refuse this one. Null when the ledger cannot be read.
  const held = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM ads_management_operations WHERE "workspaceId" = ${actor.workspaceId} AND "adAccountId" = ${ctx.account.id} AND "objectType" = ${operation.objectType} AND "objectId" = ${ledgerObjectId(operation)} AND status IN ('pending','uncertain') LIMIT 1`
    .then(rows => rows.length > 0, () => null);
  return { confirmation: ctx.ops.confirmation(operation, { adAccountId: ctx.account.id, currency: ctx.account.currency }), spendChanging: support.spendChanging, irreversible: support.irreversible === true, blockedByOpenChange: held, operation };

  });
}

const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`;
const isDuplicate = (error: unknown) => /23505|duplicate key|unique constraint/i.test(String((error as { message?: unknown })?.message ?? '') + String((error as { code?: unknown })?.code ?? ''));
type Executor = Pick<typeof prisma, '$executeRaw'>;
const audit = (actor: AdsManageActor, action: string, detail: Record<string, unknown>, db: Executor = prisma) =>
  db.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${newId('ads')}, ${actor.userId}, ${action}, ${JSON.stringify({ workspaceId: actor.workspaceId, ...detail })}::jsonb, NOW())`;

export type AdsManagementOutcome =
  | { outcome: 'succeeded'; operationId: string; remoteId: string | null; recorded: boolean; warning?: string; replay?: true; status?: AdsOperationStatus; created?: AdsCreatedObject }
  | { outcome: 'rejected'; operationId: string; message: string; terminal?: true; replay?: true; status?: AdsOperationStatus }
  | { outcome: 'uncertain'; operationId: string; message: string };

/** Present only when the provider proved a creation (or a recorded success is replayed). Never on pending/uncertain/rejected. */
export type AdsCreatedObject = { objectType: 'campaign' | 'adset' | 'ad' | 'creative'; remoteId: string };
type AdsLedgerStatus = { status: string; remoteId: string | null; operationType?: string; objectType?: string };
function createdFrom(ledger: { operationType?: string; objectType?: string }, remoteId: string | null): { created?: AdsCreatedObject } {
  if (!remoteId || (ledger.operationType !== 'campaign.create' && ledger.operationType !== 'adset.create' && ledger.operationType !== 'ad.create' && ledger.operationType !== 'creative.create')) return {};
  return { created: { objectType: ledger.operationType === 'campaign.create' ? 'campaign' : ledger.operationType === 'creative.create' ? 'creative' : ledger.operationType === 'ad.create' ? 'ad' : 'adset', remoteId } };
}
class AdsIntentNoLongerPending extends Error {
  constructor(readonly ledger: AdsLedgerStatus) { super(defaultAdsText('validation029')); }
}

function replayLedgerOutcome(operationId: string, ledger: AdsLedgerStatus): AdsManagementOutcome {
  if (ledger.status === 'succeeded') return { outcome: 'succeeded', operationId, remoteId: ledger.remoteId, recorded: true, replay: true, status: ledger.status, ...createdFrom(ledger, ledger.remoteId) };
  // A human attestation never proves a created object's identity, so no `created` is returned.
  if (ledger.status === 'resolved_applied') return { outcome: 'succeeded', operationId, remoteId: ledger.remoteId, recorded: true, replay: true, status: ledger.status };
  if (ledger.status === 'resolved_not_applied') return { outcome: 'rejected', operationId, message: defaultAdsText('validation030'), terminal: true, replay: true, status: 'resolved_not_applied' };
  if (ledger.status === 'rejected') return { outcome: 'rejected', operationId, message: defaultAdsText('validation031') };
  if (ledger.status === 'uncertain') return { outcome: 'uncertain', operationId, message: defaultAdsText('validation032') };
  throw new OperationError('conflict', defaultAdsText('validation033'));
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;
function requestPayloadHash(adAccountId: string, operation: AdsNeutralOperation) {
  return createHash('sha256').update(JSON.stringify({ adAccountId, operation })).digest('hex');
}

async function replayRequest(actor: AdsManageActor, requestId: string, requestHash: string): Promise<AdsManagementOutcome | null> {
  const rows = await prisma.$queryRaw<Array<{ id: string; requestHash: string; status: string; remoteId: string | null; operationType?: string; objectType?: string }>>`
    SELECT id, "requestHash", status, "remoteId", "operationType", "objectType" FROM ads_management_operations
    WHERE "workspaceId" = ${actor.workspaceId} AND "actorId" = ${actor.userId} AND "requestId" = ${requestId} LIMIT 1`;
  const row = rows[0];
  if (!row) return null;
  if (row.requestHash !== requestHash) throw new OperationError('conflict', await adsServiceText('service050'));
  return replayLedgerOutcome(row.id, row);
}

/**
 * Apply one neutral change. A durable pending record is written BEFORE the remote
 * call; an unknown outcome is never retried automatically and blocks further
 * changes to the same object until a manager resolves it.
 */
export async function performAdsManagement(actor: AdsManageActor, input: { adAccountId: string; operation: unknown; confirmation: unknown; requestId: unknown }): Promise<AdsManagementOutcome> {
  return withAdsCopySnapshot(async () => {
  if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) throw new OperationError('invalid_request', await adsServiceText('service051'));
  const operation = parseNeutralOperation(input.operation, await loadAdsManagementPolicy());
  // Creation only: a preflight failure of THIS send happened before its intent and any provider request. It says nothing about an earlier send of the same request id.
  const beforeJournal = isCreationOperation(operation) ? asNoDispatch : (error: unknown) => error;
  let ctx: Awaited<ReturnType<typeof managedContext>>, support: ReturnType<typeof supports>, expected: string;
  try {
    ctx = await managedContext(actor, input.adAccountId, 'write');
    support = supports(ctx.ops, operation);
    assertCreationScope(operation, ctx.pageScope, actor.allowedTargetIds);
    await validateWithPolicy(ctx.ops, operation);
    expected = ctx.ops.confirmation(operation, { adAccountId: ctx.account.id, currency: ctx.account.currency });
    if (input.confirmation !== expected) throw new OperationError('invalid_request', `Confirmation required. Repeat with confirmation exactly: ${expected}`);
    if (operation.type === 'creative.create') {
      const ids = allowedTargets(actor, ctx.pageScope);
      if (ids !== null && !ids.includes(operation.targetId)) throw new OperationError('forbidden', await adsServiceText('service043'));
      const replay = await replayRequest(actor, input.requestId, requestPayloadHash(ctx.account.id, operation));
      if (replay) return replay;
    }
    await assertOwnedObject(ctx, operation);
    await creativeContext(actor, ctx, operation);
  } catch (error) { throw beforeJournal(error); }

  const id = newId('adsop');
  const requestHash = requestPayloadHash(ctx.account.id, operation);
  try {
    await prisma.$transaction(async tx => {
      await lockSelectedResources(tx, actor.workspaceId, [{ kind: 'adAccount', id: ctx.account.id }]);
      const active = await tx.adAccount.findFirst({ where: { id: ctx.account.id, workspaceId: actor.workspaceId, enabled: true }, select: { id: true } });
      if (!active) throw new OperationError('reconnect_required', await adsServiceText('service052'));
      await tx.$executeRaw`INSERT INTO ads_management_operations (id, "workspaceId", "adAccountId", "actorId", "requestId", "requestHash", "operationType", "objectType", "objectId", params, status, "createdAt", "updatedAt")
        VALUES (${id}, ${actor.workspaceId}, ${ctx.account.id}, ${actor.userId}, ${input.requestId}, ${requestHash}, ${operation.type}, ${operation.objectType}, ${ledgerObjectId(operation)}, ${JSON.stringify(operation)}::jsonb, 'pending', NOW(), NOW())`;
    });
  } catch (error) {
    if (isDuplicate(error)) {
      let lookedUp = false;
      try {
        const replay = await replayRequest(actor, input.requestId, requestHash);
        lookedUp = true;
        if (replay) return replay;
      } catch (replayError) {
        if (replayError instanceof OperationError) throw replayError;
      }
      const message = await adsServiceText('service053');
      // A successful lookup finding no row for this request id means THIS send was not recorded; an earlier send could still be in flight, so clients must not release a request they already sent unresolved.
      if (lookedUp && isCreationOperation(operation)) throw new AdsNoDispatchError('conflict', message, 'blocked_by_other_request');
      throw new OperationError('conflict', message);
    }
    // An OperationError here is one of our own checks raised before the INSERT, so this send recorded nothing.
    if (error instanceof OperationError) throw beforeJournal(error);
    // Any other failure (including a lost commit acknowledgement) may have committed the intent: never claim it was not recorded.
    throw new OperationError('unavailable', await adsServiceText('service054'));
  }

  let current: Awaited<ReturnType<typeof managedContext>> | undefined;
  let providerDispatched = false;
  let creative: Awaited<ReturnType<typeof creativeContext>>;
  try {
    // The same fail-fast lock serializes selection changes through current authorization and provider dispatch.
    return await withSelectedResourceOperation(actor.workspaceId, { kind: 'adAccount', id: ctx.account.id }, async (_tx, signal) => {
      signal.throwIfAborted();
      if (operation.type === 'creative.create') await lockSelectedResources(_tx, actor.workspaceId, [{ kind: 'target', id: operation.targetId }]);
      const [ledger] = await _tx.$queryRaw<AdsLedgerStatus[]>`SELECT status, "remoteId", "operationType", "objectType" FROM ads_management_operations WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
      if (!ledger || ledger.status !== 'pending') throw new AdsIntentNoLongerPending(ledger ?? { status: 'missing', remoteId: null });
      try {
        current = await managedContext(actor, input.adAccountId, 'write');
        if (current.account.id !== ctx.account.id || current.provider !== ctx.provider || current.ops.provider !== ctx.ops.provider) throw new OperationError('conflict', await adsServiceText('service055'));
        supports(current.ops, operation);
        assertCreationScope(operation, current.pageScope, actor.allowedTargetIds);
        await validateWithPolicy(current.ops, operation);
        creative = await creativeContext(actor, current, operation);
        await assertOwnedObject(current, operation);
        if (current.ops.confirmation(operation, { adAccountId: current.account.id, currency: current.account.currency }) !== expected) throw new OperationError('conflict', await adsServiceText('service056'));
        signal.throwIfAborted();
      } catch (error) {
        const changed = Number(await _tx.$executeRaw`UPDATE ads_management_operations SET status = 'rejected', "failureCode" = 'authority_changed', "updatedAt" = NOW(), "completedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} AND status = 'pending'`);
        if (changed !== 1) throw error;
        await audit(actor, 'ads.change_rejected', { operationId: id, adAccountId: ctx.account.id, operation: operation.type, objectType: operation.objectType, objectId: ledgerObjectId(operation), reason: 'authority_changed' }, _tx);
        const message = error instanceof OperationError ? error.message : await adsServiceText('service057');
        return { outcome: 'rejected' as const, status: 'rejected' as const, operationId: id, message: `No advertising change was sent. ${message}` };
      }

      providerDispatched = true;
      let result: { remoteId?: string };
      try {
        result = await current!.ops.execute({ credential: current!.credential, accountId: current!.account.actId, signal, ...(creative ? { creative } : {}), recordReceipt: async receipt => {
          await audit(actor, 'ads.creation_receipt', { operationId: id, adAccountId: ctx.account.id, receipt });
        } }, operation);
      } catch (error) {
        // Record the provider result under the same selected-resource lock before recovery can proceed.
        console.warn('[ads-change] provider failure', { operationId: id, operation: operation.type, name: error instanceof Error ? error.name : 'unknown', message: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, '[url]').replace(/(token|secret)=\S+/gi, '$1=[redacted]').slice(0, 300) : undefined, code: (error as { code?: unknown })?.code, subcode: (error as { subcode?: unknown })?.subcode, status: (error as { status?: unknown })?.status, detail: (error as { detail?: unknown })?.detail });
        let kind: 'rejected' | 'uncertain';
        try { kind = current!.ops.classifyFailure(error) === 'rejected' ? 'rejected' : 'uncertain'; } catch { kind = 'uncertain'; }
        const status: AdsOperationStatus = kind === 'rejected' ? 'rejected' : 'uncertain';
        const code = kind === 'rejected' ? 'rejected' : 'unknown_outcome';
        const changed = Number(await _tx.$executeRaw`UPDATE ads_management_operations SET status = ${status}, "failureCode" = ${code}, "updatedAt" = NOW(), "completedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} AND status = 'pending'`);
        if (changed !== 1) throw new AdsIntentNoLongerPending({ status: 'uncertain', remoteId: null });
        await audit(actor, `ads.change_${status}`, { operationId: id, adAccountId: ctx.account.id, operation: operation.type, objectType: operation.objectType, objectId: ledgerObjectId(operation) }, _tx);
        return kind === 'rejected'
          ? { outcome: 'rejected' as const, status: 'rejected' as const, operationId: id, message: await adsServiceText('service058') }
          : { outcome: 'uncertain' as const, operationId: id, message: await adsServiceText('service059') };
      }

      const resultRemoteId = result.remoteId ?? null;
      if (isCreationOperation(operation) && (resultRemoteId === null || !SAFE_ID.test(resultRemoteId))) {
        // The provider returned without a verifiable identity: it may have created an object, so hold it as uncertain.
        const held = Number(await _tx.$executeRaw`UPDATE ads_management_operations SET status = 'uncertain', "failureCode" = 'missing_remote_id', "updatedAt" = NOW(), "completedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} AND status = 'pending'`);
        if (held !== 1) throw new AdsIntentNoLongerPending({ status: 'uncertain', remoteId: null });
        await audit(actor, 'ads.change_uncertain', { operationId: id, adAccountId: ctx.account.id, operation: operation.type, objectType: operation.objectType, objectId: ledgerObjectId(operation) }, _tx);
        return { outcome: 'uncertain' as const, operationId: id, message: await adsServiceText('service059') };
      }
      const created = isCreationOperation(operation) ? { created: { objectType: operation.objectType, remoteId: resultRemoteId! } } : {};
      const changed = Number(await _tx.$executeRaw`UPDATE ads_management_operations SET status = 'succeeded', "remoteId" = ${resultRemoteId}, "updatedAt" = NOW(), "completedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} AND status = 'pending'`);
      if (changed !== 1) return { outcome: 'succeeded' as const, operationId: id, remoteId: resultRemoteId, recorded: false, warning: await adsServiceText('service060'), ...created };
      await recordAdObjectChange(_tx, ctx.account.id, operation, resultRemoteId);
      await audit(actor, 'ads.change_applied', { operationId: id, adAccountId: ctx.account.id, operation: operation.type, objectType: operation.objectType, objectId: ledgerObjectId(operation), spendChanging: support.spendChanging, ...(isCreationOperation(operation) ? { remoteId: resultRemoteId, createdPaused: operation.type !== 'creative.create', ...(operation.type === 'creative.create' ? { delivery: 'unattached' } : {}) } : {}) }, _tx);
      return { outcome: 'succeeded' as const, operationId: id, remoteId: resultRemoteId, recorded: true, ...created };
    });
  } catch (error) {
    if (error instanceof AdsIntentNoLongerPending) return replayLedgerOutcome(id, error.ledger);
    if (!providerDispatched) {
      // Lock/config failure before provider dispatch proves no provider write was sent; retain pending for explicit recovery.
      const message = error instanceof OperationError ? error.message : await adsServiceText('service057');
      return { outcome: 'rejected', operationId: id, message: `No advertising change was sent. ${message}` };
    }
    // Any failure after dispatch may have applied remotely. Leave the committed pending intent held for explicit review.
    return { outcome: 'uncertain', operationId: id, message: await adsServiceText('service059') };
  }

  });
}

type OperationRow = { id: string; adAccountId: string; actorId: string; operationType: string; objectType: string; objectId: string; params: unknown; status: string; remoteId: string | null; failureCode: string | null; createdAt: Date; completedAt: Date | null; resolvedBy: string | null; resolvedAt: Date | null; resolutionNote: string | null; receipts?: unknown };
const present = (row: OperationRow) => ({
  id: row.id, adAccountId: row.adAccountId, actorId: row.actorId, operationType: row.operationType, objectType: row.objectType, objectId: row.objectId, params: row.params, receipts: row.receipts ?? [],
  status: row.status, remoteId: row.remoteId, failureCode: row.failureCode, createdAt: row.createdAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null, resolvedAt: row.resolvedAt?.toISOString() ?? null, resolvedBy: row.resolvedBy, resolutionNote: row.resolutionNote,
  // Pending entries can be recovered only after acquiring the selected-account lock; in-flight dispatch remains held there.
  needsResolution: row.status === 'pending' || row.status === 'uncertain',
  resolutionKind: row.status === 'pending' ? 'pending_recovery' : row.status === 'uncertain' ? 'uncertain' : null,
  onHold: row.status === 'pending' || row.status === 'uncertain',
});

export async function listAdsOperations(actor: AdsManageActor, input: { adAccountId?: string; status?: string; offset?: number; limit?: number } = {}) {
  return withAdsCopySnapshot(async () => {
  const access = await authorizeManager(actor, 'write');
  const policy = await loadAdsManagementPolicy();
  const status = input.status;
  if (status !== undefined && !OPERATION_STATUSES.includes(status as AdsOperationStatus)) throw new OperationError('invalid_request', await adsServiceText('service061'));
  if (input.adAccountId !== undefined && !SAFE_ID.test(input.adAccountId)) throw new OperationError('invalid_request', await adsServiceText('service011'));
  const offset = input.offset ?? 0, limit = Math.min(input.limit ?? policy.historyPageLimit, policy.historyPageLimit);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new OperationError('invalid_request', await adsServiceText('service062'));
  // Visible accounts follow the caller's channel scope; history never crosses workspaces.
  const pageScope = access.permissions.pageScope;
  const visible = await prisma.adAccount.findMany({
    where: { workspaceId: actor.workspaceId, ...accountIdCeiling(actor), socialAccount: { is: { workspaceId: actor.workspaceId, ...accountTargetScope(actor, pageScope) } } },
    select: { id: true },
  });
  const ids = visible.map(item => item.id).filter(id => input.adAccountId === undefined || id === input.adAccountId);
  if (!ids.length) return { items: [], offset, limit, nextOffset: null as number | null };
  const targetIds = allowedTargets(actor, pageScope);
  const rows = await prisma.$queryRaw<OperationRow[]>`SELECT (SELECT jsonb_agg(r.detail->'receipt') FROM (SELECT detail FROM root_activities WHERE action = 'ads.creation_receipt' AND detail->>'operationId' = ads_management_operations.id AND detail->>'workspaceId' = ${actor.workspaceId} ORDER BY "createdAt" DESC LIMIT 2) r) AS receipts, id, "adAccountId", "actorId", "operationType", "objectType", "objectId", params, status, "remoteId", "failureCode", "createdAt", "completedAt", "resolvedBy", "resolvedAt", "resolutionNote"
    FROM ads_management_operations WHERE "workspaceId" = ${actor.workspaceId} AND "adAccountId" = ANY(${ids}) AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
    AND ("operationType" <> 'creative.create' OR ${targetIds}::text[] IS NULL OR params->>'targetId' = ANY(${targetIds}::text[]))
    ORDER BY "createdAt" DESC, id ASC OFFSET ${offset} LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  return { items: page.map(present), offset, limit, nextOffset: rows.length > limit ? offset + limit : null };

  });
}

export type AdsResolution = 'applied' | 'not_applied';
export const resolutionConfirmation = (operationId: string, resolution: AdsResolution) => `RESOLVE ADS CHANGE ${operationId} AS ${resolution === 'applied' ? 'APPLIED' : 'NOT APPLIED'}`;
export const pendingRecoveryConfirmation = (operationId: string, resolution: AdsResolution) => `RECOVER ADS CHANGE ${operationId} AS ${resolution === 'applied' ? 'APPLIED' : 'NOT APPLIED'}`;

/** Human attestation for an unknown outcome. Never contacts the provider and never repeats the write. */
export async function resolveAdsOperation(actor: AdsManageActor, input: { operationId: string; resolution: AdsResolution; note?: string; confirmation: string }) {
  return withAdsCopySnapshot(async () => {
  if (typeof input.operationId !== 'string' || !SAFE_ID.test(input.operationId) || (input.resolution !== 'applied' && input.resolution !== 'not_applied')) throw new OperationError('invalid_request', await adsServiceText('service063'));
  const policy = await loadAdsManagementPolicy();
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > policy.recoveryNoteMaxCharacters || /[\u0000-\u001f\u007f]/.test(input.note))) throw new OperationError('invalid_request', await adsServiceText('service064', { max: policy.recoveryNoteMaxCharacters }));
  const access = await authorizeManager(actor, 'write');
  const rows = await prisma.$queryRaw<OperationRow[]>`SELECT (SELECT jsonb_agg(r.detail->'receipt') FROM (SELECT detail FROM root_activities WHERE action = 'ads.creation_receipt' AND detail->>'operationId' = ads_management_operations.id AND detail->>'workspaceId' = ${actor.workspaceId} ORDER BY "createdAt" DESC LIMIT 2) r) AS receipts, id, "adAccountId", "actorId", "operationType", "objectType", "objectId", params, status, "remoteId", "failureCode", "createdAt", "completedAt", "resolvedBy", "resolvedAt", "resolutionNote"
    FROM ads_management_operations WHERE id = ${input.operationId} AND "workspaceId" = ${actor.workspaceId}`;
  const row = rows[0];
  if (!row) throw new OperationError('not_found', await adsServiceText('service065'));
  // Recovery must use the same account/channel ceilings as management and history.
  // Retained accounts need no active connection or provider grant: this only records an attestation.
  const assertVisible = async (currentAccess: typeof access, accounts = prisma.adAccount) => {
    const targetIds = allowedTargets(actor, currentAccess.permissions.pageScope);
    if (row.operationType === 'creative.create' && targetIds !== null && !targetIds.includes((row.params as { targetId: string })?.targetId)) throw new OperationError('not_found', await adsServiceText('service065'));
    const visible = await accounts.findFirst({
      where: { id: row.adAccountId, ...accountIdCeiling(actor), workspaceId: actor.workspaceId, socialAccount: { is: { workspaceId: actor.workspaceId, ...accountTargetScope(actor, currentAccess.permissions.pageScope) } } },
      select: { id: true },
    });
    if (!visible) throw new OperationError('not_found', await adsServiceText('service065'));
  };
  await assertVisible(access);
  if (row.status !== 'pending' && row.status !== 'uncertain') throw new OperationError('conflict', await adsServiceText('service066'));
  const expected = row.status === 'pending' ? pendingRecoveryConfirmation(input.operationId, input.resolution) : resolutionConfirmation(input.operationId, input.resolution);
  if (input.confirmation !== expected) throw new OperationError('invalid_request', `Confirmation required. Repeat with confirmation exactly: ${expected}`);
  const next = input.resolution === 'applied' ? 'resolved_applied' : 'resolved_not_applied';
  let settled: boolean;
  try {
    settled = await withSelectedResourceOperation(actor.workspaceId, { kind: 'adAccount', id: row.adAccountId }, async (tx, signal) => {
      signal.throwIfAborted();
      const [current] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM ads_management_operations WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
      if (!current || current.status !== row.status) return false;
      // Authority can change after preflight; check again while holding the account/ledger locks.
      await assertVisible(await authorizeManager(actor, 'write'), tx.adAccount);
      signal.throwIfAborted();
      const changed = Number(await tx.$executeRaw`UPDATE ads_management_operations SET status = ${next}, "resolvedBy" = ${actor.userId}, "resolvedAt" = NOW(), "resolutionNote" = ${input.note ?? null}, "updatedAt" = NOW()
        WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId} AND status = ${row.status}`);
      if (changed !== 1) return false;
      await audit(actor, 'ads.change_resolved', { operationId: row.id, adAccountId: row.adAccountId, resolution: input.resolution, recoveredPending: row.status === 'pending' }, tx);
      return true;
    });
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError('unavailable', await adsServiceText('service067'));
  }
  if (!settled) throw new OperationError('conflict', await adsServiceText('service068'));
  return { operationId: row.id, status: next, recoveredPending: row.status === 'pending', receipt: { affectedRows: 1, resolvedBy: actor.userId } };

  });
}

/** Browse the module's existing creatives for assigning to an ad (read-only). */
export async function listAdsCreatives(actor: AdsManageActor, input: { adAccountId: string; after?: string; limit?: number }) {
  return withAdsCopySnapshot(async () => {
  const ctx = await managedContext(actor, input.adAccountId, 'write');
  if (!ctx.ops.listCreatives) throw new OperationError('unavailable', await adsServiceText('service069'));
  const policy = await loadAdsManagementPolicy();
  const limit = Math.min(input.limit ?? policy.creativePageLimit, policy.creativePageLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || (input.after !== undefined && (typeof input.after !== 'string' || input.after.length > 500))) throw new OperationError('invalid_request', await adsServiceText('service062'));
  try { return await ctx.ops.listCreatives({ credential: ctx.credential, accountId: ctx.account.actId }, { limit, ...(input.after ? { after: input.after } : {}) }); }
  catch { throw new OperationError('upstream_failure', await adsServiceText('service070')); }

  });
}
