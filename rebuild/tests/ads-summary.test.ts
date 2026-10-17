import { describe, expect, it } from 'vitest';
import { parseAdsFilters } from '../src/server/ads/queries';
import { summarizeInsights, type InsightRow } from '../src/server/ads/summary';

const base: InsightRow = {
  id: 'row', adAccountId: 'account-1', level: 'campaign', objectId: 'campaign-1', objectName: 'Spring',
  date: new Date('2026-10-13T00:00:00Z'), spend: 12, impressions: 1000, clicks: 20, reach: 800,
  cpc: 0.6, cpm: 12, cpp: 15, ctr: 2, frequency: 1.25,
  actions: [{ action_type: 'link_click', value: '10' }], fields: { provider_metric: 7 },
  adAccount: { id: 'account-1', name: 'Main', currency: 'USD' },
};

describe('ads summaries', () => {
  it('adds delivery metrics and actions while retaining latest snapshot metrics and fields', () => {
    const older = { ...base, date: new Date('2026-10-12T00:00:00Z'), spend: 8, impressions: 1000, clicks: 10, reach: 700, cpp: 16, frequency: 1.1, actions: [{ action_type: 'link_click', value: '2' }] };
    const [summary] = summarizeInsights([base, older]);
    expect(summary.spend).toBe(20);
    expect(summary.impressions).toBe(2000);
    expect(summary.clicks).toBe(30);
    expect(summary.reach).toBe(800);
    expect(summary.cpc).toBeCloseTo(20 / 30);
    expect(summary.cpm).toBe(10);
    expect(summary.ctr).toBe(1.5);
    expect(summary.cpp).toBe(15);
    expect(summary.frequency).toBe(1.25);
    expect(summary.actions).toEqual([{ name: 'link_click', value: 12 }]);
    expect(summary.fields).toEqual({ provider_metric: 7 });
  });

  it('uses UTC calendar boundaries for the explicitly selected accessible account', () => {
    const filters = parseAdsFilters({ period: 'custom', since: '2026-10-01', until: '2026-10-03', account: 'known' }, ['known'], new Date('2026-10-14T12:00:00Z'));
    expect(filters.since.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(filters.until.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(filters.accountId).toBe('known');
  });

  it('refuses an unavailable account instead of broadening the report to all accounts', () => {
    expect(() => parseAdsFilters({ account: 'other' }, ['known']))
      .toThrowError(expect.objectContaining({ code: 'unavailable' }));
  });

  it.each([
    { period: 'custom', since: '2026-02-30', until: '2026-03-03' },
    { period: 'custom', since: '2026-10-05', until: '2026-10-03' },
    { period: 'custom', until: '2026-10-03' },
    { period: 'invalid-period' },
    { account: ['all', 'known'] },
    { account: '' },
    { account: [''] },
  ])('rejects malformed filters without silently selecting a default report: %j', params => {
    expect(() => parseAdsFilters(params, ['known']))
      .toThrowError(expect.objectContaining({ code: 'invalid_request' }));
  });
});
