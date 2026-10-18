import { createHash, randomBytes } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { decryptSecret } from '@/server/secret-crypto';
import { canUseFeature, hasPlatformCapability, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { assertWorkspaceNotPurging } from '@/server/data-control/guard';
import { lockSelectedResources, withSelectedResourceOperation } from '@/server/platforms/resource-lock';
import { runtimeConfig } from '@/server/config/store';
import { platformAds } from '@/server/platforms/registry';
import { ADS_MANAGEMENT_POLICY_SCHEMA, type AdsManagementPolicy } from './config';
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
  try { return ADS_MANAGEMENT_POLICY_SCHEMA.parse(await readConfig('ads.managementPolicy')); }
  catch { throw new OperationError('unavailable', 'Ads management is temporarily unavailable. Try again later.'); }
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

/** Parse and bound an untrusted neutral operation. Shape checks only; the module validates semantics. */
export function parseNeutralOperation(raw: unknown): AdsNeutralOperation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new OperationError('invalid_request', 'Choose a valid ad change.');
  const value = raw as Record<string, unknown>;
  const { type, objectType, objectId } = value;
  if (typeof type !== 'string' || !AD_OPERATION_IDS.includes(type as never) || typeof objectType !== 'string' || !AD_OBJECT_TYPES.includes(objectType as never)) throw new OperationError('invalid_request', 'Choose a valid ad change.');
  const keys = (allowed: string[]) => { if (Object.keys(value).some(key => !allowed.includes(key))) throw new OperationError('invalid_request', 'Choose a valid ad change.'); };
  const text = (field: unknown, pattern: RegExp, message: string) => { if (typeof field !== 'string' || !pattern.test(field)) throw new OperationError('invalid_request', message); return field; };
  // Creation has no existing object: no objectId, no status. The platform module always creates paused.
  if (type === 'campaign.create') {
    keys(['type', 'objectType', 'name', 'objective']);
    if (objectType !== 'campaign' || typeof value.name !== 'string') throw new OperationError('invalid_request', 'Enter a campaign name and objective.');
    return { type, objectType, name: value.name.trim(), objective: text(value.objective, CREATE_TOKEN, 'Choose a valid campaign objective.') };
  }
  if (type === 'adset.create') {
    keys(['type', 'objectType', 'parentId', 'name', 'dailyBudgetMinor', 'countryCode', 'optimizationGoal']);
    if (objectType !== 'adset' || typeof value.name !== 'string') throw new OperationError('invalid_request', 'Enter an ad set name.');
    if (typeof value.dailyBudgetMinor !== 'number' || !Number.isSafeInteger(value.dailyBudgetMinor) || value.dailyBudgetMinor < 1) throw new OperationError('invalid_request', 'Budgets must be positive whole minor currency units.');
    return {
      type, objectType, parentId: text(value.parentId, SAFE_ID, 'Choose a valid campaign.'), name: value.name.trim(), dailyBudgetMinor: value.dailyBudgetMinor,
      countryCode: text(value.countryCode, /^[A-Z]{2}$/, 'Enter a two-letter country code.'), optimizationGoal: text(value.optimizationGoal, CREATE_TOKEN, 'Choose a valid optimization goal.'),
    };
  }
  if (typeof objectId !== 'string' || !SAFE_ID.test(objectId)) throw new OperationError('invalid_request', 'Invalid ad object.');
  const base = { objectType: objectType as AdsObjectType, objectId };
  switch (type) {
    case 'status.set':
      keys(['type', 'objectType', 'objectId', 'status']);
      if (value.status !== 'active' && value.status !== 'paused') throw new OperationError('invalid_request', 'Invalid ad status.');
      return { type, ...base, status: value.status };
    case 'budget.set': {
      keys(['type', 'objectType', 'objectId', 'budget']);
      const budget = value.budget as Record<string, unknown> | undefined;
      if (!budget || typeof budget !== 'object' || Object.keys(budget).some(key => key !== 'kind' && key !== 'minor') || (budget.kind !== 'daily' && budget.kind !== 'lifetime') ||
        typeof budget.minor !== 'number' || !Number.isSafeInteger(budget.minor) || budget.minor < 1 || (objectType !== 'campaign' && objectType !== 'adset')) throw new OperationError('invalid_request', 'Budgets must be positive whole minor currency units on a campaign or ad set.');
      return { type, objectType, objectId, budget: { kind: budget.kind, minor: budget.minor } };
    }
    case 'rename':
      keys(['type', 'objectType', 'objectId', 'name']);
      if (typeof value.name !== 'string') throw new OperationError('invalid_request', 'Enter a name.');
      return { type, ...base, name: value.name.trim() };
    case 'creative.assign':
      keys(['type', 'objectType', 'objectId', 'creativeId']);
      if (objectType !== 'ad' || typeof value.creativeId !== 'string' || !SAFE_ID.test(value.creativeId)) throw new OperationError('invalid_request', 'Choose an ad and a creative.');
      return { type, objectType, objectId, creativeId: value.creativeId };
    default:
      keys(['type', 'objectType', 'objectId']);
      return { type: 'delete', ...base };
  }
}

