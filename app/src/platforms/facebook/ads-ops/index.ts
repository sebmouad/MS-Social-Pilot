import { defaultFacebookAdsText, facebookAdsText, FACEBOOK_ADS_COPY_SCHEMA, operationLabelKeys, type FacebookAdsText } from '../ads-copy';
import { createHash } from 'node:crypto';
import { executeFacebookCreative } from './creative';
import { FACEBOOK_ADS_CREATION_UI_SCHEMA } from '../ads-ui-config';
import type { AdsUiSchema } from '@/platforms/ads-ui';
import { OperationError, type OperationErrorCode } from '@/lib/operation-error';
import type { FacebookConfig } from '@/platforms/facebook/config';
import { configOrDefault } from '@/server/config/config-or-default';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import type { AdsCreativeSummary, AdsNeutralOperation, AdsOpsContext, AdsOpsHost, AdsOpsLimits, AdsOperationSupport } from '@/modules/ads/management/types';
import { FACEBOOK_ADSET_CREATE_DEFAULTS, FACEBOOK_ADSET_OPTIMIZATION_GOALS, FACEBOOK_CAMPAIGN_OBJECTIVES, FACEBOOK_CREATE_STATUS, facebookCountryOptions, isFacebookCountryCode } from './creation';
import { FacebookAdsOpsError, classifyFacebookAdsFailure, createFacebookAdsTransport, type FacebookAdsFetch, type FacebookAdsTransport } from './transport';

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const bareAccount = (id: string) => id.replace(/^act_/, '');
const NAME_MAX = 100;

/** Only operations implemented below are advertised. */
export const FACEBOOK_ADS_OPERATIONS: readonly AdsOperationSupport[] = [
  { id: 'status.set', objectTypes: ['campaign', 'adset', 'ad'], spendChanging: true, label: defaultFacebookAdsText('statusLabel'), inputs: [{ name: 'status', kind: 'choice', options: [{ value: 'paused', label: defaultFacebookAdsText('pause') }, { value: 'active', label: defaultFacebookAdsText('resume') }] }] },
  { id: 'budget.set', objectTypes: ['campaign', 'adset'], spendChanging: true, label: defaultFacebookAdsText('budgetLabel'), inputs: [{ name: 'budget', kind: 'money-minor', budgetKinds: ['daily', 'lifetime'] }] },
  { id: 'rename', objectTypes: ['campaign', 'adset', 'ad'], spendChanging: false, label: defaultFacebookAdsText('renameLabel'), inputs: [{ name: 'name', kind: 'text' }] },
  { id: 'creative.assign', objectTypes: ['ad'], spendChanging: true, label: defaultFacebookAdsText('assignLabel'), inputs: [{ name: 'creativeId', kind: 'creative-ref' }] },
  { id: 'delete', objectTypes: ['campaign', 'adset', 'ad'], spendChanging: false, irreversible: true, label: defaultFacebookAdsText('deleteLabel') },
  { id: 'object.copy', objectTypes: ['campaign', 'adset', 'ad'], spendChanging: false, label: defaultFacebookAdsText('copyLabel') },
  { id: 'creative.create', objectTypes: ['creative'], spendChanging: false, label: defaultFacebookAdsText('creativeCreateLabel') },
  { id: 'campaign.create', objectTypes: ['campaign'], spendChanging: true, label: defaultFacebookAdsText('campaignCreateLabel'), inputs: [{ name: 'name', kind: 'text' }, { name: 'objective', kind: 'choice', options: FACEBOOK_CAMPAIGN_OBJECTIVES }] },
  { id: 'ad.create', objectTypes: ['ad'], spendChanging: true, label: defaultFacebookAdsText('adCreateLabel'), inputs: [{ name: 'name', kind: 'text' }, { name: 'creativeId', kind: 'creative-ref' }] },
  { id: 'adset.create', objectTypes: ['adset'], spendChanging: true, label: defaultFacebookAdsText('adSetCreateLabel'), inputs: [
    { name: 'name', kind: 'text' }, { name: 'budget', kind: 'money-minor', budgetKinds: ['daily'] },
    { name: 'countryCode', kind: 'choice', options: facebookCountryOptions() }, { name: 'optimizationGoal', kind: 'choice', options: FACEBOOK_ADSET_OPTIMIZATION_GOALS },
  ] },
];


