import { FACEBOOK_ADS_CREATION_UI_SCHEMA } from '../ads-ui-config';
import type { AdsUiSchema } from '@/platforms/ads-ui';
import { OperationError } from '@/lib/operation-error';
import type { FacebookConfig } from '@/platforms/facebook/config';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import type { AdsCreativeSummary, AdsNeutralOperation, AdsOpsContext, AdsOpsHost, AdsOpsLimits, AdsOperationSupport } from '@/modules/ads/management/types';
import { FACEBOOK_ADSET_CREATE_DEFAULTS, FACEBOOK_ADSET_OPTIMIZATION_GOALS, FACEBOOK_CAMPAIGN_OBJECTIVES, FACEBOOK_CREATE_STATUS, facebookCountryOptions, isFacebookCountryCode } from './creation';
import { FacebookAdsOpsError, classifyFacebookAdsFailure, createFacebookAdsTransport, type FacebookAdsFetch, type FacebookAdsTransport } from './transport';

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const bareAccount = (id: string) => id.replace(/^act_/, '');
const NAME_MAX = 100;

/** Only operations implemented below are advertised. */
export const FACEBOOK_ADS_OPERATIONS: readonly AdsOperationSupport[] = [
  { id: 'status.set', objectTypes: ['campaign', 'adset', 'ad'], spendChanging: true, label: 'Pause or resume', inputs: [{ name: 'status', kind: 'choice', options: [{ value: 'paused', label: 'Pause' }, { value: 'active', label: 'Resume' }] }] },
  { id: 'budget.set', objectTypes: ['campaign', 'adset'], spendChanging: true, label: 'Change budget', inputs: [{ name: 'budget', kind: 'money-minor', budgetKinds: ['daily', 'lifetime'] }] },
  { id: 'rename', objectTypes: ['campaign', 'adset', 'ad'], spendChanging: false, label: 'Rename', inputs: [{ name: 'name', kind: 'text' }] },
  { id: 'creative.assign', objectTypes: ['ad'], spendChanging: false, label: 'Assign an existing creative', inputs: [{ name: 'creativeId', kind: 'creative-ref' }] },
  { id: 'delete', objectTypes: ['campaign', 'adset', 'ad'], spendChanging: false, irreversible: true, label: 'Delete' },
  { id: 'campaign.create', objectTypes: ['campaign'], spendChanging: true, label: 'Create paused campaign', inputs: [{ name: 'name', kind: 'text' }, { name: 'objective', kind: 'choice', options: FACEBOOK_CAMPAIGN_OBJECTIVES }] },
  { id: 'adset.create', objectTypes: ['adset'], spendChanging: true, label: 'Create paused ad set', inputs: [
    { name: 'name', kind: 'text' }, { name: 'budget', kind: 'money-minor', budgetKinds: ['daily'] },
    { name: 'countryCode', kind: 'choice', options: facebookCountryOptions() }, { name: 'optimizationGoal', kind: 'choice', options: FACEBOOK_ADSET_OPTIMIZATION_GOALS },
  ] },
];

const label = (type: string) => (type === 'adset' ? 'AD SET' : type.toUpperCase());

type CreateOperation = Extract<AdsNeutralOperation, { type: 'campaign.create' | 'adset.create' }>;
const validName = (name: string, max: number) => name.trim().length > 0 && name.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(name);

function validateCreation(operation: CreateOperation, nameMax: number, limits?: AdsOpsLimits) {
  if (typeof operation.name !== 'string' || !validName(operation.name, nameMax)) throw new OperationError('invalid_request', `Names must contain 1 to ${nameMax} printable characters.`);
  if (operation.type === 'campaign.create') {
    if (operation.objectType !== 'campaign' || !FACEBOOK_CAMPAIGN_OBJECTIVES.some(item => item.value === operation.objective)) throw new OperationError('invalid_request', 'Choose a supported campaign objective.');
    return;
  }
  if (operation.objectType !== 'adset') throw new OperationError('invalid_request', 'Invalid ad object.');
  if (typeof operation.parentId !== 'string' || !SAFE_ID.test(operation.parentId)) throw new OperationError('invalid_request', 'Choose a valid parent campaign.');
  if (!Number.isSafeInteger(operation.dailyBudgetMinor) || operation.dailyBudgetMinor < 1) throw new OperationError('invalid_request', 'Daily budgets must be positive whole minor currency units.');
  if (limits && operation.dailyBudgetMinor > limits.maxBudgetMinor) throw new OperationError('invalid_request', 'This budget is above the limit allowed for a single change.');
  if (!isFacebookCountryCode(operation.countryCode)) throw new OperationError('invalid_request', 'Choose a valid country.');
  if (!FACEBOOK_ADSET_OPTIMIZATION_GOALS.some(item => item.value === operation.optimizationGoal)) throw new OperationError('invalid_request', 'Choose a valid optimization goal.');
}

