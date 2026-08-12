import { describe, expect, it } from 'vitest';

import { countCharacters } from '../src/lib/text';

/**
 * What counts as a character.
 *
 * `String.length` counts UTF-16 code units, which is neither what a person
 * means nor what Meta's limits are measured in. It matters at Instagram's
 * caption limit, which is two thousand two hundred and genuinely reachable —
 * long captions full of hashtags and emoji are the normal shape of an
 * Instagram post, not an edge case somebody contrived.
 */
describe('counting characters', () => {
  it('agrees with `length` for plain text, which is most text', () => {
    expect(countCharacters('Sourdough out at seven')).toBe(22);
  });

  it('counts an emoji as one thing, not two', () => {
    expect('🥖'.length).toBe(2);
    expect(countCharacters('🥖')).toBe(1);
  });

  it('counts a flag as its parts, which is what Meta almost certainly does', () => {
    // Two regional indicators. Grapheme clustering would call this one, and
    // would then under-count against a limit somebody else is enforcing.
    expect(countCharacters('🇫🇷')).toBe(2);
  });

  it('counts an accent typed as a combining mark separately', () => {
    // "é" as e + U+0301 rather than the single precomposed character. Both
    // look identical on screen and neither is wrong to type.
    expect(countCharacters('é')).toBe(2);
    expect(countCharacters('é')).toBe(1);
  });

  it('handles the empty string without special-casing', () => {
    expect(countCharacters('')).toBe(0);
  });

  it('is what makes a caption at the limit acceptable', () => {
    // Exactly 2,200 characters, fifty of them emoji. `length` says 2,250 and
    // the caption is refused for being fifty over a limit it is exactly on.
    const caption = 'x'.repeat(2_150) + '🎉'.repeat(50);

    expect(caption.length).toBe(2_250);
    expect(countCharacters(caption)).toBe(2_200);
  });
});

describe('the Instagram caption limit', () => {
  it('is the same number in the composer as in the publisher', async () => {
    const { IG_CAPTION_LIMIT } = await import('../src/lib/constants');
    const { IG_LIMITS } = await import('../src/lib/facebook/instagram-publish');

    // The publisher owns the rule; the composer repeats the number so it can
    // warn while somebody is still writing. Two copies of a number is a
    // liability unless something keeps them in step.
    expect(IG_CAPTION_LIMIT).toBe(IG_LIMITS.captionLength);
  });
});