/** Stable provider-owned validation identity; wording never determines behavior. */
export class FacebookAdsValidationError extends OperationError {
  constructor(code: OperationErrorCode, readonly issueCode: keyof import('../ads-copy').FacebookAdsCopy, text: FacebookAdsText, values?: Record<string, string | number>) {
    super(code, text(issueCode, values));
    this.name = 'FacebookAdsValidationError';
  }
}

type CreateOperation = Extract<AdsNeutralOperation, { type: 'campaign.create' | 'adset.create' }>;
const validName = (name: string, max: number) => name.trim().length > 0 && name.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(name);

function validateCreation(operation: CreateOperation, nameMax: number, limits?: AdsOpsLimits, text: FacebookAdsText = defaultFacebookAdsText) {
  if (typeof operation.name !== 'string' || !validName(operation.name, nameMax)) throw new FacebookAdsValidationError('invalid_request', 'nameInvalid', text, { max: nameMax });
  if (operation.type === 'campaign.create') {
    if (operation.objectType !== 'campaign' || !FACEBOOK_CAMPAIGN_OBJECTIVES.some(item => item.value === operation.objective)) throw new FacebookAdsValidationError('invalid_request', 'objectiveInvalid', text);
    return;
  }
  if (operation.objectType !== 'adset') throw new FacebookAdsValidationError('invalid_request', 'objectInvalid', text);
  if (typeof operation.parentId !== 'string' || !SAFE_ID.test(operation.parentId)) throw new FacebookAdsValidationError('invalid_request', 'parentCampaignInvalid', text);
  if (!Number.isSafeInteger(operation.dailyBudgetMinor) || operation.dailyBudgetMinor < 1) throw new FacebookAdsValidationError('invalid_request', 'dailyBudgetInvalid', text);
  if (limits && operation.dailyBudgetMinor > limits.maxBudgetMinor) throw new FacebookAdsValidationError('invalid_request', 'budgetLimitExceeded', text);
  if (!isFacebookCountryCode(operation.countryCode)) throw new FacebookAdsValidationError('invalid_request', 'countryInvalid', text);
  if (!FACEBOOK_ADSET_OPTIMIZATION_GOALS.some(item => item.value === operation.optimizationGoal)) throw new FacebookAdsValidationError('invalid_request', 'optimizationInvalid', text);
  const ages = [operation.ageMin, operation.ageMax].filter((age): age is number => age !== undefined);
  const today = new Date().toISOString().slice(0, 10);
  if ((operation.extraCountryCodes ?? []).some(code => !isFacebookCountryCode(code) || code === operation.countryCode)
    || ages.some(age => !Number.isInteger(age) || age < 18 || age > 65) || (operation.ageMin !== undefined && operation.ageMax !== undefined && operation.ageMin > operation.ageMax)
    || (operation.endDate !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(operation.endDate) || Number.isNaN(Date.parse(`${operation.endDate}T00:00:00Z`)) || operation.endDate <= today))) throw new FacebookAdsValidationError('invalid_request', 'targetingInvalid', text);
}

/** True when the ad set asks for more than the original single-country targeting. */
const hasTargetingExtras = (operation: Extract<AdsNeutralOperation, { type: 'adset.create' }>) => Boolean(operation.extraCountryCodes?.length || operation.ageMin !== undefined || operation.ageMax !== undefined || operation.endDate);