export function validateFacebookAdsOperation(operation: AdsNeutralOperation, limits?: AdsOpsLimits): void {
  const nameMax = Math.min(NAME_MAX, limits?.nameMaxCharacters ?? NAME_MAX);
  const support = FACEBOOK_ADS_OPERATIONS.find(item => item.id === operation.type);
  if (!support || !support.objectTypes.includes(operation.objectType)) throw new OperationError('unavailable', 'This change is not available.');
  if (operation.type === 'campaign.create' || operation.type === 'adset.create') return validateCreation(operation, nameMax, limits);
  if (!SAFE_ID.test(operation.objectId)) throw new OperationError('invalid_request', 'Invalid ad object.');
  if (operation.type === 'rename' && (!operation.name || operation.name.length > nameMax || /[\u0000-\u001f\u007f]/.test(operation.name))) throw new OperationError('invalid_request', `Names must contain 1 to ${nameMax} printable characters.`);
  if (operation.type === 'budget.set' && limits && operation.budget.minor > limits.maxBudgetMinor) throw new OperationError('invalid_request', 'This budget is above the limit allowed for a single change.');
  if (operation.type === 'budget.set' && (!Number.isSafeInteger(operation.budget.minor) || operation.budget.minor < 1)) throw new OperationError('invalid_request', 'Budgets must be positive whole minor currency units.');
  if (operation.type === 'creative.assign' && !SAFE_ID.test(operation.creativeId)) throw new OperationError('invalid_request', 'Choose a valid creative.');
}

export function facebookAdsConfirmation(operation: AdsNeutralOperation, context: { adAccountId: string; currency: string | null }): string {
  const where = `IN ACCOUNT ${context.adAccountId}`;
  if (operation.type === 'campaign.create') return `CREATE PAUSED FACEBOOK CAMPAIGN ${JSON.stringify(operation.name.trim())} ${where} WITH OBJECTIVE ${operation.objective}`;
  if (operation.type === 'adset.create') return `CREATE PAUSED FACEBOOK AD SET ${JSON.stringify(operation.name.trim())} UNDER CAMPAIGN ${operation.parentId} ${where} WITH DAILY BUDGET ${operation.dailyBudgetMinor} MINOR UNITS${context.currency ? ` ${context.currency}` : ''} TARGETING ${operation.countryCode} OPTIMIZED FOR ${operation.optimizationGoal}`;
  const subject = `FACEBOOK ${label(operation.objectType)} ${operation.objectId}`;
  switch (operation.type) {
    case 'status.set': return operation.status === 'active' ? `RESUME ${subject} ALLOWING DELIVERY AND SPEND ${where}` : `PAUSE ${subject} ${where}`;
    case 'budget.set': return `SET ${subject} ${operation.budget.kind.toUpperCase()} BUDGET TO ${operation.budget.minor} MINOR UNITS${context.currency ? ` ${context.currency}` : ''} ${where}`;
    case 'rename': return `RENAME ${subject} TO ${JSON.stringify(operation.name)} ${where}`;
    case 'creative.assign': return `ASSIGN FACEBOOK CREATIVE ${operation.creativeId} TO ${subject} ${where}`;
    case 'delete': return `DELETE ${subject} PERMANENTLY ${where}`;
  }
}

function belongs(payload: Record<string, unknown>, accountId: string) {
  const remote = typeof payload.account_id === 'string' ? bareAccount(payload.account_id) : '';
  return Boolean(remote) && remote === bareAccount(accountId);
}

async function verifyOwned(transport: FacebookAdsTransport, token: string, accountId: string, objectId: string, what: string, signal?: AbortSignal) {
  const payload = await transport.get(encodeURIComponent(objectId), token, { fields: 'id,account_id' }, signal);
  if (payload.id !== objectId || !belongs(payload, accountId)) throw new FacebookAdsOpsError(`This ${what} does not belong to the selected ad account.`, { status: 0, beforeWrite: true });
}