async function authorizeManager(actor: AdsManageActor, level: 'read' | 'write') {
  const user = await prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) throw new OperationError('unauthorized', 'Sign in with an active account to manage ads.');
  const membership = await prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } });
  if (!membership) throw new OperationError('unauthorized', 'You are no longer a member of this workspace.');
  if (level === 'write' && !MANAGER_ROLES.has(membership.role)) throw new OperationError('forbidden', 'Only workspace owners and admins can manage ads.');
  const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId)]);
  if (!entitlements || !permissions || entitlements.workspaceId !== actor.workspaceId || !canUseFeature(entitlements, 'ads/campaigns') || !canAccessFeature(permissions, 'ads/campaigns', level)) {
    throw new OperationError('forbidden', 'Ads management is not available for this workspace.');
  }
  await assertWorkspaceNotPurging(actor.workspaceId);
  return { role: membership.role, entitlements, permissions };
}

async function managedContext(actor: AdsManageActor, adAccountId: string, level: 'read' | 'write') {
  if (typeof adAccountId !== 'string' || !SAFE_ID.test(adAccountId)) throw new OperationError('invalid_request', 'Choose an advertising account.');
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
  if (!account || !connection || connection.invalidatedAt || (connection.tokenExpiresAt && connection.tokenExpiresAt <= new Date())) throw new OperationError('reconnect_required', 'This advertising account or its connection is unavailable. Reconnect it before managing ads.');
  if (!hasPlatformCapability(access.entitlements, connection.provider)) throw new OperationError('unavailable', 'This advertising account is unavailable.');
  const ads = await platformAds(connection.provider);
  const ops = ads?.operations ?? adsOpsHostFor(connection.provider);
  if (!ads || !ops) throw new OperationError('unavailable', 'Advertising changes are currently unavailable.');
  if (ads.isReady && (await ads.isReady().catch(() => false)) !== true) throw new OperationError('unavailable', 'Advertising changes are currently unavailable.');
  const required = level === 'write' ? await ads.manageScopes() : await ads.readScopes();
  if (level === 'write') {
    if ((await runtimeConfig('ads.managementEnabled')) !== true) throw new OperationError('unavailable', 'Ads management is currently unavailable.');
    ads.validateManageScopes(required, scopes(connection.scopes));
  } else if (!ads.hasReadScopes(required, scopes(connection.scopes))) throw new OperationError('reconnect_required', 'Reconnect this advertising connection to continue.');
  const accessToken = decryptSecret(connection.accessToken);
  if (!accessToken) throw new OperationError('reconnect_required', 'This advertising connection is unavailable. Reconnect it before managing ads.');
  return { account, ops, credential: { accessToken }, provider: connection.provider, pageScope };
}

function supports(ops: AdsOpsHost, operation: AdsNeutralOperation) {
  const found = ops.operations.find(item => item.id === operation.type);
  if (!found || !found.objectTypes.includes(operation.objectType)) throw new OperationError('unavailable', 'This change is not available for the selected advertising account.');
  return found;
}

