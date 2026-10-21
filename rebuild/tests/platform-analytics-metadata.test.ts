import { describe, expect, it } from 'vitest';
import { facebookAdMetricUnit, facebookMetricLabel, facebookPageMetricKind } from '../src/platforms/facebook/analytics';
import { instagramMetricKind, instagramMetricLabel } from '../src/platforms/instagram/analytics';
import { genericMetricLabel } from '@/modules/analytics/server/catalog';
import { normalizeFacebookAnalytics } from '../src/platforms/facebook/analytics';
import { buildAnalytics } from '@/modules/analytics/server/aggregate';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('platform analytics metadata', () => {
  it('keeps Facebook Page labels and metric interpretation in the Facebook module', () => {
    expect(facebookMetricLabel('page_follows')).toBe('Followers');
    expect(facebookMetricLabel('page_post_engagements')).toBe('Post engagements');
    expect(facebookPageMetricKind('page_follows')).toBe('stock');
    expect(facebookPageMetricKind('page_daily_follows_unique')).toBe('stock');
    expect(facebookPageMetricKind('page_impressions_by_country')).toBe('breakdown');
  });

  it('keeps Facebook Ads units and labels in the Facebook module', () => {
    expect(facebookMetricLabel('cpm')).toBe('Cost per 1,000 impressions');
    expect(facebookAdMetricUnit('spend', 'USD')).toBe('currency');
    expect(facebookAdMetricUnit('spend')).toBe('currency');
    expect(facebookAdMetricUnit('ctr')).toBe('percent');
    expect(facebookAdMetricUnit('frequency')).toBe('multiple');
  });

  it('uses generic labels for unknown metrics and retains Instagram metadata', () => {
    expect(facebookMetricLabel('page_new_provider_metric')).toBeUndefined();
    expect(genericMetricLabel('page_new_provider_metric')).toBe('Page New Provider Metric');
    expect(instagramMetricLabel('follower_count')).toBe('New followers');
    expect(instagramMetricKind('follows_and_unfollows')).toBe('breakdown');
  });

  it('maps Facebook legacy Page, Ads, action and retained-field rows to neutral inputs', () => {
    const pageRows = [
      { metric: 'page_daily_follows_unique', period: 'day', endTime: date('2026-10-01'), fetchedAt: date('2026-10-02'), numeric: 4, value: 4, target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_daily_follows_unique', period: 'day', endTime: date('2026-10-02'), fetchedAt: date('2026-10-03'), numeric: 5, value: 5, target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_daily_follows_unique', period: 'day', endTime: date('2026-10-02'), fetchedAt: date('2026-10-03'), numeric: 3, value: 3, target: { id: 'p2', name: 'Page Two' } },
      { metric: 'page_follows', period: 'day', endTime: date('2026-10-01'), fetchedAt: date('2026-10-02'), numeric: 90, value: 90, target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_follows', period: 'day', endTime: date('2026-10-02'), fetchedAt: date('2026-10-03'), numeric: 100, value: 100, target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_follows', period: 'day', endTime: date('2026-10-02'), fetchedAt: date('2026-10-03'), numeric: 60, value: 60, target: { id: 'p2', name: 'Page Two' } },
      { metric: 'page_impressions_by_country', period: 'day', endTime: date('2026-10-02'), fetchedAt: date('2026-10-03'), numeric: null, value: { US: 10, CA: 2 }, target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_new_demographic_metric', period: 'day', endTime: date('2026-10-02'), fetchedAt: date('2026-10-03'), numeric: null, value: { age_18_24: 7 }, target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_new_demographic_metric', period: 'day', endTime: date('2026-10-02'), fetchedAt: date('2026-10-03'), numeric: 9, value: 9, target: { id: 'p2', name: 'Page Two' } },
      { metric: 'page_total_media_view_unique', period: 'day', endTime: date('2026-10-01'), fetchedAt: date('2026-10-02'), numeric: 20, value: 20, target: { id: 'p1', name: 'Page One' } },
      { metric: 'page_total_media_view_unique', period: 'day', endTime: date('2026-10-02'), fetchedAt: date('2026-10-03'), numeric: 25, value: 25, target: { id: 'p1', name: 'Page One' } },
    ];
    const audienceRows = [
      { ...pageRows[4]!, metric: 'page_follows' },
      { ...pageRows[5]!, metric: 'page_follows' },
      { ...pageRows[4]!, endTime: date('2026-10-04'), numeric: 110 },
    ];
    const base = { date: date('2026-10-01'), spend: 20, impressions: 1000, clicks: 25, reach: 700, cpc: 12, cpm: 999, cpp: 0.03, ctr: 0.1, frequency: 1.4, fetchedAt: date('2026-10-02'), actions: { actions: [{ action_type: 'link_click', value: '25' }] }, fields: { quality_ranking: 2, combined_quality: 3, audience_by_age: { '18-24': 4, '25-34': 8 }, actions: [{ action_type: 'link_click', value: '25' }], action_values: [{ action_type: 'purchase', value: '12' }], cost_per_action_type: [{ action_type: 'link_click', value: '0.8' }] }, adAccount: { id: 'a1', name: 'Account One', currency: 'USD' } };
    const adRows = [base, { ...base, date: date('2026-10-02'), spend: 10, impressions: 500, clicks: 5, reach: 400, cpc: null, cpm: null, ctr: null, adAccount: { id: 'a2', name: 'Account Two', currency: 'EUR' }, actions: [{ action_type: 'link_click', value: '5' }], fields: { quality_ranking: 3, combined_quality: { stable: 2, nested: { newer: 4 } }, audience_by_age: { '18-24': 1, '35-44': 2 }, actions: [{ action_type: 'link_click', value: '8' }], action_values: [{ action_type: 'purchase', value: '6' }], cost_per_action_type: [{ action_type: 'link_click', value: '1.5' }] } }];
    const selectedTargets = [{ id: 'p1', name: 'Page One', type: 'page', socialAccountId: 's1' }, { id: 'p2', name: 'Page Two', type: 'page', socialAccountId: 's1' }];
    const selectedAdAccounts = [{ id: 'a1', name: 'Account One', currency: 'USD' }, { id: 'a2', name: 'Account Two', currency: 'EUR' }, { id: 'a3', name: 'Account Three', currency: 'USD' }];
    const result = normalizeFacebookAnalytics({ pageRows, audienceRows, adRows, selectedTargets, selectedAdAccounts, audienceAsOf: date('2026-10-02') });
    expect(result.metrics.every(metric => Array.isArray(metric.coveredResourceIds))).toBe(true);
    expect(result.metrics.filter(metric => metric.sourceLabel === 'Advertising').every(metric => metric.resourceKind === 'ad-account')).toBe(true);
    expect(result.metrics.find(metric => metric.key === 'page_follows::day')?.resourceKind).toBeUndefined();
    expect(result.metrics.find(metric => metric.key === 'page_daily_follows_unique::day')).toMatchObject({ kind: 'stock', rollup: 'latest-per-channel', label: expect.stringMatching(/latest/i), coveredResourceIds: ['p1', 'p2'] });
    expect(result.metrics.find(metric => metric.key === 'page_daily_follows_unique::day')?.observations.map(row => row.value)).toEqual([4, 5, 3]);
    expect(result.metrics.find(metric => metric.key === 'page_total_media_view_unique::day')).toMatchObject({ kind: 'stock', coveredResourceIds: ['p1'] });
    expect(result.metrics.find(metric => metric.key === 'page_follows::day')).toMatchObject({ kind: 'stock', observations: expect.any(Array), available: 2 });
    expect(result.metrics.find(metric => metric.key === 'page_impressions_by_country::day')).toMatchObject({ kind: 'breakdown', rows: [{ label: 'US', value: 10 }, { label: 'CA', value: 2 }] });
    expect(result.metrics.find(metric => metric.key === 'page_new_demographic_metric::day')).toMatchObject({ kind: 'stock', coveredResourceIds: ['p2'] });
    expect(result.metrics.find(metric => metric.key === 'page_new_demographic_metric::day::breakdown')).toMatchObject({ kind: 'breakdown', rows: [{ label: 'age_18_24', value: 7 }], coveredResourceIds: ['p1'] });
    expect(result.audienceEntries.map(row => row.value)).toEqual([100, 60]);
    expect(result.audienceEntries.map(row => row.asOf.toISOString().slice(0, 10))).toEqual(['2026-10-02', '2026-10-02']);
    const spendMetrics = buildAnalytics(result.metrics, [], 0).metrics.filter(metric => metric.key.startsWith('spend'));
    expect(spendMetrics.find(metric => metric.key === 'spend::USD')).toMatchObject({ label: 'Spend · USD', unit: 'currency', total: 20, coverage: 1, available: 2 });
    expect(spendMetrics.find(metric => metric.key === 'spend::EUR')).toMatchObject({ label: 'Spend · EUR', unit: 'currency', total: 10, coverage: 1, available: 1 });
    const singleCurrency = normalizeFacebookAnalytics({ pageRows: [], audienceRows: [], adRows: adRows.map(row => ({ ...row, adAccount: { ...row.adAccount, currency: 'USD' } })), selectedTargets, selectedAdAccounts: selectedAdAccounts.map(account => ({ ...account, currency: 'USD' })) });
    expect(buildAnalytics(singleCurrency.metrics, [], 0).metrics.find(metric => metric.key === 'cpc::USD')?.total).toBeCloseTo(1);
    const view = buildAnalytics(result.metrics, [], 0);
    expect(view.metrics.find(metric => metric.key === 'reach')?.aggregationNote).toContain('not deduplicated');
    expect(view.metrics.find(metric => metric.key === 'page_total_media_view_unique::day')?.aggregationNote).toContain('may overlap');
    expect(view.metrics.find(metric => metric.key === 'frequency')).toMatchObject({ coverage: 1, coveredResourceIds: ['a2'], aggregationLabel: 'Calculated for the latest stored day' });
    expect(view.metrics.find(metric => metric.key === 'frequency')?.aggregationNote).toContain('overlap');
    expect(view.metrics.find(metric => metric.key === 'cpp::USD')?.aggregationNote).toContain('overlap');
    expect(view.metrics.find(metric => metric.key === 'cpc::USD')?.total).toBeCloseTo(0.8);
    expect(result.metrics.find(metric => metric.key === 'cpc::USD')?.coveredResourceIds).toEqual(['a1']);
    expect(view.metrics.find(metric => metric.key === 'cpc::EUR')?.total).toBeCloseTo(2);
    expect(view.metrics.find(metric => metric.key === 'cpm::USD')?.total).toBeCloseTo(20);
    expect(view.metrics.find(metric => metric.key === 'cpm::EUR')?.total).toBeCloseTo(20);
    expect(view.metrics.find(metric => metric.key === 'ctr')?.total).toBeCloseTo(2);
    expect(result.metrics.find(metric => metric.key === 'quality_ranking')).toMatchObject({ kind: 'stock', rollup: 'latest-per-channel', observations: [{ channelId: 'a1' }, { channelId: 'a2' }], rows: [{ value: 2 }, { value: 3 }], totalOverride: null, coveredResourceIds: ['a1', 'a2'] });
    expect(result.metrics.find(metric => metric.key === 'actions:link_click')?.observations.map(row => row.value)).toEqual([25, 5]);
    expect(result.metrics.find(metric => metric.key === 'actions:link_click')).toMatchObject({ available: 3, coveredResourceIds: ['a1', 'a2'] });
    expect(result.metrics.find(metric => metric.key === 'quality_ranking')).toMatchObject({ available: 3, coveredResourceIds: ['a1', 'a2'] });
    expect(result.metrics.find(metric => metric.key === 'combined_quality')).toMatchObject({ kind: 'stock', coveredResourceIds: ['a1'] });
    expect(result.metrics.find(metric => metric.key === 'combined_quality::breakdown')).toMatchObject({ kind: 'breakdown', rows: [{ label: 'stable', value: 2 }], coveredResourceIds: ['a2'] });
    expect(result.metrics.find(metric => metric.key === 'combined_quality:nested')).toMatchObject({ kind: 'breakdown', rows: [{ label: 'newer', value: 4 }], coveredResourceIds: ['a2'] });
    expect(result.metrics.find(metric => metric.key === 'action_values:purchase::USD')).toMatchObject({ kind: 'flow', unit: 'currency', label: 'Purchases · Action value · USD' });
    expect(result.metrics.find(metric => metric.key === 'action_values:purchase::EUR')).toMatchObject({ kind: 'flow', unit: 'currency' });
    expect(result.metrics.find(metric => metric.key === 'cost_per_action_type:link_click::USD')).toMatchObject({ kind: 'ratio', unit: 'currency', totalOverride: null, displayTotal: 'Per-account values' });
    expect(result.metrics.find(metric => metric.key === 'cost_per_action_type:link_click::EUR')).toMatchObject({ kind: 'ratio', unit: 'currency' });
    const unknownCurrency = normalizeFacebookAnalytics({ pageRows: [], audienceRows: [], selectedTargets, selectedAdAccounts: [{ id: 'a4', name: 'Account Four', currency: null }], adRows: [{ ...base, adAccount: { id: 'a4', name: 'Account Four', currency: null } }] });
    expect(unknownCurrency.metrics.find(metric => metric.key === 'spend::unknown-currency')).toMatchObject({ unit: 'currency', label: 'Spend · Unknown currency', available: 1 });
    const ageBreakdown = view.metrics.find(metric => metric.key === 'audience_by_age');
    expect(ageBreakdown).toMatchObject({ kind: 'breakdown', total: null });
    expect(ageBreakdown?.rows.map(({ label, value }) => ({ label, value }))).toEqual([{ label: '25-34', value: 8 }, { label: '18-24', value: 5 }, { label: '35-44', value: 2 }]);
  });
});
