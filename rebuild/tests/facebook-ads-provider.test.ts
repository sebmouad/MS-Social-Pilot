import { describe, expect, it, vi } from 'vitest';
import { createFacebookAdSet } from '../src/server/ads/facebook-ads';

const config = {
  graphBaseUrl: 'https://graph.facebook.com', oauthBaseUrl: 'https://www.facebook.com', graphVersion: 'v99.0',
  requestTimeoutMs: 5_000, maxPages: 10, pageSize: 25, pageInsightMetrics: [], adInsightFields: [],
  maxImageUploadBytes: 1024, allowedImageMimeTypes: ['image/jpeg'],
};
const input = { credential: { accessToken: 'secret-token' }, accountId: 'act_99', campaignId: 'campaign-4', name: 'Prospecting',
  dailyBudgetMinor: 5000, countryCode: 'MA', optimizationGoal: 'LINK_CLICKS' as const };
const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => body }) as Response;

describe('Facebook ad set creation', () => {
  it('creates a paused ad set with explicit campaign, budget, delivery goal, and country targeting', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/campaign-4?fields=id%2Caccount_id&access_token=secret-token')) {
        expect(init?.method ?? 'GET').toBe('GET');
        return response({ id: 'campaign-4', account_id: '99' });
      }
      expect(String(url)).toBe('https://graph.facebook.com/v99.0/act_99/adsets');
      expect(init?.method).toBe('POST');
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('access_token')).toBe('secret-token');
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

  it('surfaces a safe provider failure when Meta rejects the ad set', async () => {
    const fetcher = vi.fn(async () => response({ error: { message: 'Invalid campaign' } }, false)) as unknown as typeof fetch;
    await expect(createFacebookAdSet(config, input, fetcher)).rejects.toThrow(/Invalid campaign/);
  });
});