/** Status is a provider-owned constant: creation never reads a status from the payload. */
async function executeCreation(transport: FacebookAdsTransport, token: string, context: AdsOpsContext, operation: CreateOperation) {
  const name = operation.name.trim();
  let body: Record<string, string>;
  if (operation.type === 'campaign.create') {
    body = { name, objective: operation.objective, status: FACEBOOK_CREATE_STATUS, special_ad_categories: '[]' };
  } else {
    // A campaign has an objective; an ad set or ad does not, so this also rejects wrong-level ids.
    const parent = await transport.get(encodeURIComponent(operation.parentId), token, { fields: 'id,account_id,objective' }, context.signal);
    if (parent.id !== operation.parentId || !belongs(parent, context.accountId) || typeof parent.objective !== 'string') {
      throw new FacebookAdsOpsError('This campaign does not belong to the selected ad account.', { status: 0, beforeWrite: true });
    }
    body = {
      campaign_id: operation.parentId, name, daily_budget: String(operation.dailyBudgetMinor),
      billing_event: FACEBOOK_ADSET_CREATE_DEFAULTS.billing_event, optimization_goal: operation.optimizationGoal, bid_strategy: FACEBOOK_ADSET_CREATE_DEFAULTS.bid_strategy,
      targeting: JSON.stringify({ geo_locations: { countries: [operation.countryCode], location_types: [...FACEBOOK_ADSET_CREATE_DEFAULTS.location_types] } }),
      status: FACEBOOK_CREATE_STATUS,
    };
  }
  const edge = operation.type === 'campaign.create' ? 'campaigns' : 'adsets';
  const result = await transport.post(`${encodeURIComponent(context.accountId)}/${edge}`, token, body, context.signal);
  // The write was sent: a missing or malformed id leaves the outcome unknown, never "rejected".
  if (typeof result.id !== 'string' || !SAFE_ID.test(result.id)) throw new FacebookAdsOpsError('Facebook did not confirm the new object.', { status: 200 });
  return { remoteId: result.id };
}

async function configuredCreationUi(): Promise<AdsUiSchema> {
  const checked = FACEBOOK_ADS_CREATION_UI_SCHEMA.safeParse(await runtimeConfig('meta.adsCreationUi'));
  if (!checked.success) throw new FacebookAdsOpsError('Creation policy is unavailable.', { status: 0, beforeWrite: true });
  return checked.data;
}