/**
 * Journal identity of the object a change targets. The ledger columns are NOT NULL and
 * the open-object unique index guards (account, objectType, objectId), so creations use a
 * deterministic placeholder: one unresolved campaign creation per account, and one unresolved
 * ad set creation per parent campaign. This makes a held creation block a duplicate creation.
 */
function ledgerObjectId(operation: AdsNeutralOperation) {
  if (operation.type === 'campaign.create') return '@create-campaign';
  if (operation.type === 'adset.create') return `@create-adset:${operation.parentId}`;
  return operation.objectId;
}

/** Ad set creation needs unrestricted page scope (the parent can't be bounded to channel targets). */
function assertCreationScope(operation: AdsNeutralOperation, pageScope: AdsPageScope, allowedTargetIds?: readonly string[]) {
  if (operation.type === 'adset.create' && (!pageScope.all || allowedTargetIds !== undefined)) throw new OperationError('forbidden', 'Ad set creation is unavailable for limited page access.');
}

async function assertOwnedObject(accountDbId: string, operation: AdsNeutralOperation) {
  if (operation.type === 'campaign.create') return;
  if (operation.type === 'adset.create') {
    const parent = await prisma.adInsight.findFirst({ where: { adAccountId: accountDbId, level: 'campaign', objectId: operation.parentId }, select: { id: true } });
    if (!parent) throw new OperationError('not_found', 'This campaign cannot be verified for the selected account.');
    return;
  }
  const owned = await prisma.adInsight.findFirst({ where: { adAccountId: accountDbId, level: objectLevel[operation.objectType], objectId: operation.objectId }, select: { id: true } });
  if (!owned) throw new OperationError('not_found', 'This ad object cannot be verified for the selected account.');
}

/** Root-managed bounds apply to every module before its own validation; the module may only be stricter. */
async function validateWithPolicy(ops: AdsOpsHost, operation: AdsNeutralOperation) {
  const policy = await loadAdsManagementPolicy();
  if (operation.type === 'rename' && (!operation.name || operation.name.length > policy.nameMaxCharacters)) throw new OperationError('invalid_request', `Names must contain 1 to ${policy.nameMaxCharacters} characters.`);
  if (isCreationOperation(operation) && (!operation.name || operation.name.length > policy.nameMaxCharacters)) throw new OperationError('invalid_request', `Names must contain 1 to ${policy.nameMaxCharacters} characters.`);
  if (operation.type === 'adset.create' && operation.dailyBudgetMinor > policy.maxBudgetMinor) throw new OperationError('invalid_request', 'This budget is above the limit allowed for a single change.');
  if (operation.type === 'budget.set' && operation.budget.minor > policy.maxBudgetMinor) throw new OperationError('invalid_request', 'This budget is above the limit allowed for a single change.');
  ops.validate(operation, { nameMaxCharacters: policy.nameMaxCharacters, maxBudgetMinor: policy.maxBudgetMinor });
  await ops.validateCurrent?.(operation, { nameMaxCharacters: policy.nameMaxCharacters, maxBudgetMinor: policy.maxBudgetMinor });
}

/** What this actor may do on one account; the UI shows only advertised operations. */
export async function describeAdsManagement(actor: AdsManageActor, adAccountId: string) {
  try {
    const ctx = await managedContext(actor, adAccountId, 'write');
    const policy = await loadAdsManagementPolicy();
    return { canManage: true as const, operations: ctx.ops.operations.map(item => ({ ...item })), canListCreatives: Boolean(ctx.ops.listCreatives), limits: { nameMaxCharacters: policy.nameMaxCharacters, maxBudgetMinor: policy.maxBudgetMinor } };
  } catch (error) {
    if (error instanceof OperationError && ['forbidden', 'unauthorized', 'unavailable', 'reconnect_required', 'not_found'].includes(error.code)) return { canManage: false as const, operations: [], canListCreatives: false };
    throw error;
  }
}

