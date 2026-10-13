import { expect, it } from 'vitest';
import { updateConfigDraft } from '../src/lib/config-draft';
it('removes reverted boolean and numeric edits from dirty payload', () => {
  expect(updateConfigDraft({ on: false }, 'on', true, true)).toEqual({});
  expect(updateConfigDraft({ count: '3' }, 'count', '2', 2)).toEqual({});
  expect(updateConfigDraft({}, 'count', '3', 2)).toEqual({ count: '3' });
});
it('blank secret keeps existing credential without retaining a secret edit', () => {
  expect(updateConfigDraft({ key: 'new value' }, 'key', '', undefined, true)).toEqual({});
});
