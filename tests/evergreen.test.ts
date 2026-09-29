import { describe, expect, it } from 'vitest';

import { nextRecycleAt, variantForRun } from '../src/lib/evergreen';

describe('variantForRun', () => {
  const original = 'Original wording';
  const variants = ['Second wording', 'Third wording'];

  it('uses the original on the first run', () => {
    expect(variantForRun(original, variants, 0)).toBe(original);
  });

  it('rotates through the variants', () => {
    // Facebook rejects identical repeated content (error 506), which is the
    // whole reason variants exist.
    expect(variantForRun(original, variants, 1)).toBe('Second wording');
    expect(variantForRun(original, variants, 2)).toBe('Third wording');
  });

  it('wraps around once the variants are exhausted', () => {
    expect(variantForRun(original, variants, 3)).toBe(original);
    expect(variantForRun(original, variants, 4)).toBe('Second wording');
  });

  it('repeats the original when there are no variants', () => {
    // The UI warns about this; the code still has to do something sane.
    expect(variantForRun(original, [], 1)).toBe(original);
    expect(variantForRun(original, [], 7)).toBe(original);
  });

  it('ignores blank variants', () => {
    expect(variantForRun(original, ['', '   ', 'Real'], 1)).toBe('Real');
  });
});

describe('nextRecycleAt', () => {
  const from = new Date('2026-09-01T09:00:00Z');

  it('adds the interval', () => {
    expect(nextRecycleAt({ everyDays: 30, limit: null, count: 1, from })?.toISOString()).toBe(
      '2026-10-01T09:00:00.000Z',
    );
  });

  it('stops once the repeat limit is reached', () => {
    expect(nextRecycleAt({ everyDays: 30, limit: 3, count: 3, from })).toBeNull();
    expect(nextRecycleAt({ everyDays: 30, limit: 3, count: 4, from })).toBeNull();
  });

  it('continues while below the limit', () => {
    expect(nextRecycleAt({ everyDays: 7, limit: 3, count: 2, from })).not.toBeNull();
  });

  it('runs indefinitely when there is no limit', () => {
    expect(nextRecycleAt({ everyDays: 7, limit: null, count: 500, from })).not.toBeNull();
  });

  it('skips ahead past now after downtime, keeping the original cadence', () => {
    // A daily post and a worker that was down for a week: one interval from the
    // stored date is still in the past, so every cycle made another copy.
    const now = new Date('2026-09-08T12:00:00Z');
    expect(
      nextRecycleAt({ everyDays: 1, limit: null, count: 1, from, now })?.toISOString(),
    ).toBe('2026-09-09T09:00:00.000Z');
  });

  it('is strictly after now when now lands exactly on the cadence', () => {
    const now = new Date('2026-09-03T09:00:00Z');
    expect(
      nextRecycleAt({ everyDays: 1, limit: null, count: 1, from, now })?.toISOString(),
    ).toBe('2026-09-04T09:00:00.000Z');
  });

  it('adds one interval when the worker is on time', () => {
    const now = new Date('2026-09-01T09:05:00Z');
    expect(
      nextRecycleAt({ everyDays: 30, limit: null, count: 1, from, now })?.toISOString(),
    ).toBe('2026-10-01T09:00:00.000Z');
  });

  it('returns null for a missing or nonsensical interval', () => {
    expect(nextRecycleAt({ everyDays: null, limit: null, count: 0, from })).toBeNull();
    expect(nextRecycleAt({ everyDays: 0, limit: null, count: 0, from })).toBeNull();
  });
});