/** Returns the exact confirmation a caller must repeat. No remote or ledger write. */
export async function previewAdsManagement(actor: AdsManageActor, input: { adAccountId: string; operation: unknown }) {
  const operation = parseNeutralOperation(input.operation);
  const ctx = await managedContext(actor, input.adAccountId, 'write');
  const support = supports(ctx.ops, operation);
  assertCreationScope(operation, ctx.pageScope, actor.allowedTargetIds);
  await validateWithPolicy(ctx.ops, operation);
  await assertOwnedObject(ctx.account.id, operation);
  // Best effort: tells the caller an earlier unresolved change will refuse this one. Null when the ledger cannot be read.
  const held = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM ads_management_operations WHERE "workspaceId" = ${actor.workspaceId} AND "adAccountId" = ${ctx.account.id} AND "objectType" = ${operation.objectType} AND "objectId" = ${ledgerObjectId(operation)} AND status IN ('pending','uncertain') LIMIT 1`
    .then(rows => rows.length > 0, () => null);
  return { confirmation: ctx.ops.confirmation(operation, { adAccountId: ctx.account.id, currency: ctx.account.currency }), spendChanging: support.spendChanging, irreversible: support.irreversible === true, blockedByOpenChange: held, operation };
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
export type AdsCreatedObject = { objectType: 'campaign' | 'adset'; remoteId: string };
type AdsLedgerStatus = { status: string; remoteId: string | null; operationType?: string; objectType?: string };
function createdFrom(ledger: { operationType?: string; objectType?: string }, remoteId: string | null): { created?: AdsCreatedObject } {
  if (!remoteId || (ledger.operationType !== 'campaign.create' && ledger.operationType !== 'adset.create')) return {};
  return { created: { objectType: ledger.operationType === 'campaign.create' ? 'campaign' : 'adset', remoteId } };
}
class AdsIntentNoLongerPending extends Error {
  constructor(readonly ledger: AdsLedgerStatus) { super('This Ads request has already moved past pending.'); }
}

function replayLedgerOutcome(operationId: string, ledger: AdsLedgerStatus): AdsManagementOutcome {
  if (ledger.status === 'succeeded') return { outcome: 'succeeded', operationId, remoteId: ledger.remoteId, recorded: true, replay: true, status: ledger.status, ...createdFrom(ledger, ledger.remoteId) };
  // A human attestation never proves a created object's identity, so no `created` is returned.
  if (ledger.status === 'resolved_applied') return { outcome: 'succeeded', operationId, remoteId: ledger.remoteId, recorded: true, replay: true, status: ledger.status };
  if (ledger.status === 'resolved_not_applied') return { outcome: 'rejected', operationId, message: 'This request was reviewed and recorded as not applied. Create a new request only if you still want to make the change.', terminal: true, replay: true, status: 'resolved_not_applied' };
  if (ledger.status === 'rejected') return { outcome: 'rejected', operationId, message: 'The advertising platform rejected this change. Nothing was changed. Review the details before submitting a new request.' };
  if (ledger.status === 'uncertain') return { outcome: 'uncertain', operationId, message: 'The result of this change is unknown. Do not repeat it. Check the object in the advertising platform, then record what you found in Ads change history.' };
  throw new OperationError('conflict', 'This advertising request is still in progress or has not been resolved. Do not submit it again.');
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
  if (row.requestHash !== requestHash) throw new OperationError('conflict', 'This request key was already used for a different advertising change.');
  return replayLedgerOutcome(row.id, row);
}

/**
 * Apply one neutral change. A durable pending record is written BEFORE the remote
 * call; an unknown outcome is never retried automatically and blocks further
 * changes to the same object until a manager resolves it.
 */
export async function performAdsManagement(actor: AdsManageActor, input: { adAccountId: string; operation: unknown; confirmation: unknown; requestId: unknown }): Promise<AdsManagementOutcome> {
  if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) throw new OperationError('invalid_request', 'Provide a request ID containing 8 to 128 letters, numbers, dots, underscores, colons or hyphens.');
  const operation = parseNeutralOperation(input.operation);
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
    await assertOwnedObject(ctx.account.id, operation);
  } catch (error) { throw beforeJournal(error); }

  const id = newId('adsop');
  const requestHash = requestPayloadHash(ctx.account.id, operation);
  try {
    await prisma.$transaction(async tx => {
      await lockSelectedResources(tx, actor.workspaceId, [{ kind: 'adAccount', id: ctx.account.id }]);
      const active = await tx.adAccount.findFirst({ where: { id: ctx.account.id, workspaceId: actor.workspaceId, enabled: true }, select: { id: true } });
      if (!active) throw new OperationError('reconnect_required', 'This advertising account is no longer selected. Select it again before managing ads.');
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
      const message = 'An earlier change to this object has no confirmed outcome. Check it in Ads change history and resolve it before making another change.';
      // A successful lookup finding no row for this request id means THIS send was not recorded; an earlier send could still be in flight, so clients must not release a request they already sent unresolved.
      if (lookedUp && isCreationOperation(operation)) throw new AdsNoDispatchError('conflict', message, 'blocked_by_other_request');
      throw new OperationError('conflict', message);
    }
    // An OperationError here is one of our own checks raised before the INSERT, so this send recorded nothing.
    if (error instanceof OperationError) throw beforeJournal(error);
    // Any other failure (including a lost commit acknowledgement) may have committed the intent: never claim it was not recorded.
    throw new OperationError('unavailable', 'Ads management is temporarily unavailable. Check Ads change history before submitting a new request.');
  }

  let current: Awaited<ReturnType<typeof managedContext>> | undefined;
  let providerDispatched = false;
  try {
    // The same fail-fast lock serializes selection changes through current authorization and provider dispatch.
    return await withSelectedResourceOperation(actor.workspaceId, { kind: 'adAccount', id: ctx.account.id }, async (_tx, signal) => {
      signal.throwIfAborted();
      const [ledger] = await _tx.$queryRaw<AdsLedgerStatus[]>`SELECT status, "remoteId", "operationType", "objectType" FROM ads_management_operations WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
      if (!ledger || ledger.status !== 'pending') throw new AdsIntentNoLongerPending(ledger ?? { status: 'missing', remoteId: null });
      try {
        current = await managedContext(actor, input.adAccountId, 'write');
        if (current.account.id !== ctx.account.id || current.provider !== ctx.provider || current.ops.provider !== ctx.ops.provider) throw new OperationError('conflict', 'The advertising account changed while preparing this request. Review it and try again.');
        supports(current.ops, operation);
        assertCreationScope(operation, current.pageScope, actor.allowedTargetIds);
        await validateWithPolicy(current.ops, operation);
        if (operation.type === 'adset.create') await assertOwnedObject(current.account.id, operation);
        if (current.ops.confirmation(operation, { adAccountId: current.account.id, currency: current.account.currency }) !== expected) throw new OperationError('conflict', 'The advertising change confirmation is no longer current. Review it and try again.');
        signal.throwIfAborted();
      } catch (error) {
        const changed = Number(await _tx.$executeRaw`UPDATE ads_management_operations SET status = 'rejected', "failureCode" = 'authority_changed', "updatedAt" = NOW(), "completedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} AND status = 'pending'`);
        if (changed !== 1) throw error;
        await audit(actor, 'ads.change_rejected', { operationId: id, adAccountId: ctx.account.id, operation: operation.type, objectType: operation.objectType, objectId: ledgerObjectId(operation), reason: 'authority_changed' }, _tx);
        const message = error instanceof OperationError ? error.message : 'Current advertising access could not be verified. Review access and try again.';
        return { outcome: 'rejected' as const, operationId: id, message: `No advertising change was sent. ${message}` };
      }

      providerDispatched = true;
      let result: { remoteId?: string };
      try {
        result = await current!.ops.execute({ credential: current!.credential, accountId: current!.account.actId, signal }, operation);
      } catch (error) {
        // Record the provider result under the same selected-resource lock before recovery can proceed.
        let kind: 'rejected' | 'uncertain';
        try { kind = current!.ops.classifyFailure(error) === 'rejected' ? 'rejected' : 'uncertain'; } catch { kind = 'uncertain'; }
        const status: AdsOperationStatus = kind === 'rejected' ? 'rejected' : 'uncertain';
        const code = kind === 'rejected' ? 'rejected' : 'unknown_outcome';
        const changed = Number(await _tx.$executeRaw`UPDATE ads_management_operations SET status = ${status}, "failureCode" = ${code}, "updatedAt" = NOW(), "completedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} AND status = 'pending'`);
        if (changed !== 1) throw new AdsIntentNoLongerPending({ status: 'uncertain', remoteId: null });
        await audit(actor, `ads.change_${status}`, { operationId: id, adAccountId: ctx.account.id, operation: operation.type, objectType: operation.objectType, objectId: ledgerObjectId(operation) }, _tx);
        return kind === 'rejected'
          ? { outcome: 'rejected' as const, operationId: id, message: 'The advertising platform rejected this change. Nothing was changed. Review the details and try again.' }
          : { outcome: 'uncertain' as const, operationId: id, message: 'The result of this change is unknown. Do not repeat it. Check the object in the advertising platform, then record what you found in Ads change history.' };
      }

      const resultRemoteId = result.remoteId ?? null;
      if (isCreationOperation(operation) && (resultRemoteId === null || !SAFE_ID.test(resultRemoteId))) {
        // The provider returned without a verifiable identity: it may have created an object, so hold it as uncertain.
        const held = Number(await _tx.$executeRaw`UPDATE ads_management_operations SET status = 'uncertain', "failureCode" = 'missing_remote_id', "updatedAt" = NOW(), "completedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} AND status = 'pending'`);
        if (held !== 1) throw new AdsIntentNoLongerPending({ status: 'uncertain', remoteId: null });
        await audit(actor, 'ads.change_uncertain', { operationId: id, adAccountId: ctx.account.id, operation: operation.type, objectType: operation.objectType, objectId: ledgerObjectId(operation) }, _tx);
        return { outcome: 'uncertain' as const, operationId: id, message: 'The result of this change is unknown. Do not repeat it. Check the object in the advertising platform, then record what you found in Ads change history.' };
      }
      const created = isCreationOperation(operation) ? { created: { objectType: operation.objectType, remoteId: resultRemoteId! } } : {};
      const changed = Number(await _tx.$executeRaw`UPDATE ads_management_operations SET status = 'succeeded', "remoteId" = ${resultRemoteId}, "updatedAt" = NOW(), "completedAt" = NOW() WHERE id = ${id} AND "workspaceId" = ${actor.workspaceId} AND status = 'pending'`);
      if (changed !== 1) return { outcome: 'succeeded' as const, operationId: id, remoteId: resultRemoteId, recorded: false, warning: 'The change was applied but its record could not be completed. Do not repeat it; the object stays on hold in Ads change history until the outcome is reviewed.', ...created };
      await audit(actor, 'ads.change_applied', { operationId: id, adAccountId: ctx.account.id, operation: operation.type, objectType: operation.objectType, objectId: ledgerObjectId(operation), spendChanging: support.spendChanging, ...(isCreationOperation(operation) ? { remoteId: resultRemoteId, createdPaused: true } : {}) }, _tx);
      return { outcome: 'succeeded' as const, operationId: id, remoteId: resultRemoteId, recorded: true, ...created };
    });
  } catch (error) {
    if (error instanceof AdsIntentNoLongerPending) return replayLedgerOutcome(id, error.ledger);
    if (!providerDispatched) {
      // Lock/config failure before provider dispatch proves no provider write was sent; retain pending for explicit recovery.
      const message = error instanceof OperationError ? error.message : 'Current advertising access could not be verified. Review access and try again.';
      return { outcome: 'rejected', operationId: id, message: `No advertising change was sent. ${message}` };
    }
    // Any failure after dispatch may have applied remotely. Leave the committed pending intent held for explicit review.
    return { outcome: 'uncertain', operationId: id, message: 'The result of this change is unknown. Do not repeat it. Check the object in the advertising platform, then record what you found in Ads change history.' };
  }
}

