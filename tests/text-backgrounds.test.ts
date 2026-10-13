import { describe, expect, it } from 'vitest';

import { createPostSchema } from '../src/lib/validation';
import { isTextBackground, TEXT_BACKGROUNDS } from '../src/lib/text-backgrounds';

const base = { message: 'Hello', targetIds: ['t1'], saveAsDraft: true };

describe('text backgrounds', () => {
  it('accepts a listed preset or none, and refuses anything else', () => {
    expect(createPostSchema.parse({ ...base, textBackground: TEXT_BACKGROUNDS[0]!.id }).textBackground).toBe(TEXT_BACKGROUNDS[0]!.id);
    expect(createPostSchema.parse({ ...base, textBackground: '' }).textBackground).toBeNull();
    expect(createPostSchema.safeParse({ ...base, textBackground: '12345' }).success).toBe(false);
    expect(isTextBackground('12345')).toBe(false);
  });
});