export function validateFacebookAdsOperation(operation: AdsNeutralOperation, limits?: AdsOpsLimits, text: FacebookAdsText = defaultFacebookAdsText): void {
  const nameMax = Math.min(NAME_MAX, limits?.nameMaxCharacters ?? NAME_MAX);
  const support = FACEBOOK_ADS_OPERATIONS.find(item => item.id === operation.type);
  if (!support || !support.objectTypes.includes(operation.objectType)) throw new FacebookAdsValidationError('unavailable', 'changeUnavailable', text);
  if (operation.type === 'campaign.create' || operation.type === 'adset.create') return validateCreation(operation, nameMax, limits, text);
  if (operation.type === 'ad.create') {
    if (operation.objectType !== 'ad' || typeof operation.name !== 'string' || !validName(operation.name, nameMax)) throw new FacebookAdsValidationError('invalid_request', 'nameInvalid', text, { max: nameMax });
    if (typeof operation.parentId !== 'string' || !SAFE_ID.test(operation.parentId)) throw new FacebookAdsValidationError('invalid_request', 'parentAdSetInvalid', text);
    if (typeof operation.creativeId !== 'string' || !SAFE_ID.test(operation.creativeId)) throw new FacebookAdsValidationError('invalid_request', 'creativeInvalid', text);
    return;
  }
  if (operation.type === 'creative.create' && operation.format === 'post') {
    if (!validName(operation.name, nameMax) || !SAFE_ID.test(operation.targetId)) throw new FacebookAdsValidationError('invalid_request', 'creativeDetailsInvalid', text);
    if (!/^[0-9]{1,40}_[0-9]{1,40}$/.test(operation.postId)) throw new FacebookAdsValidationError('invalid_request', 'postInvalid', text);
    return;
  }
  if (operation.type === 'creative.create') {
    if (!validName(operation.name, nameMax) || !SAFE_ID.test(operation.targetId) || !/^[A-Za-z0-9_.-]{1,150}$/.test(operation.mediaId) || !['image', 'link'].includes(operation.format) || operation.message.length > 5000 || operation.title.length > 200) throw new FacebookAdsValidationError('invalid_request', 'creativeDetailsInvalid', text);
    if (operation.format === 'link') {
      let url: URL; try { url = new URL(operation.linkUrl ?? ''); } catch { throw new FacebookAdsValidationError('invalid_request', 'destinationInvalid', text); }
      if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048) throw new FacebookAdsValidationError('invalid_request', 'destinationCredentialsInvalid', text);
    } else if (operation.linkUrl !== undefined || operation.title) throw new FacebookAdsValidationError('invalid_request', 'imageTextOnly', text);
    return;
  }
  if (!SAFE_ID.test(operation.objectId)) throw new FacebookAdsValidationError('invalid_request', 'objectInvalid', text);
  if (operation.type === 'rename' && (!operation.name || operation.name.length > nameMax || /[\u0000-\u001f\u007f]/.test(operation.name))) throw new FacebookAdsValidationError('invalid_request', 'nameInvalid', text, { max: nameMax });
  if (operation.type === 'budget.set' && limits && operation.budget.minor > limits.maxBudgetMinor) throw new FacebookAdsValidationError('invalid_request', 'budgetLimitExceeded', text);
  if (operation.type === 'budget.set' && (!Number.isSafeInteger(operation.budget.minor) || operation.budget.minor < 1)) throw new FacebookAdsValidationError('invalid_request', 'budgetInvalid', text);
  if (operation.type === 'creative.assign' && !SAFE_ID.test(operation.creativeId)) throw new FacebookAdsValidationError('invalid_request', 'creativeInvalid', text);
}

export function facebookAdsConfirmation(operation: AdsNeutralOperation, context: { adAccountId: string; currency: string | null }, text: FacebookAdsText = defaultFacebookAdsText): string {
  const values: Record<string, string | number> = { adAccountId: context.adAccountId, currencySuffix: context.currency ? ` ${context.currency}` : '', objectType: text(operation.objectType === 'adset' ? 'objectAdSet' : operation.objectType === 'campaign' ? 'objectCampaign' : operation.objectType === 'ad' ? 'objectAd' : 'objectCreative') };
  if ('name' in operation) values.nameJson = JSON.stringify(operation.type === 'rename' || operation.type === 'creative.create' ? operation.name : operation.name.trim());
  if ('objectId' in operation) values.objectId = operation.objectId;
  if ('parentId' in operation) values.parentId = operation.parentId;
  if ('creativeId' in operation) values.creativeId = operation.creativeId;
  switch (operation.type) {
    case 'creative.create': {
      if (operation.format === 'post') return text('confirmCreativeFromPost', { ...values, postId: operation.postId, targetId: operation.targetId });
      const content = createHash('sha256').update(JSON.stringify({ name: operation.name, targetId: operation.targetId, mediaId: operation.mediaId, format: operation.format, message: operation.message, title: operation.title, linkUrl: operation.linkUrl ?? null })).digest('hex');
      return text('confirmCreativeCreate', { ...values, format: text(operation.format === 'image' ? 'formatImage' : 'formatLink'), targetId: operation.targetId, mediaId: operation.mediaId, content });
    }
    case 'campaign.create': return text('confirmCampaignCreate', { ...values, objective: operation.objective });
    case 'adset.create': {
      const base = text('confirmAdSetCreate', { ...values, dailyBudgetMinor: operation.dailyBudgetMinor, countryCode: operation.countryCode, optimizationGoal: operation.optimizationGoal });
      // Older requests (one country, no ages, no end) keep their exact confirmation; extras are spelled out after it.
      if (!hasTargetingExtras(operation)) return base;
      return `${base} ` + text('confirmAdSetTargeting', {
        countries: operation.extraCountryCodes?.length ? operation.extraCountryCodes.join(',') : text('targetingAny'),
        ages: operation.ageMin === undefined && operation.ageMax === undefined ? text('targetingAllAges') : `${operation.ageMin ?? 18}-${operation.ageMax ?? 65}`,
        endDate: operation.endDate ?? text('targetingNoEnd'),
      });
    }
    case 'ad.create': return text('confirmAdCreate', values);
    case 'status.set': return text(operation.status === 'active' ? 'confirmResume' : 'confirmPause', values);
    case 'budget.set': return text('confirmBudget', { ...values, budgetKind: text(operation.budget.kind === 'daily' ? 'budgetDaily' : 'budgetLifetime'), minor: operation.budget.minor });
    case 'rename': return text('confirmRename', values);
    case 'creative.assign': return text('confirmAssign', values);
    case 'delete': return text('confirmDelete', values);
    case 'object.copy': return text('confirmCopy', values);
  }
}

