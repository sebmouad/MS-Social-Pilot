import { describe, expect, it } from 'vitest';

import { PRICE_OVERRIDE_PATTERN, costUsd, priceFor } from '@/lib/ai-prices';

/**
 * Model prices. The rule that matters most: a model nobody priced is "unknown",
 * never free and never priced as a sibling model, because a budget that counts
 * a new model as $0 does not stop anything.
 */
describe('model prices', () => {
  it('finds a listed model, and a dated snapshot or alias of it', () => {
    expect(priceFor('claude-sonnet-4-5')).toEqual({ input: 3, output: 15 });
    expect(priceFor('claude-sonnet-4-5-20250929')).toEqual({ input: 3, output: 15 });
    expect(priceFor('claude-opus-4-0')).toEqual({ input: 15, output: 75 });
    expect(priceFor('gpt-4o-2024-08-06')).toEqual({ input: 2.5, output: 10 });
    expect(priceFor('gemini-2.5-flash')).toEqual({ input: 0.3, output: 2.5 });
  });

  it('a snapshot with its own price keeps it', () => {
    expect(priceFor('gpt-4o-2024-05-13')).toEqual({ input: 5, output: 15 });
  });

  it('an unlisted model is unknown, not priced as its family', () => {
    expect(priceFor('claude-opus-5-7')).toBeNull();
    expect(priceFor('gpt-9')).toBeNull();
    expect(priceFor('gemini-2.5-flash-preview-09-2025')).toBeNull();
  });

  it('an override adds a price and wins over the table', () => {
    expect(priceFor('my-model', ['my-model=2/10'])).toEqual({ input: 2, output: 10 });
    expect(priceFor('gpt-4o', ['gpt-4o=1.5/6'])).toEqual({ input: 1.5, output: 6 });
    expect(priceFor('my-model', ['not a price'])).toBeNull();
  });

  it('a price Google raises on a known date changes on that date', () => {
    expect(priceFor('gemini-3.8-flash', [], new Date('2026-12-31T23:00:00Z'))).toEqual({ input: 0.75, output: 3.75 });
    expect(priceFor('gemini-3.8-flash', [], new Date('2027-01-01T00:00:00Z'))).toEqual({ input: 1.5, output: 7.5 });
  });

  it('costs input and output tokens per million', () => {
    expect(costUsd({ input: 3, output: 15 }, 1_000_000, 0)).toBe(3);
    expect(costUsd({ input: 3, output: 15 }, 120, 45)).toBeCloseTo(0.001035, 9);
  });

  it('accepts only model=input/output overrides', () => {
    expect(PRICE_OVERRIDE_PATTERN.test('my-model=2/10')).toBe(true);
    expect(PRICE_OVERRIDE_PATTERN.test('models/gemini-x=0.1/0.4')).toBe(false);
    expect(PRICE_OVERRIDE_PATTERN.test('my-model=$2/$10')).toBe(false);
    expect(PRICE_OVERRIDE_PATTERN.test('my-model=2')).toBe(false);
  });
});
