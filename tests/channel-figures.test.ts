import { describe, expect, it } from 'vitest';

import { instagramChannel, instagramPosts, networkChannels, networkPosts, rate, sumKnown, totalChannels } from '../src/lib/channel-figures';

const from = new Date('2026-09-01T00:00:00Z');
const to = new Date('2026-10-01T00:00:00Z');
const media = (day: string, values: Partial<{ impressions: number | null; reach: number | null; likeCount: number | null; commentsCount: number | null; saved: number | null }>) => ({
  id: day, caption: `post ${day}`, permalink: null, timestamp: new Date(`${day}T12:00:00Z`),
  impressions: null, reach: null, likeCount: null, commentsCount: null, saved: null, ...values,
});

describe('channel figures', () => {
  it('sums known values and keeps null when none is known', () => {
    expect(sumKnown([null, undefined])).toBeNull();
    expect(sumKnown([1, null, 2])).toBe(3);
    expect(rate(5, 0)).toBeNull();
    expect(rate(5, 200)).toBe(2.5);
  });

  it('reads an Instagram account inside the window, reach only from the 28-day series', () => {
    const items = [
      media('2026-09-10', { impressions: 100, likeCount: 4, commentsCount: 1 }),
      media('2026-09-20', { impressions: null, likeCount: 5 }),
      media('2026-08-20', { impressions: 999, likeCount: 99 }),
    ];
    const account = { id: 'a1', username: 'client_a', followersCount: 1200 };
    const daily = instagramChannel({ account, series: [{ metric: 'reach', period: 'day', breakdown: false, latest: 50 }], media: items, from, to });
    expect(daily).toMatchObject({ network: 'instagram', name: '@client_a', followers: 1200, posts: 2, impressions: 100, interactions: 10, reach: null, engagementRate: null });
    const monthly = instagramChannel({ account, series: [{ metric: 'reach', period: 'days_28', breakdown: false, latest: 400 }], media: items, from, to });
    expect(monthly.reach).toBe(400);
    expect(monthly.engagementRate).toBe(2.5);
    expect(instagramPosts(account, items, from, to)).toHaveLength(2);
  });

  it('groups other-network posts per channel without inventing reach or followers', () => {
    const posts = networkPosts([
      { id: 'p1', network: 'bluesky', channel: 'Client A', message: 'x', publishedAt: from, url: null, likes: 3, reposts: 1, replies: null, views: null },
      { id: 'p2', network: 'bluesky', channel: 'Client A', message: 'y', publishedAt: from, url: null, likes: null, reposts: null, replies: null, views: null },
      { id: 'p3', network: 'mastodon', channel: 'Client B', message: 'z', publishedAt: from, url: null, likes: null, reposts: null, replies: null, views: null },
    ]);
    const channels = networkChannels(posts);
    expect(channels).toHaveLength(2);
    expect(channels[0]).toMatchObject({ network: 'bluesky', posts: 2, interactions: 4, reach: null, followers: null, impressions: null });
    expect(channels[1]).toMatchObject({ network: 'mastodon', posts: 1, interactions: null });
  });

  it('totals add counts, never reach, and recompute the rate', () => {
    const base = { key: 'k', network: 'instagram', name: 'n', impressions: null };
    const total = totalChannels([
      { ...base, followers: 100, posts: 2, reach: 300, interactions: 10, engagementRate: 3.3 },
      { ...base, followers: null, posts: 1, reach: 200, interactions: 5, engagementRate: 2.5 },
    ]);
    expect(total).toEqual({ followers: 100, posts: 3, reach: null, impressions: null, interactions: 15, engagementRate: null });
    const single = totalChannels([{ ...base, followers: 1, posts: 1, reach: 200, interactions: 5, engagementRate: 2.5 }]);
    expect(single.engagementRate).toBe(2.5);
  });
});
