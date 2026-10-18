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

export function validateFacebookCampaign(name: string, objective: string): asserts objective is FacebookCampaignObjective {
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new OperationError('invalid_request', 'Campaign names must contain 1 to 100 printable characters.');
  if (!FACEBOOK_AD_OBJECTIVES.has(objective as FacebookCampaignObjective)) throw new OperationError('invalid_request', 'Choose a supported campaign objective.');
}
export function validateFacebookAdSet(input: { name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) {
  if (!input.name || input.name.length > 100 || /[\u0000-\u001f\u007f]/.test(input.name)) throw new OperationError('invalid_request', 'Ad set names must contain 1 to 100 printable characters.');
  if (!Number.isSafeInteger(input.dailyBudgetMinor) || input.dailyBudgetMinor < 1) throw new OperationError('invalid_request', 'Daily budgets must be positive whole minor currency units.');
  if (!/^[A-Z]{2}$/.test(input.countryCode)) throw new OperationError('invalid_request', 'Country code must be a two-letter uppercase code.');
  if (!['LINK_CLICKS', 'IMPRESSIONS'].includes(input.optimizationGoal)) throw new OperationError('invalid_request', 'Choose a valid country code and optimization goal.');
}

export function facebookCampaignConfirmation(accountId: string, name: string, objective: string) {
  return `CREATE PAUSED FACEBOOK CAMPAIGN ${JSON.stringify(name.trim())} IN ACCOUNT ${accountId} WITH OBJECTIVE ${objective}`;
}
export function facebookAdSetConfirmation(input: { adAccountId: string; campaignId: string; name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) {
  return `CREATE PAUSED FACEBOOK AD SET ${JSON.stringify(input.name.trim())} UNDER CAMPAIGN ${input.campaignId} IN ACCOUNT ${input.adAccountId} WITH DAILY BUDGET ${input.dailyBudgetMinor} MINOR UNITS TARGETING ${input.countryCode} OPTIMIZED FOR ${input.optimizationGoal}`;
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
