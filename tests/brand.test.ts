import { describe, expect, it } from 'vitest';

import { voiceWithAvoid } from '../src/lib/brand';

describe('voiceWithAvoid', () => {
  it('adds the words to avoid to the voice, and says nothing when there is neither', () => {
    expect(voiceWithAvoid('Warm and short', 'cheap, deal')).toBe('Warm and short\nNever use these words or phrases: cheap, deal');
    expect(voiceWithAvoid(null, 'cheap')).toBe('Never use these words or phrases: cheap');
    expect(voiceWithAvoid('Warm', '  ')).toBe('Warm');
    expect(voiceWithAvoid(null, null)).toBeNull();
  });
});
