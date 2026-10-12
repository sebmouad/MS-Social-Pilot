import { describe, expect, it } from 'vitest';

import { changedFields, wordDiff, type PostVersionView } from '../src/lib/post-version-diff';

const base: PostVersionView = {
  id: 'v1',
  createdAt: '2026-10-01T09:00:00.000Z',
  authorName: 'Writer',
  message: 'Product launch on Friday',
  firstComment: null,
  link: null,
  media: [],
  format: 'post',
  targetIds: ['a', 'b'],
  labelIds: [],
  scheduledAtLocal: '2026-10-10T09:00',
};

describe('post version diff', () => {
  it('names what changed, ignoring the order of Pages and labels', () => {
    expect(changedFields(base, { ...base, targetIds: ['b', 'a'] })).toEqual([]);
    expect(
      changedFields(base, { ...base, message: 'Product launch on Monday', targetIds: ['a'], scheduledAtLocal: null, firstComment: '' }),
    ).toEqual(['text', 'pages', 'time']);
    expect(changedFields(base, { ...base, media: [{ id: 'm1' }], labelIds: ['l1'], link: 'https://example.com' })).toEqual([
      'link',
      'media',
      'labels',
    ]);
  });

  it('marks removed and added words, and each side joins back to its text', () => {
    const before = 'Product launch on Friday at noon';
    const after = 'Product launch on Monday at noon!';
    const parts = wordDiff(before, after);
    expect(parts.filter((part) => part.kind !== 'added').map((part) => part.text).join('')).toBe(before);
    expect(parts.filter((part) => part.kind !== 'removed').map((part) => part.text).join('')).toBe(after);
    expect(parts.filter((part) => part.kind === 'removed').map((part) => part.text.trim())).toEqual(['Friday', 'noon']);
    expect(parts.filter((part) => part.kind === 'added').map((part) => part.text.trim())).toEqual(['Monday', 'noon!']);
  });

  it('handles empty sides', () => {
    expect(wordDiff('', 'New text')).toEqual([{ kind: 'added', text: 'New text' }]);
    expect(wordDiff('Old', '')).toEqual([{ kind: 'removed', text: 'Old' }]);
    expect(wordDiff('', '')).toEqual([]);
  });
});
