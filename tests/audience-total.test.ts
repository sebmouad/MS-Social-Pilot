import { describe, expect, it } from 'vitest';
import { audienceTotal } from '../src/lib/audience-total';

const page = (id: string, followers: number | null, addsMetric = 'page_daily_follows_unique') => ({
  id, name: id, network: 'facebook', audience: {
    fans: 5, followers, talkingAbout: 2, byCountry: { MA: 3 }, byCity: {}, byLocale: {}, byGenderAge: {},
    adds: 4, removes: 1, net: 3, addsMetric, removesMetric: addsMetric === 'page_fan_adds' ? 'page_fan_removes' : 'page_daily_unfollows_unique',
  },
});

describe('audienceTotal', () => {
  it('adds every selected channel and exposes missing coverage', () => {
    const result = audienceTotal([page('a', 10), page('b', null)], [
      { key: 'ig:1', name: '@one', network: 'instagram', followers: 7 },
      { key: 'net:1', name: 'Other', network: 'x', followers: null },
    ]);
    expect(result.followers).toBe(17);
    expect(result.followerCoverage).toBe(2);
    expect(result.selectedCount).toBe(4);
    expect(result.byCountry).toEqual({ MA: 6 });
    expect(result.gained).toBe(8);
    expect(result.net).toBe(6);
  });

  it('never mixes historical Page likes into follower growth', () => {
    const result = audienceTotal([page('a', 10), page('old', 20, 'page_fan_adds')], []);
    expect(result.followers).toBe(30);
    expect(result.gained).toBe(4);
    expect(result.growthCoverage).toBe(1);
  });
});
