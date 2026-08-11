import { describe, expect, it } from 'vitest';

import { SERIES_COLORS, compact, duration, niceTicks, seriesColor } from '../src/lib/viz';

/**
 * The chart palette and its number formatting.
 *
 * The ordering assertion is the load-bearing one: the categorical order was
 * validated for colour-vision separation as a *sequence*, so reordering it or
 * generating a ninth hue silently breaks a guarantee no reviewer will notice by
 * looking.
 */

describe('seriesColor', () => {
  it('assigns hues in the validated order', () => {
    expect(seriesColor(0)).toBe(SERIES_COLORS[0]);
    expect(seriesColor(3)).toBe(SERIES_COLORS[3]);
  });

  it('follows the entity rather than its rank', () => {
    // Filtering a chart down to two series must not repaint them: the caller
    // passes the entity's own index, and the same index always returns the
    // same hue.
    expect(seriesColor(5)).toBe(seriesColor(5));
    expect(seriesColor(1)).not.toBe(seriesColor(2));
  });

  it('offers exactly eight slots', () => {
    expect(SERIES_COLORS).toHaveLength(8);
    expect(new Set(SERIES_COLORS).size).toBe(8);
  });
});

describe('compact', () => {
  it('leaves small numbers alone', () => {
    expect(compact(0)).toBe('0');
    expect(compact(9999)).toBe('9,999');
  });

  it('shortens ten thousand and above', () => {
    expect(compact(12_900)).toBe('12.9K');
    expect(compact(1_200_000)).toBe('1.2M');
  });

  it('drops a trailing zero rather than printing 12.0M', () => {
    expect(compact(12_000_000)).toBe('12M');
  });

  it('keeps the sign', () => {
    expect(compact(-15_000)).toBe('-15K');
  });
});

describe('niceTicks', () => {
  it('lands on round numbers a reader can hold in their head', () => {
    expect(niceTicks(3_187)).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it('scales to small ranges', () => {
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
  });

  it('never stops below the maximum', () => {
    // The last tick is the top of the plot: a top below the peak would draw
    // that peak outside the plot area.
    for (const max of [1, 7, 500, 3187, 86_600, 1_204_000]) {
      expect(niceTicks(max).at(-1), String(max)).toBeGreaterThanOrEqual(max);
    }
  });

  it('always starts at zero, so bar length stays proportional to value', () => {
    expect(niceTicks(500)[0]).toBe(0);
  });

  it('returns a single tick rather than dividing by zero', () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(Number.NaN)).toEqual([0]);
  });
});

describe('duration', () => {
  it('reads Graph milliseconds as time', () => {
    expect(duration(45_000)).toBe('45s');
    expect(duration(150_000)).toBe('2m 30s');
    expect(duration(7_500_000)).toBe('2h 5m');
  });

  it('has a dash for nothing', () => {
    expect(duration(null)).toBe('—');
  });
});
