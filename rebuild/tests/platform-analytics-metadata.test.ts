import { describe, expect, it } from 'vitest';
import { facebookAdMetricUnit, facebookMetricLabel, facebookPageMetricKind } from '../src/platforms/facebook/analytics';
import { instagramMetricKind, instagramMetricLabel } from '../src/platforms/instagram/analytics';
import { genericMetricLabel } from '../src/server/analytics/catalog';

describe('platform analytics metadata', () => {
  it('keeps Facebook Page labels and metric interpretation in the Facebook module', () => {
    expect(facebookMetricLabel('page_follows')).toBe('Followers');
    expect(facebookMetricLabel('page_post_engagements')).toBe('Post engagements');
    expect(facebookPageMetricKind('page_follows')).toBe('stock');
    expect(facebookPageMetricKind('page_daily_follows_unique')).toBe('flow');
    expect(facebookPageMetricKind('page_impressions_by_country')).toBe('breakdown');
  });

  it('keeps Facebook Ads units and labels in the Facebook module', () => {
    expect(facebookMetricLabel('cpm')).toBe('Cost per 1,000 impressions');
    expect(facebookAdMetricUnit('spend', 'USD')).toBe('currency');
    expect(facebookAdMetricUnit('ctr')).toBe('percent');
    expect(facebookAdMetricUnit('frequency')).toBe('multiple');
  });

  it('uses generic labels for unknown metrics and retains Instagram metadata', () => {
    expect(facebookMetricLabel('page_new_provider_metric')).toBeUndefined();
    expect(genericMetricLabel('page_new_provider_metric')).toBe('New Provider Metric');
    expect(instagramMetricLabel('follower_count')).toBe('New followers');
    expect(instagramMetricKind('follows_and_unfollows')).toBe('breakdown');
  });
});
