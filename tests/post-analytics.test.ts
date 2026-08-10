import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.SESSION_SECRET = 'test';
  process.env.FACEBOOK_APP_ID = '1';
  process.env.FACEBOOK_APP_SECRET = 'secret';
});

const { sumInsights, mergeBreakdowns } = await import('../src/lib/facebook/insights');

const empty = {
  impressions: null,
  reach: null,
  engagedUsers: null,
  reactions: null,
  comments: null,
  shares: null,
  clicks: null,
};

describe('sumInsights', () => {
  it('adds the flat numbers', () => {
    const total = sumInsights([
      { ...empty, impressions: 100, reactions: 5 },
      { ...empty, impressions: 250, reactions: 3 },
    ]);

    expect(total.impressions).toBe(350);
    expect(total.reactions).toBe(8);
  });

  it('adds the extended fields too', () => {
    const total = sumInsights([
      { ...empty, impressionsOrganic: 80, impressionsPaid: 20, videoViews: 5 },
      { ...empty, impressionsOrganic: 40, impressionsPaid: 10, videoViews: 7 },
    ]);

    expect(total.impressionsOrganic).toBe(120);
    expect(total.impressionsPaid).toBe(30);
    expect(total.videoViews).toBe(12);
  });

  it('ignores nulls rather than treating them as zero-and-present', () => {
    const total = sumInsights([{ ...empty, impressions: 10 }, { ...empty, impressions: null }]);
    expect(total.impressions).toBe(10);
  });

  it('skips entries that are null altogether', () => {
    expect(sumInsights([null, { ...empty, clicks: 4 }, null]).clicks).toBe(4);
  });

  it('never tries to add a breakdown map', () => {
    // Summing two reaction maps is a different operation; doing it here would
    // produce NaN or a string.
    const total = sumInsights([
      { ...empty, impressions: 5, reactionsByType: { like: 3 } },
      { ...empty, impressions: 5, reactionsByType: { like: 2 } },
    ]);

    expect(total.impressions).toBe(10);
    expect(total.reactionsByType).toBeUndefined();
  });

  it('returns an all-null shape for no input', () => {
    expect(sumInsights([]).impressions).toBeNull();
  });
});

describe('mergeBreakdowns', () => {
  it('adds maps key by key', () => {
    expect(mergeBreakdowns([{ like: 3, love: 1 }, { like: 2, wow: 4 }])).toEqual({
      like: 5,
      love: 1,
      wow: 4,
    });
  });

  it('skips missing maps', () => {
    expect(mergeBreakdowns([undefined, { like: 1 }, null])).toEqual({ like: 1 });
  });

  it('ignores non-numeric values', () => {
    const dirty = { like: 2, bogus: 'x' } as unknown as Record<string, number>;
    expect(mergeBreakdowns([dirty])).toEqual({ like: 2 });
  });

  it('returns an empty map for no input', () => {
    expect(mergeBreakdowns([])).toEqual({});
  });
});
