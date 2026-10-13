import { describe, expect, it } from 'vitest';

import { ratio, sumByCurrency, sumKnown, topBy, topSeries, totalProfiles } from '../src/lib/aggregate';

/** How figures add up across several profiles. */

describe('adding up profiles', () => {
  const rows = [
    { followers: 1000, netFollows: 20, posts: 10, interactions: 500, reach: 4000 },
    { followers: 3000, netFollows: -5, posts: 2, interactions: 100, reach: null },
    { followers: null, netFollows: null, posts: 0, interactions: 0, reach: 1000 },
  ];

  it('sums counts and the latest followers, skipping unknowns', () => {
    const total = totalProfiles(rows);
    expect(total).toMatchObject({ profiles: 3, followers: 4000, netFollows: 15, posts: 12, interactions: 600 });
  });

  it('recomputes per-post interactions from the sums rather than averaging averages', () => {
    // Averages of averages would say (50 + 50 + 0) / 3 ≈ 33.
    expect(totalProfiles(rows).interactionsPerPost).toBe(50);
  });

  it('treats reach as an upper bound and says how many profiles it covers', () => {
    expect(totalProfiles(rows)).toMatchObject({ reachUpTo: 5000, reachProfiles: 2 });
  });

  it('answers null rather than zero when nothing is known', () => {
    expect(sumKnown([null, undefined])).toBeNull();
    expect(totalProfiles([]).interactionsPerPost).toBeNull();
    expect(ratio(5, 0)).toBeNull();
    expect(ratio(1, 3, 100)).toBe(33.3);
  });
});

describe('money', () => {
  it('is grouped by currency and never added across two', () => {
    expect(
      sumByCurrency([
        { currency: 'eur', amount: 10 },
        { currency: 'USD', amount: 5 },
        { currency: 'EUR', amount: 2.5 },
        { currency: 'USD', amount: null },
      ]),
    ).toEqual([
      { currency: 'EUR', amount: 12.5 },
      { currency: 'USD', amount: 5 },
    ]);
  });
});

describe('rankings', () => {
  it('leave unknown figures out', () => {
    const ranked = topBy([{ v: 1 }, { v: null }, { v: 3 }], (row) => row.v, 5);
    expect(ranked.map((row) => row.v)).toEqual([3, 1]);
  });
});

describe('topSeries', () => {
  const line = (id: string, values: number[]) => ({ id, label: id, values });

  it('keeps every line when there are few', () => {
    expect(topSeries([line('a', [1]), line('b', [2])], 8, 'Others').map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('keeps the largest in their order and adds the rest up day by day', () => {
    const result = topSeries([line('a', [1, 1]), line('b', [5, 5]), line('c', [2, 0]), line('d', [3, 3])], 2, 'Others');
    expect(result.map((entry) => entry.id)).toEqual(['b', 'd', 'others']);
    expect(result[2]).toEqual({ id: 'others', label: 'Others', values: [3, 1] });
  });
});