function belongs(payload: Record<string, unknown>, accountId: string) {
  const remote = typeof payload.account_id === 'string' ? bareAccount(payload.account_id) : '';
  return Boolean(remote) && remote === bareAccount(accountId);
}

async function verifyOwned(transport: FacebookAdsTransport, token: string, accountId: string, objectId: string, signal?: AbortSignal, text: FacebookAdsText = defaultFacebookAdsText) {
  const payload = await transport.get(encodeURIComponent(objectId), token, { fields: 'id,account_id' }, signal);
  if (payload.id !== objectId || !belongs(payload, accountId)) throw new FacebookAdsOpsError(text('ownershipMismatch'), { status: 0, beforeWrite: true }, 'ownershipMismatch');
}

/** Status is a provider-owned constant: creation never reads a status from the payload. */
async function executeCreation(transport: FacebookAdsTransport, token: string, context: AdsOpsContext, operation: CreateOperation, text: FacebookAdsText) {
  const name = operation.name.trim();
  let body: Record<string, string>;
  if (operation.type === 'campaign.create') {
    body = { name, objective: operation.objective, status: FACEBOOK_CREATE_STATUS, special_ad_categories: '[]',
      // Graph v26 requires an explicit choice when no campaign budget is set (error 100/4834011); ad sets keep their own budgets.
      is_adset_budget_sharing_enabled: 'false' };
  } else {
    // A campaign has an objective; an ad set or ad does not, so this also rejects wrong-level ids.
    const parent = await transport.get(encodeURIComponent(operation.parentId), token, { fields: 'id,account_id,objective' }, context.signal);
    if (parent.id !== operation.parentId || !belongs(parent, context.accountId) || typeof parent.objective !== 'string') {
      throw new FacebookAdsOpsError(text('ownershipCampaignMismatch'), { status: 0, beforeWrite: true }, 'ownershipCampaignMismatch');
    }
    body = {
      campaign_id: operation.parentId, name, daily_budget: String(operation.dailyBudgetMinor),
      billing_event: FACEBOOK_ADSET_CREATE_DEFAULTS.billing_event, optimization_goal: operation.optimizationGoal, bid_strategy: FACEBOOK_ADSET_CREATE_DEFAULTS.bid_strategy,
      targeting: JSON.stringify({ geo_locations: { countries: [operation.countryCode, ...(operation.extraCountryCodes ?? [])], location_types: [...FACEBOOK_ADSET_CREATE_DEFAULTS.location_types] },
        ...(operation.ageMin !== undefined ? { age_min: operation.ageMin } : {}), ...(operation.ageMax !== undefined ? { age_max: operation.ageMax } : {}) }),
      ...(operation.endDate ? { end_time: `${operation.endDate}T23:59:59+0000` } : {}),
      status: FACEBOOK_CREATE_STATUS,
    };
  }
  const edge = operation.type === 'campaign.create' ? 'campaigns' : 'adsets';
  const result = await transport.post(`${encodeURIComponent(context.accountId)}/${edge}`, token, body, context.signal);
  // The write was sent: a missing or malformed id leaves the outcome unknown, never "rejected".
  if (typeof result.id !== 'string' || !SAFE_ID.test(result.id)) throw new FacebookAdsOpsError(text('creationUnconfirmed'), { status: 200 }, 'creationUnconfirmed');
  await context.recordReceipt?.({ remoteId: result.id });
  return { remoteId: result.id };
}

