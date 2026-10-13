import { describe, expect, it } from 'vitest';

import { MIN_HISTORY, hourBucket, lengthBucket, predictEngagement, type PastPost } from '../src/lib/engagement-prediction';

/** Engagement prediction: a verdict against the Page's own history, never a number. */

const post = (overrides: Partial<PastPost>): PastPost => ({ format: 'photo', length: 120, hour: 10, weekday: 2, interactions: 50, ...overrides });

describe('engagement prediction', () => {
  it('says nothing without enough history', () => {
    const history = Array.from({ length: MIN_HISTORY - 1 }, () => post({}));
    expect(predictEngagement(history, { format: 'photo', length: 100, hour: 10, weekday: 2 })).toEqual({ outlook: 'unknown', basis: MIN_HISTORY - 1, reasons: [] });
  });

  it('calls a format that does better than usual above, with the reason first', () => {
    const history = [
      ...Array.from({ length: 6 }, () => post({ format: 'video', interactions: 200 })),
      ...Array.from({ length: 10 }, () => post({ format: 'photo', interactions: 50 })),
    ];
    const prediction = predictEngagement(history, { format: 'video', length: 120, hour: null, weekday: null });
    expect(prediction.outlook).toBe('above');
    expect(prediction.reasons[0]).toMatchObject({ factor: 'format', value: 'video', ratio: 4, posts: 6 });
  });

  it('calls a weak time slot below and skips factors with too few posts', () => {
    const history = [
      ...Array.from({ length: 4 }, () => post({ hour: 23, interactions: 5 })),
      ...Array.from({ length: 10 }, () => post({ hour: 10, interactions: 60 })),
    ];
    const prediction = predictEngagement(history, { format: 'link', length: 120, hour: 22, weekday: 2 });
    expect(prediction.outlook).toBe('below');
    expect(prediction.reasons.map((reason) => reason.factor)).not.toContain('format');
    expect(prediction.reasons[0]).toMatchObject({ factor: 'time', value: 'evening' });
  });

  it('buckets length and hour', () => {
    expect([lengthBucket(10), lengthBucket(200), lengthBucket(900)]).toEqual(['short', 'medium', 'long']);
    expect([hourBucket(3), hourBucket(9), hourBucket(15), hourBucket(21)]).toEqual(['night', 'morning', 'afternoon', 'evening']);
  });
});
