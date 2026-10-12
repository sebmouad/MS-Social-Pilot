import { describe, expect, it } from 'vitest';

import { mentionedIn, mentionMatches, mentionQuery } from '../src/lib/mentions';

const members = [
  { id: 'u1', name: 'Alex Morgan' },
  { id: 'u2', name: 'Sam Lee' },
  { id: 'u3', name: 'Samira Khan' },
];

describe('mentions', () => {
  it('reads the name being typed after an @ at the caret', () => {
    expect(mentionQuery('Hello @Sa')).toBe('Sa');
    expect(mentionQuery('@')).toBe('');
    expect(mentionQuery('Hello @Alex Mo')).toBe('Alex Mo');
    expect(mentionQuery('mail me at a@b')).toBeNull();
    expect(mentionQuery('Hello there')).toBeNull();
  });

  it('suggests members by the start of their name or of any word in it', () => {
    expect(mentionMatches(members, 'sam').map((member) => member.id)).toEqual(['u2', 'u3']);
    expect(mentionMatches(members, 'morg').map((member) => member.id)).toEqual(['u1']);
    expect(mentionMatches(members, '')).toHaveLength(3);
  });

  it('keeps only the picked members whose @Name is still in the text', () => {
    expect(mentionedIn('@Sam Lee please check', members, ['u2', 'u1'])).toEqual(['u2']);
    expect(mentionedIn('Sam Lee please check', members, ['u2'])).toEqual([]);
    expect(mentionedIn('@Sam Lee', members, ['someone-else'])).toEqual([]);
  });
});
