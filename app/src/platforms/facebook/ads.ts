import { defaultFacebookAdsText, type FacebookAdsText } from './ads-copy';
import { facebookAdsConfirmation, FacebookAdsValidationError } from './ads-ops';
import { FACEBOOK_ADS_UI_DEFAULTS, FACEBOOK_ADS_CREATION_UI_SCHEMA } from './ads-ui-config';
import { facebookStoredAdsParent } from './ads-parent';
import type { FacebookCampaignObjective } from './protocol';
import type { AdMutationRequest, AdObjectReadRequest } from '@/platforms/types';
import { configuredFacebookEngine } from '@/platforms/facebook/runtime';
import { configuredCreateFacebookAdSet, type AdSetOptimizationGoal } from '@/platforms/facebook/adset';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';

export type { AdSetOptimizationGoal } from '@/platforms/facebook/adset';
export const FACEBOOK_AD_OBJECTIVES = new Set<FacebookCampaignObjective>([
  'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_APP_PROMOTION',
]);
export const FACEBOOK_ADS_MANAGEMENT_SCOPE = 'ads_management';

export function validateFacebookCampaign(name: string, objective: string, text: FacebookAdsText = defaultFacebookAdsText): asserts objective is FacebookCampaignObjective {
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new FacebookAdsValidationError('invalid_request', 'nameInvalid', text, { max: 100 });
  if (!FACEBOOK_AD_OBJECTIVES.has(objective as FacebookCampaignObjective)) throw new FacebookAdsValidationError('invalid_request', 'objectiveInvalid', text);
}
export function validateFacebookAdSet(input: { name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }, text: FacebookAdsText = defaultFacebookAdsText) {
  if (!input.name || input.name.length > 100 || /[\u0000-\u001f\u007f]/.test(input.name)) throw new FacebookAdsValidationError('invalid_request', 'nameInvalid', text, { max: 100 });
  if (!Number.isSafeInteger(input.dailyBudgetMinor) || input.dailyBudgetMinor < 1) throw new FacebookAdsValidationError('invalid_request', 'dailyBudgetInvalid', text);
  if (!/^[A-Z]{2}$/.test(input.countryCode)) throw new FacebookAdsValidationError('invalid_request', 'countryCodeInvalid', text);
  if (!['LINK_CLICKS', 'IMPRESSIONS'].includes(input.optimizationGoal)) throw new FacebookAdsValidationError('invalid_request', 'countryOptimizationInvalid', text);
}

export function facebookCampaignConfirmation(accountId: string, name: string, objective: string) {
  return facebookAdsConfirmation({ type: 'campaign.create', objectType: 'campaign', name, objective }, { adAccountId: accountId, currency: null });
}
export function facebookAdSetConfirmation(input: { adAccountId: string; campaignId: string; name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) {
  return facebookAdsConfirmation({ type: 'adset.create', objectType: 'adset', parentId: input.campaignId, name: input.name, dailyBudgetMinor: input.dailyBudgetMinor, countryCode: input.countryCode, optimizationGoal: input.optimizationGoal }, { adAccountId: input.adAccountId, currency: null });
}

export const facebookAdsHost = {
  parentObjectId: facebookStoredAdsParent,
  ui: FACEBOOK_ADS_UI_DEFAULTS,
  async creationUi() {
    const checked = FACEBOOK_ADS_CREATION_UI_SCHEMA.safeParse(await runtimeConfig('meta.adsCreationUi'));
    if (!checked.success) throw new OperationError('unavailable', 'Advertising creation choices are temporarily unavailable.');
    return checked.data;
  },
  async isReady() {
    try {
      const proofEnabled = await runtimeConfig('meta.appSecretProofEnabled');
      if (proofEnabled === false) return true;
      if (proofEnabled !== true) return false;
      return Boolean((await runtimeSecret('meta.appSecret'))?.trim());
    } catch {
      return false;
    }
  },
  async readScopes() { return runtimeConfig('meta.adsReadScopes') as Promise<string[]>; },
  async manageScopes() { return runtimeConfig('meta.adsManageScopes') as Promise<string[]>; },
  hasReadScopes(required: readonly string[], granted: readonly string[]) {
    const normalized = [...new Set(required.map(scope => scope.trim()).filter(Boolean))];
    const grantedSet = new Set(granted.map(scope => scope.trim()).filter(Boolean));
    return normalized.length > 0 && normalized.every(scope => grantedSet.has(scope));
  },
  validateManageScopes(required: readonly string[], granted: readonly string[]) {
    const normalized = [...new Set(required.map(scope => scope.trim()).filter(Boolean))];
    if (!normalized.length || !normalized.includes(FACEBOOK_ADS_MANAGEMENT_SCOPE)) throw new OperationError('unavailable', 'Advertising changes are currently unavailable.');
    const grantedSet = new Set(granted.map(scope => scope.trim()).filter(Boolean));
    if (normalized.some(scope => !grantedSet.has(scope))) throw new OperationError('reconnect_required', 'Reconnect this advertising connection and allow advertising changes.');
  },
  validateCampaign: validateFacebookCampaign,
  campaignConfirmation: facebookCampaignConfirmation,
  validateAdSet: validateFacebookAdSet,
  adSetConfirmation: facebookAdSetConfirmation,
  async read(input: AdObjectReadRequest) {
    const engine = await configuredFacebookEngine();
    if (!engine.readAdObject) throw new OperationError('unavailable', 'Live advertising status is currently unavailable.');
    return engine.readAdObject(input);
  },
  async update(input: AdMutationRequest) {
    const engine = await configuredFacebookEngine();
    await engine.updateAd(input);
  },
  async createCampaign(input: { credential: AdMutationRequest['credential']; accountId: string; name: string; objective: string }) {
    const engine = await configuredFacebookEngine();
    if (!engine.createCampaign) throw new OperationError('unavailable', 'Campaign creation is currently unavailable.');
    return engine.createCampaign({ ...input, objective: input.objective as FacebookCampaignObjective });
  },
  createAdSet(input: { credential: AdMutationRequest['credential']; accountId: string; campaignId: string; name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) {
    return configuredCreateFacebookAdSet({ ...input, optimizationGoal: input.optimizationGoal as AdSetOptimizationGoal });
  },
};
