import type { FacebookConfig } from '@/platforms/facebook/config';
import { validateFacebookConfig } from '@/platforms/facebook/config';
import { graphObjectUrl } from '@/platforms/facebook/protocol';
import type { PlatformCredential } from '@/platforms/types';
import { runtimeConfig } from '@/server/config/store';

export type AdSetOptimizationGoal = 'LINK_CLICKS' | 'IMPRESSIONS';
export type FacebookAdSetCreateInput = {
  credential: PlatformCredential;
  accountId: string;
  campaignId: string;
  name: string;
  dailyBudgetMinor: number;
  countryCode: string;
  optimizationGoal: AdSetOptimizationGoal;
};

const GOALS = new Set<AdSetOptimizationGoal>(['LINK_CLICKS', 'IMPRESSIONS']);
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

export async function createFacebookAdSet(config: FacebookConfig, input: FacebookAdSetCreateInput, fetchImpl: typeof fetch = fetch) {
  validateFacebookConfig(config);
  const name = input.name.trim();
  if (!SAFE_ID.test(input.accountId) || !SAFE_ID.test(input.campaignId)) throw new Error('Invalid ad account or campaign.');
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Ad set names must contain 1 to 100 printable characters.');
  if (!Number.isSafeInteger(input.dailyBudgetMinor) || input.dailyBudgetMinor < 1) throw new Error('Daily budgets must be positive whole minor currency units.');
  if (!/^[A-Z]{2}$/.test(input.countryCode) || !GOALS.has(input.optimizationGoal)) throw new Error('Choose a valid country code and optimization goal.');

  const url = graphObjectUrl(config, `${input.accountId}/adsets`);
  const body = new URLSearchParams({
    access_token: input.credential.accessToken,
    campaign_id: input.campaignId,
    name,
    daily_budget: String(input.dailyBudgetMinor),
    billing_event: 'IMPRESSIONS',
    optimization_goal: input.optimizationGoal,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: JSON.stringify({ geo_locations: { countries: [input.countryCode], location_types: ['home', 'recent'] } }),
    status: 'PAUSED',
  });
  let response: Response;
  try {
    const campaignUrl = graphObjectUrl(config, input.campaignId);
    campaignUrl.searchParams.set('fields', 'id,account_id');
    campaignUrl.searchParams.set('access_token', input.credential.accessToken);
    const campaignResponse = await fetchImpl(campaignUrl, { redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs) });
    const campaign = await campaignResponse.json().catch(() => null) as { id?: unknown; account_id?: unknown; error?: { message?: unknown } } | null;
    if (!campaignResponse.ok || campaign?.error) throw new Error(typeof campaign?.error?.message === 'string' ? campaign.error.message : `Facebook answered ${campaignResponse.status}.`);
    const remoteAccountId = typeof campaign?.account_id === 'string' ? campaign.account_id.replace(/^act_/, '') : '';
    if (campaign?.id !== input.campaignId || !remoteAccountId || remoteAccountId !== input.accountId.replace(/^act_/, '')) {
      throw new Error('This campaign does not belong to the selected ad account.');
    }
    response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, redirect: 'error', signal: AbortSignal.timeout(config.requestTimeoutMs) });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Facebook ad set creation failed.');
  }
  const payload = await response.json().catch(() => null) as { id?: unknown; error?: { message?: unknown } } | null;
  if (!response.ok || payload?.error) throw new Error(typeof payload?.error?.message === 'string' ? payload.error.message : `Facebook answered ${response.status}.`);
  if (typeof payload?.id !== 'string' || !payload.id) throw new Error('Facebook did not return an ad set ID.');
  return { remoteId: payload.id };
}

export async function configuredCreateFacebookAdSet(input: FacebookAdSetCreateInput) {
  const [graphBaseUrl, oauthBaseUrl, graphVersion, requestTimeoutMs, maxPages, pageSize, pageInsightMetrics, adInsightFields, maxImageUploadBytes, allowedImageMimeTypes] = await Promise.all([
    runtimeConfig('meta.graphBaseUrl'), runtimeConfig('meta.oauthBaseUrl'), runtimeConfig('meta.graphVersion'), runtimeConfig('meta.requestTimeoutMs'),
    runtimeConfig('meta.maxPages'), runtimeConfig('meta.pageSize'), runtimeConfig('meta.pageInsightMetrics'), runtimeConfig('meta.adInsightFields'),
    runtimeConfig('meta.maxImageUploadBytes'), runtimeConfig('meta.allowedImageMimeTypes'),
  ]);
  return createFacebookAdSet({ graphBaseUrl, oauthBaseUrl, graphVersion, requestTimeoutMs, maxPages, pageSize, pageInsightMetrics, adInsightFields, maxImageUploadBytes, allowedImageMimeTypes } as FacebookConfig, input);
}
