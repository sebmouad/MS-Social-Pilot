import { OperationError } from '@/lib/operation-error';
import type { FacebookConfig } from '@/platforms/facebook/config';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import type { AdsCreativeSummary, AdsNeutralOperation, AdsOpsContext, AdsOpsHost, AdsOpsLimits, AdsOperationSupport } from '@/modules/ads/management/types';
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
];

const label = (type: string) => (type === 'adset' ? 'AD SET' : type.toUpperCase());

export function validateFacebookAdsOperation(operation: AdsNeutralOperation, limits?: AdsOpsLimits): void {
  const nameMax = Math.min(NAME_MAX, limits?.nameMaxCharacters ?? NAME_MAX);
  const support = FACEBOOK_ADS_OPERATIONS.find(item => item.id === operation.type);
  if (!support || !support.objectTypes.includes(operation.objectType)) throw new OperationError('unavailable', 'This change is not available.');
  if (!SAFE_ID.test(operation.objectId)) throw new OperationError('invalid_request', 'Invalid ad object.');
  if (operation.type === 'rename' && (!operation.name || operation.name.length > nameMax || /[\u0000-\u001f\u007f]/.test(operation.name))) throw new OperationError('invalid_request', `Names must contain 1 to ${nameMax} printable characters.`);
  if (operation.type === 'budget.set' && limits && operation.budget.minor > limits.maxBudgetMinor) throw new OperationError('invalid_request', 'This budget is above the limit allowed for a single change.');
  if (operation.type === 'budget.set' && (!Number.isSafeInteger(operation.budget.minor) || operation.budget.minor < 1)) throw new OperationError('invalid_request', 'Budgets must be positive whole minor currency units.');
  if (operation.type === 'creative.assign' && !SAFE_ID.test(operation.creativeId)) throw new OperationError('invalid_request', 'Choose a valid creative.');
}

export function facebookAdsConfirmation(operation: AdsNeutralOperation, context: { adAccountId: string; currency: string | null }): string {
  const where = `IN ACCOUNT ${context.adAccountId}`;
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

export function createFacebookAdsOps(loadTransport: () => Promise<FacebookAdsTransport>): AdsOpsHost {
  return {
    provider: 'facebook',
    operations: FACEBOOK_ADS_OPERATIONS,
    validate: validateFacebookAdsOperation,
    confirmation: facebookAdsConfirmation,
    classifyFailure: classifyFacebookAdsFailure,
    async execute(context: AdsOpsContext, operation: AdsNeutralOperation) {
      validateFacebookAdsOperation(operation);
      const transport = await loadTransport();
      const token = context.credential.accessToken;
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