/** An ad starts paused under a verified ad set with a verified existing creative; status is never taken from the caller. */
async function executeAdCreation(transport: FacebookAdsTransport, token: string, context: AdsOpsContext, operation: Extract<AdsNeutralOperation, { type: 'ad.create' }>, text: FacebookAdsText) {
  // A campaign or ad has no sibling shape of an ad set: an ad set carries a campaign_id and no adset_id.
  const parent = await transport.get(encodeURIComponent(operation.parentId), token, { fields: 'id,account_id,campaign_id,adset_id' }, context.signal);
  if (parent.id !== operation.parentId || !belongs(parent, context.accountId) || typeof parent.campaign_id !== 'string' || parent.adset_id !== undefined) {
    throw new FacebookAdsOpsError(text('ownershipAdSetMismatch'), { status: 0, beforeWrite: true }, 'ownershipAdSetMismatch');
  }
  await verifyOwned(transport, token, context.accountId, operation.creativeId, context.signal, text);
  const result = await transport.post(`${encodeURIComponent(context.accountId)}/ads`, token, {
    name: operation.name.trim(), adset_id: operation.parentId, creative: JSON.stringify({ creative_id: operation.creativeId }), status: FACEBOOK_CREATE_STATUS,
  }, context.signal);
  if (typeof result.id !== 'string' || !SAFE_ID.test(result.id)) throw new FacebookAdsOpsError(text('creationUnconfirmed'), { status: 200 }, 'creationUnconfirmed');
  await context.recordReceipt?.({ remoteId: result.id });
  return { remoteId: result.id };
}

async function configuredCreationUi(): Promise<AdsUiSchema> {
  const checked = FACEBOOK_ADS_CREATION_UI_SCHEMA.safeParse(await runtimeConfig('meta.adsCreationUi'));
  if (!checked.success) throw new FacebookAdsOpsError(defaultFacebookAdsText('creationPolicyUnavailable'), { status: 0, beforeWrite: true }, 'creationPolicyUnavailable');
  return checked.data;
}

