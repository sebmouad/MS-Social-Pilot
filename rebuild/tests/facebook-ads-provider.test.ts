import { describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createFacebookAdSet } from '../src/platforms/facebook/adset';
import { facebookAdsHost } from '../src/platforms/facebook/ads';
import { fillAdsTemplate } from '../src/platforms/ads-ui';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const appSecret = 'synthetic-app-secret';
const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.com', oauthBaseUrl: 'https://www.facebook.com', graphVersion: 'v99.0',
  requestTimeoutMs: 5_000, maxPages: 10, pageSize: 25, pageInsightMetrics: [], adInsightFields: [],
  maxImageUploadBytes: 1024, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: true, appSecret,
};
const proof = (token: string) => createHmac('sha256', appSecret).update(token).digest('hex');
const input = { credential: { accessToken: 'secret-token' }, accountId: 'act_99', campaignId: 'campaign-4', name: 'Prospecting',
  dailyBudgetMinor: 5000, countryCode: 'MA', optimizationGoal: 'LINK_CLICKS' as const };
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body }) as Response;

describe('Facebook ad set creation', () => {
  it('exposes safe actionable failures without internal Root setup or scope identifiers', () => {
    for (const required of [[], ['ads_read']]) {
      try { facebookAdsHost.validateManageScopes(required, ['ads_management']); throw new Error('Expected refusal'); }
      catch (error) {
        expect(error).toMatchObject({ code: 'unavailable', message: 'Advertising changes are currently unavailable.' });
      }
    }
    try { facebookAdsHost.validateManageScopes(['ads_management'], ['ads_read']); throw new Error('Expected refusal'); }
    catch (error) { expect(error).toMatchObject({ code: 'reconnect_required', message: 'Reconnect this advertising connection and allow advertising changes.' }); }
    expect(() => facebookAdsHost.validateManageScopes(['ads_management'], ['ads_management'])).not.toThrow();
  });
  it('owns the campaign and ad set form options, copy, and exact-confirmation formats', () => {
    expect(facebookAdsHost.ui.campaign?.options.map(option => option.value)).toContain('OUTCOME_TRAFFIC');
    expect(facebookAdsHost.ui.campaign?.confirmationTemplate).toContain('FACEBOOK CAMPAIGN');
    expect(facebookAdsHost.ui.adSet?.options.map(option => option.value)).toEqual(['LINK_CLICKS', 'IMPRESSIONS']);
    expect(facebookAdsHost.ui.campaign?.description).toContain('paused campaign');
    expect(facebookAdsHost.ui.adSet?.confirmationTemplate).toContain('FACEBOOK AD SET');
  });

  it('keeps the browser templates and server confirmations identical for names with quotes and braces', () => {
    const name = 'Audience "A" {campaignId}';
    expect(fillAdsTemplate(facebookAdsHost.ui.campaign.confirmationTemplate, {
      nameJson: JSON.stringify(name), adAccountId: 'account-1', objective: 'OUTCOME_TRAFFIC',
    })).toBe(facebookAdsHost.campaignConfirmation('account-1', name, 'OUTCOME_TRAFFIC'));
    const values = { name, adAccountId: 'account-1', campaignId: 'campaign-2', dailyBudgetMinor: 2500, countryCode: 'MA', optimizationGoal: 'LINK_CLICKS' };
    expect(fillAdsTemplate(facebookAdsHost.ui.adSet.confirmationTemplate, {
      ...values, nameJson: JSON.stringify(name), dailyBudgetMinor: String(values.dailyBudgetMinor), currencySuffix: '',
    })).toBe(facebookAdsHost.adSetConfirmation(values));
    expect(() => fillAdsTemplate('{missing}', {})).toThrow('Missing Ads template value');
  });

  it('creates a paused ad set with explicit campaign, budget, delivery goal, and country targeting', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes('/campaign-4?fields=id%2Caccount_id&access_token=secret-token&appsecret_proof=')) {
        expect(init?.method ?? 'GET').toBe('GET');
        expect(new URL(String(url)).searchParams.get('appsecret_proof')).toBe(proof('secret-token'));
        return response({ id: 'campaign-4', account_id: '99' });
      }
      expect(String(url)).toBe('https://graph.facebook.com/v99.0/act_99/adsets');
      expect(init?.method).toBe('POST');
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('access_token')).toBe('secret-token');
      expect(body.get('appsecret_proof')).toBe(proof('secret-token'));
      expect(body.get('campaign_id')).toBe('campaign-4');
      expect(body.get('status')).toBe('PAUSED');
      expect(body.get('daily_budget')).toBe('5000');
      expect(body.get('billing_event')).toBe('IMPRESSIONS');
      expect(body.get('optimization_goal')).toBe('LINK_CLICKS');
      expect(body.get('bid_strategy')).toBe('LOWEST_COST_WITHOUT_CAP');
      expect(body.get('targeting')).toBe(JSON.stringify({ geo_locations: { countries: ['MA'], location_types: ['home', 'recent'] } }));
      return response({ id: 'adset-8' });
    }) as unknown as typeof fetch;
    await expect(createFacebookAdSet(config, input, fetcher)).resolves.toEqual({ remoteId: 'adset-8' });
  });

  it('refuses to create when the live campaign belongs to a different ad account', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return response({ id: 'campaign-4', account_id: '98' });
      return response({ id: 'must-not-create' });
    }) as unknown as typeof fetch;
    await expect(createFacebookAdSet(config, input, fetcher)).rejects.toThrow(/does not belong to the selected ad account/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('validates ad set input before sending a provider request', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(createFacebookAdSet(config, { ...input, countryCode: 'morocco' }, fetcher)).rejects.toThrow(/country code/);
    await expect(createFacebookAdSet(config, { ...input, dailyBudgetMinor: 0 }, fetcher)).rejects.toThrow(/positive whole/);
    await expect(createFacebookAdSet(config, { ...input, optimizationGoal: 'LEAD_GENERATION' as never }, fetcher)).rejects.toThrow(/optimization goal/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails before transport when proof is enabled without the app secret', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(createFacebookAdSet({ ...config, appSecret: undefined }, input, fetcher)).rejects.toThrow(/app secret/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('omits appsecret_proof from both Graph requests when Root disables signing', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
      ? response({ id: 'adset-8' }) : response({ id: 'campaign-4', account_id: '99' })) as unknown as typeof fetch;
    await expect(createFacebookAdSet({ ...config, appSecretProofEnabled: false }, input, fetcher)).resolves.toEqual({ remoteId: 'adset-8' });
    const calls = vi.mocked(fetcher).mock.calls;
    const campaignUrl = new URL(String(calls[0][0]));
    const adSetBody = new URLSearchParams(String(calls[1][1]?.body));
    expect(campaignUrl.searchParams.get('access_token')).toBe(input.credential.accessToken);
    expect(campaignUrl.searchParams.has('appsecret_proof')).toBe(false);
    expect(adSetBody.get('access_token')).toBe(input.credential.accessToken);
    expect(adSetBody.has('appsecret_proof')).toBe(false);
  });

  it('surfaces a safe provider failure when Meta rejects the ad set', async () => {
    const fetcher = vi.fn(async () => response({ error: { message: 'Invalid campaign' } }, false)) as unknown as typeof fetch;
    await expect(createFacebookAdSet(config, input, fetcher)).rejects.toThrow(/Invalid campaign/);
  });
});