type OperationRow = { id: string; adAccountId: string; actorId: string; operationType: string; objectType: string; objectId: string; params: unknown; status: string; remoteId: string | null; failureCode: string | null; createdAt: Date; completedAt: Date | null; resolvedBy: string | null; resolvedAt: Date | null; resolutionNote: string | null };
const present = (row: OperationRow) => ({
  id: row.id, adAccountId: row.adAccountId, actorId: row.actorId, operationType: row.operationType, objectType: row.objectType, objectId: row.objectId, params: row.params,
  status: row.status, remoteId: row.remoteId, failureCode: row.failureCode, createdAt: row.createdAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null, resolvedAt: row.resolvedAt?.toISOString() ?? null, resolvedBy: row.resolvedBy, resolutionNote: row.resolutionNote,
  // Pending entries can be recovered only after acquiring the selected-account lock; in-flight dispatch remains held there.
  needsResolution: row.status === 'pending' || row.status === 'uncertain',
  resolutionKind: row.status === 'pending' ? 'pending_recovery' : row.status === 'uncertain' ? 'uncertain' : null,
  onHold: row.status === 'pending' || row.status === 'uncertain',
});

export async function listAdsOperations(actor: AdsManageActor, input: { adAccountId?: string; status?: string; offset?: number; limit?: number } = {}) {
  const access = await authorizeManager(actor, 'write');
  const policy = await loadAdsManagementPolicy();
  const status = input.status;
  if (status !== undefined && !OPERATION_STATUSES.includes(status as AdsOperationStatus)) throw new OperationError('invalid_request', 'Choose a valid status.');
  if (input.adAccountId !== undefined && !SAFE_ID.test(input.adAccountId)) throw new OperationError('invalid_request', 'Choose an advertising account.');
  const offset = input.offset ?? 0, limit = Math.min(input.limit ?? policy.historyPageLimit, policy.historyPageLimit);
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) throw new OperationError('invalid_request', 'Choose a valid page.');
  // Visible accounts follow the caller's channel scope; history never crosses workspaces.
  const pageScope = access.permissions.pageScope;
  const visible = await prisma.adAccount.findMany({
    where: { workspaceId: actor.workspaceId, ...accountIdCeiling(actor), socialAccount: { is: { workspaceId: actor.workspaceId, ...accountTargetScope(actor, pageScope) } } },
    select: { id: true },
  });
  const ids = visible.map(item => item.id).filter(id => input.adAccountId === undefined || id === input.adAccountId);
  if (!ids.length) return { items: [], offset, limit, nextOffset: null as number | null };
  const rows = await prisma.$queryRaw<OperationRow[]>`SELECT id, "adAccountId", "actorId", "operationType", "objectType", "objectId", params, status, "remoteId", "failureCode", "createdAt", "completedAt", "resolvedBy", "resolvedAt", "resolutionNote"
    FROM ads_management_operations WHERE "workspaceId" = ${actor.workspaceId} AND "adAccountId" = ANY(${ids}) AND (${status ?? null}::text IS NULL OR status = ${status ?? null})
    ORDER BY "createdAt" DESC, id ASC OFFSET ${offset} LIMIT ${limit + 1}`;
  const page = rows.slice(0, limit);
  return { items: page.map(present), offset, limit, nextOffset: rows.length > limit ? offset + limit : null };
}