export function createFacebookAdsOps(loadTransport: () => Promise<FacebookAdsTransport>, loadCreationUi: () => Promise<AdsUiSchema> = configuredCreationUi, text: FacebookAdsText = defaultFacebookAdsText): AdsOpsHost {
  const checkCurrent = async (operation: AdsNeutralOperation) => {
    if (operation.type !== 'campaign.create' && operation.type !== 'adset.create') return;
    const ui = await loadCreationUi();
    const form = operation.type === 'campaign.create' ? ui.campaign : ui.adSet;
    const choice = operation.type === 'campaign.create' ? operation.objective : operation.optimizationGoal;
    if (!form || !form.options.some(option => option.value === choice) || operation.name.length > form.nameMaxLength) throw new FacebookAdsOpsError(text('creationOptionInvalid'), { status: 0, beforeWrite: true }, 'creationOptionInvalid');
  };
  return {
    provider: 'facebook',
    creativeIdentityKinds: ['page'],
    operations: FACEBOOK_ADS_OPERATIONS.map(operation => ({ ...operation, label: text(operationLabelKeys[operation.id]), inputs: operation.inputs?.map(input => input.name === 'status' ? { ...input, options: input.options.map(option => ({ ...option, label: text(option.value === 'paused' ? 'pause' : 'resume') })) } : input) })),
    validate: (operation, limits) => validateFacebookAdsOperation(operation, limits, text),
    /** Pre-journal check: current Root creation-policy failures are explicit product errors, never raw adapter errors. */
    async validateCurrent(operation: AdsNeutralOperation) {
      try { await checkCurrent(operation); }
      catch (error) {
        if (!(error instanceof FacebookAdsOpsError) || !error.detail.beforeWrite) throw error;
        throw new FacebookAdsValidationError(error.issueCode === 'creationPolicyUnavailable' ? 'unavailable' : 'invalid_request', error.issueCode, text);
      }
    },
    confirmation: (operation, context) => facebookAdsConfirmation(operation, context, text),
    classifyFailure: classifyFacebookAdsFailure,
    async execute(context: AdsOpsContext, operation: AdsNeutralOperation) {
      validateFacebookAdsOperation(operation, undefined, text);
      await checkCurrent(operation);
      const transport = await loadTransport();
      const token = context.credential.accessToken;
      if (!SAFE_ID.test(context.accountId)) throw new FacebookAdsOpsError(text('accountInvalid'), { status: 0, beforeWrite: true }, 'accountInvalid');
      if (operation.type === 'creative.create') return executeFacebookCreative(transport, context, operation, text);
      if (operation.type === 'ad.create') return executeAdCreation(transport, token, context, operation, text);
      if (operation.type === 'campaign.create' || operation.type === 'adset.create') return executeCreation(transport, token, context, operation, text);
      await verifyOwned(transport, token, context.accountId, operation.objectId, context.signal, text);
      const path = encodeURIComponent(operation.objectId);
      if (operation.type === 'object.copy') {
        // Meta copies a campaign or ad set with what it contains; the copy never delivers until resumed.
        const copied = await transport.post(`${path}/copies`, token, { status_option: 'PAUSED', ...(operation.objectType === 'ad' ? {} : { deep_copy: 'true' }) }, context.signal);
        const remoteId = copied[`copied_${operation.objectType}_id`];
        if (typeof remoteId !== 'string' || !SAFE_ID.test(remoteId)) throw new FacebookAdsOpsError(text('copyUnconfirmed'), { status: 200 }, 'copyUnconfirmed');
        await context.recordReceipt?.({ remoteId });
        return { remoteId };
      }
      let body: Record<string, string>;
      switch (operation.type) {
        case 'status.set': body = { status: operation.status === 'active' ? 'ACTIVE' : 'PAUSED' }; break;
        case 'budget.set': body = { [operation.budget.kind === 'daily' ? 'daily_budget' : 'lifetime_budget']: String(operation.budget.minor) }; break;
        case 'rename': body = { name: operation.name }; break;
        case 'delete': body = { status: 'DELETED' }; break;
        case 'creative.assign': {
          await verifyOwned(transport, token, context.accountId, operation.creativeId, context.signal, text);
          body = { creative: JSON.stringify({ creative_id: operation.creativeId }) };
          break;
        }
      }
      const result = await transport.post(path, token, body, context.signal);
      // Graph answers { success: true } for updates; anything else is not a confirmed write.
      if (result.success !== true) throw new FacebookAdsOpsError(text('changeUnconfirmed'), { status: 200 }, 'changeUnconfirmed');
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

export async function configuredFacebookAdsTransport(fetchImpl?: FacebookAdsFetch, text: FacebookAdsText = defaultFacebookAdsText) {
  const [graphBaseUrl, oauthBaseUrl, graphVersion, requestTimeoutMs, maxPages, pageSize, pageInsightMetrics, adInsightFields, maxImageUploadBytes, allowedImageMimeTypes, appSecretProofEnabled, appSecret] = await Promise.all([
    runtimeConfig('meta.graphBaseUrl'), runtimeConfig('meta.oauthBaseUrl'), runtimeConfig('meta.graphVersion'), runtimeConfig('meta.requestTimeoutMs'),
    runtimeConfig('meta.maxPages'), runtimeConfig('meta.pageSize'), runtimeConfig('meta.pageInsightMetrics'), runtimeConfig('meta.adInsightFields'),
    runtimeConfig('meta.maxImageUploadBytes'), runtimeConfig('meta.allowedImageMimeTypes'), runtimeConfig('meta.appSecretProofEnabled'), runtimeSecret('meta.appSecret'),
  ]);
  return createFacebookAdsTransport({ graphBaseUrl, oauthBaseUrl, graphVersion, requestTimeoutMs, maxPages, pageSize, pageInsightMetrics, adInsightFields, maxImageUploadBytes, allowedImageMimeTypes, appSecretProofEnabled, ...(appSecret ? { appSecret } : {}) } as FacebookConfig, fetchImpl, text);
}

/** Runtime host for explicit installation by the host assembly (see docs/ADS_PARITY.md). */
export const facebookAdsOps: AdsOpsHost = createFacebookAdsOps(() => configuredFacebookAdsTransport());

/** Resolve once per shared service request, then use the same copy for preview and exact consent checks. */
export async function configuredFacebookAdsOps(locale: 'en' | 'fr' = 'en'): Promise<AdsOpsHost> {
  const text = facebookAdsText(await configOrDefault('meta.adsCopy', FACEBOOK_ADS_COPY_SCHEMA), locale);
  return createFacebookAdsOps(() => configuredFacebookAdsTransport(undefined, text), configuredCreationUi, text);
}
