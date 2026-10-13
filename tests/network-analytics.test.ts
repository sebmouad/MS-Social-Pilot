import { describe, expect, it } from 'vitest';

import { totalsByNetwork, type NetworkPostRow } from '../src/lib/network-analytics';

const row = (network: NetworkPostRow['network'], likes: number | null): NetworkPostRow => ({
  id: `${network}-${likes}`,
  network,
  channel: 'Client A',
  message: 'Product launch',
  publishedAt: new Date('2026-10-01T10:00:00Z'),
  url: null,
  likes,
  reposts: likes === null ? null : 1,
  replies: likes === null ? null : 0,
  views: null,
});

describe('totals per network', () => {
  it('adds the counters, and keeps a network with none read as null rather than zero', () => {
    expect(totalsByNetwork([row('bluesky', 4), row('bluesky', 2), row('linkedin', null)])).toEqual([
      { network: 'bluesky', posts: 2, likes: 6, reposts: 2, replies: 0, views: null },
      { network: 'linkedin', posts: 1, likes: null, reposts: null, replies: null, views: null },
    ]);
  });
});
