import type { AdMutationRequest, AdObjectReadRequest, FacebookCampaignObjective } from '@/platforms/types';
import { configuredFacebookEngine } from '@/server/platforms/facebook';
import { configuredCreateFacebookAdSet, type AdSetOptimizationGoal } from '@/platforms/facebook/adset';
import { runtimeConfig } from '@/server/config/store';

export type { AdSetOptimizationGoal } from '@/platforms/facebook/adset';
export const FACEBOOK_AD_OBJECTIVES = new Set<FacebookCampaignObjective>([
  'OUTCOME_AWARENESS', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES', 'OUTCOME_TRAFFIC', 'OUTCOME_APP_PROMOTION',
]);
export const FACEBOOK_ADS_MANAGEMENT_SCOPE = 'ads_management';

export function validateFacebookCampaign(name: string, objective: string): asserts objective is FacebookCampaignObjective {
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Campaign names must contain 1 to 100 printable characters.');
  if (!FACEBOOK_AD_OBJECTIVES.has(objective as FacebookCampaignObjective)) throw new Error('Choose a supported campaign objective.');
}
export function validateFacebookAdSet(input: { name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) {
  if (!input.name || input.name.length > 100 || /[\u0000-\u001f\u007f]/.test(input.name)) throw new Error('Ad set names must contain 1 to 100 printable characters.');
  if (!Number.isSafeInteger(input.dailyBudgetMinor) || input.dailyBudgetMinor < 1) throw new Error('Daily budgets must be positive whole minor currency units.');
  if (!/^[A-Z]{2}$/.test(input.countryCode)) throw new Error('Country code must be a two-letter uppercase code.');
  if (!['LINK_CLICKS', 'IMPRESSIONS'].includes(input.optimizationGoal)) throw new Error('Choose a valid country code and optimization goal.');
}

export function facebookCampaignConfirmation(accountId: string, name: string, objective: string) {
  return `CREATE PAUSED FACEBOOK CAMPAIGN ${JSON.stringify(name.trim())} IN ACCOUNT ${accountId} WITH OBJECTIVE ${objective}`;
}
export function facebookAdSetConfirmation(input: { adAccountId: string; campaignId: string; name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) {
  return `CREATE PAUSED FACEBOOK AD SET ${JSON.stringify(input.name.trim())} UNDER CAMPAIGN ${input.campaignId} IN ACCOUNT ${input.adAccountId} WITH DAILY BUDGET ${input.dailyBudgetMinor} MINOR UNITS TARGETING ${input.countryCode} OPTIMIZED FOR ${input.optimizationGoal}`;
}

export const facebookAdsHost = {
  async readScopes() { return runtimeConfig('meta.adsReadScopes') as Promise<string[]>; },
  async manageScopes() { return runtimeConfig('meta.adsManageScopes') as Promise<string[]>; },
  hasReadScopes(required: readonly string[], granted: readonly string[]) {
    const normalized = [...new Set(required.map(scope => scope.trim()).filter(Boolean))];
    const grantedSet = new Set(granted.map(scope => scope.trim()).filter(Boolean));
    return normalized.length > 0 && normalized.every(scope => grantedSet.has(scope));
  },
  validateManageScopes(required: readonly string[], granted: readonly string[]) {
    const normalized = [...new Set(required.map(scope => scope.trim()).filter(Boolean))];
    if (!normalized.length || !normalized.includes(FACEBOOK_ADS_MANAGEMENT_SCOPE)) throw new Error('Root has not configured the ads_management scope.');
    const grantedSet = new Set(granted.map(scope => scope.trim()).filter(Boolean));
    if (normalized.some(scope => !grantedSet.has(scope))) throw new Error('Reconnect this Facebook source and grant the configured ads management scopes.');
  },
  validateCampaign: validateFacebookCampaign,
  campaignConfirmation: facebookCampaignConfirmation,
  validateAdSet: validateFacebookAdSet,
  adSetConfirmation: facebookAdSetConfirmation,
  async read(input: AdObjectReadRequest) {
    const engine = await configuredFacebookEngine();
    if (!engine.readAdObject) throw new Error('Facebook ad object reads are unavailable.');
    return engine.readAdObject(input);
  },
  async update(input: AdMutationRequest) {
    const engine = await configuredFacebookEngine();
    await engine.updateAd(input);
  },
  async createCampaign(input: { credential: AdMutationRequest['credential']; accountId: string; name: string; objective: string }) {
    const engine = await configuredFacebookEngine();
    if (!engine.createCampaign) throw new Error('Facebook campaign creation is unavailable.');
    return engine.createCampaign({ ...input, objective: input.objective as FacebookCampaignObjective });
  },
  createAdSet(input: { credential: AdMutationRequest['credential']; accountId: string; campaignId: string; name: string; dailyBudgetMinor: number; countryCode: string; optimizationGoal: string }) {
    return configuredCreateFacebookAdSet({ ...input, optimizationGoal: input.optimizationGoal as AdSetOptimizationGoal });
  },
};