export function createFacebookAdsOps(loadTransport: () => Promise<FacebookAdsTransport>, loadCreationUi: () => Promise<AdsUiSchema> = configuredCreationUi): AdsOpsHost {
  const checkCurrent = async (operation: AdsNeutralOperation) => {
    if (operation.type !== 'campaign.create' && operation.type !== 'adset.create') return;
    const ui = await loadCreationUi();
    const form = operation.type === 'campaign.create' ? ui.campaign : ui.adSet;
    const choice = operation.type === 'campaign.create' ? operation.objective : operation.optimizationGoal;
    if (!form || !form.options.some(option => option.value === choice) || operation.name.length > form.nameMaxLength) throw new FacebookAdsOpsError('Choose a current creation option and valid name.', { status: 0, beforeWrite: true });
  };
  return {
    provider: 'facebook',
    operations: FACEBOOK_ADS_OPERATIONS,
    validate: validateFacebookAdsOperation,
    /** Pre-journal check: current Root creation-policy failures are explicit product errors, never raw adapter errors. */
    async validateCurrent(operation: AdsNeutralOperation) {
      try { await checkCurrent(operation); }
      catch (error) {
        if (!(error instanceof FacebookAdsOpsError) || !error.detail.beforeWrite) throw error;
        throw new OperationError(error.message === 'Creation policy is unavailable.' ? 'unavailable' : 'invalid_request', error.message);
      }
    },
    confirmation: facebookAdsConfirmation,
    classifyFailure: classifyFacebookAdsFailure,
    async execute(context: AdsOpsContext, operation: AdsNeutralOperation) {
      validateFacebookAdsOperation(operation);
      await checkCurrent(operation);
      const transport = await loadTransport();
      const token = context.credential.accessToken;
      if (!SAFE_ID.test(context.accountId)) throw new FacebookAdsOpsError('Invalid ad account.', { status: 0, beforeWrite: true });
      if (operation.type === 'campaign.create' || operation.type === 'adset.create') return executeCreation(transport, token, context, operation);
      await verifyOwned(transport, token, context.accountId, operation.objectId, 'object', context.signal);
      const path = encodeURIComponent(operation.objectId);
      let body: Record<string, string>;
      switch (operation.type) {
        case 'status.set': body = { status: operation.status === 'active' ? 'ACTIVE' : 'PAUSED' }; break;
        case 'budget.set': body = { [operation.budget.kind === 'daily' ? 'daily_budget' : 'lifetime_budget']: String(operation.budget.minor) }; break;
        case 'rename': body = { name: operation.name }; break;
        case 'delete': body = { status: 'DELETED' }; break;
        case 'creative.assign': {
          await verifyOwned(transport, token, context.accountId, operation.creativeId, 'creative', context.signal);
          body = { creative: JSON.stringify({ creative_id: operation.creativeId }) };
          break;
        }
      }
      const result = await transport.post(path, token, body, context.signal);
      // Graph answers { success: true } for updates; anything else is not a confirmed write.
      if (result.success !== true) throw new FacebookAdsOpsError('Facebook did not confirm the change.', { status: 200 });
      return { remoteId: operation.objectId };
    },
    async listCreatives(context: AdsOpsContext, page: { limit: number; after?: string }) {
      const transport = await loadTransport();
      const payload = await transport.get(`${encodeURIComponent(context.accountId)}/adcreatives`, context.credential.accessToken, {
        fields: 'id,name,status,title,body,thumbnail_url', limit: String(page.limit), ...(page.after ? { after: page.after } : {}),
      });
      const data = Array.isArray(payload.data) ? payload.data : [];
      const items: AdsCreativeSummary[] = [];
      for (const raw of data) {
        if (!raw || typeof raw !== 'object') continue;
        const item = raw as Record<string, unknown>;
        if (typeof item.id !== 'string' || !SAFE_ID.test(item.id)) continue;
        const str = (value: unknown) => (typeof value === 'string' ? value : null);
        const thumb = str(item.thumbnail_url);
        items.push({ id: item.id, name: str(item.name), status: str(item.status), title: str(item.title), body: str(item.body), thumbnailUrl: thumb && thumb.startsWith('https://') ? thumb : null });
      }
      const paging = (payload.paging ?? {}) as { cursors?: { after?: unknown }; next?: unknown };
      const after = paging.cursors && typeof paging.cursors.after === 'string' && paging.next ? paging.cursors.after : null;
      return { items, next: after };
    },
  };
}

async function configuredTransport(fetchImpl?: FacebookAdsFetch) {
  const [graphBaseUrl, oauthBaseUrl, graphVersion, requestTimeoutMs, maxPages, pageSize, pageInsightMetrics, adInsightFields, maxImageUploadBytes, allowedImageMimeTypes, appSecretProofEnabled, appSecret] = await Promise.all([
    runtimeConfig('meta.graphBaseUrl'), runtimeConfig('meta.oauthBaseUrl'), runtimeConfig('meta.graphVersion'), runtimeConfig('meta.requestTimeoutMs'),
    runtimeConfig('meta.maxPages'), runtimeConfig('meta.pageSize'), runtimeConfig('meta.pageInsightMetrics'), runtimeConfig('meta.adInsightFields'),
    runtimeConfig('meta.maxImageUploadBytes'), runtimeConfig('meta.allowedImageMimeTypes'), runtimeConfig('meta.appSecretProofEnabled'), runtimeSecret('meta.appSecret'),
  ]);
  return createFacebookAdsTransport({ graphBaseUrl, oauthBaseUrl, graphVersion, requestTimeoutMs, maxPages, pageSize, pageInsightMetrics, adInsightFields, maxImageUploadBytes, allowedImageMimeTypes, appSecretProofEnabled, ...(appSecret ? { appSecret } : {}) } as FacebookConfig, fetchImpl);
}

/** Runtime host for explicit installation by the host assembly (see docs/ADS_PARITY.md). */
export const facebookAdsOps: AdsOpsHost = createFacebookAdsOps(() => configuredTransport());