export type AdsResolution = 'applied' | 'not_applied';
export const resolutionConfirmation = (operationId: string, resolution: AdsResolution) => `RESOLVE ADS CHANGE ${operationId} AS ${resolution === 'applied' ? 'APPLIED' : 'NOT APPLIED'}`;
export const pendingRecoveryConfirmation = (operationId: string, resolution: AdsResolution) => `RECOVER ADS CHANGE ${operationId} AS ${resolution === 'applied' ? 'APPLIED' : 'NOT APPLIED'}`;

/** Human attestation for an unknown outcome. Never contacts the provider and never repeats the write. */
export async function resolveAdsOperation(actor: AdsManageActor, input: { operationId: string; resolution: AdsResolution; note?: string; confirmation: string }) {
  if (typeof input.operationId !== 'string' || !SAFE_ID.test(input.operationId) || (input.resolution !== 'applied' && input.resolution !== 'not_applied')) throw new OperationError('invalid_request', 'Choose a valid change and outcome.');
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 500 || /[\u0000-\u001f\u007f]/.test(input.note))) throw new OperationError('invalid_request', 'Keep the note to 500 printable characters.');
  const access = await authorizeManager(actor, 'write');
  const rows = await prisma.$queryRaw<OperationRow[]>`SELECT id, "adAccountId", "actorId", "operationType", "objectType", "objectId", params, status, "remoteId", "failureCode", "createdAt", "completedAt", "resolvedBy", "resolvedAt", "resolutionNote"
    FROM ads_management_operations WHERE id = ${input.operationId} AND "workspaceId" = ${actor.workspaceId}`;
  const row = rows[0];
  if (!row) throw new OperationError('not_found', 'This change was not found.');
  if (row.status !== 'pending' && row.status !== 'uncertain') throw new OperationError('conflict', 'This change does not need resolving.');
  const expected = row.status === 'pending' ? pendingRecoveryConfirmation(input.operationId, input.resolution) : resolutionConfirmation(input.operationId, input.resolution);
  if (input.confirmation !== expected) throw new OperationError('invalid_request', `Confirmation required. Repeat with confirmation exactly: ${expected}`);
  // Current workspace, module, role and key ceilings apply; retained disabled accounts remain visible for history recovery.
  const pageScope = access.permissions.pageScope;
  const visible = await prisma.adAccount.findFirst({
    where: { id: row.adAccountId, ...accountIdCeiling(actor), workspaceId: actor.workspaceId, socialAccount: { is: { workspaceId: actor.workspaceId, ...accountTargetScope(actor, pageScope) } } },
    select: { id: true },
  });
  if (!visible) throw new OperationError('not_found', 'This change was not found.');
  const next = input.resolution === 'applied' ? 'resolved_applied' : 'resolved_not_applied';
  let settled: boolean;
  try {
    settled = await withSelectedResourceOperation(actor.workspaceId, { kind: 'adAccount', id: row.adAccountId }, async (tx, signal) => {
      signal.throwIfAborted();
      const [current] = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM ads_management_operations WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
      if (!current || current.status !== row.status) return false;
      const changed = Number(await tx.$executeRaw`UPDATE ads_management_operations SET status = ${next}, "resolvedBy" = ${actor.userId}, "resolvedAt" = NOW(), "resolutionNote" = ${input.note ?? null}, "updatedAt" = NOW()
        WHERE id = ${row.id} AND "workspaceId" = ${actor.workspaceId} AND status = ${row.status}`);
      if (changed !== 1) return false;
      await audit(actor, 'ads.change_resolved', { operationId: row.id, adAccountId: row.adAccountId, resolution: input.resolution, recoveredPending: row.status === 'pending' }, tx);
      return true;
    });
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError('unavailable', 'This resolution could not be saved. Try again.');
  }
  if (!settled) throw new OperationError('conflict', 'This change was already resolved.');
  return { operationId: row.id, status: next, recoveredPending: row.status === 'pending', receipt: { affectedRows: 1, resolvedBy: actor.userId } };
}

/** Browse the module's existing creatives for assigning to an ad (read-only). */
export async function listAdsCreatives(actor: AdsManageActor, input: { adAccountId: string; after?: string; limit?: number }) {
  const ctx = await managedContext(actor, input.adAccountId, 'write');
  if (!ctx.ops.listCreatives) throw new OperationError('unavailable', 'Creative browsing is not available for the selected advertising account.');
  const policy = await loadAdsManagementPolicy();
  const limit = Math.min(input.limit ?? policy.creativePageLimit, policy.creativePageLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || (input.after !== undefined && (typeof input.after !== 'string' || input.after.length > 500))) throw new OperationError('invalid_request', 'Choose a valid page.');
  try { return await ctx.ops.listCreatives({ credential: ctx.credential, accountId: ctx.account.actId }, { limit, ...(input.after ? { after: input.after } : {}) }); }
  catch { throw new OperationError('upstream_failure', 'Creatives could not be loaded right now. Try again later.'); }
}
