import { describe, expect, it } from 'vitest';
import { parseFirstCommentDelay } from '../src/modules/publishing/first-comment-delay';

describe('first-comment delay input', () => {
  it('defaults omitted or blank delay to zero and accepts bounded whole minutes', () => {
    expect(parseFirstCommentDelay(undefined, 30)).toBe(0);
    expect(parseFirstCommentDelay('', 30)).toBe(0);
    expect(parseFirstCommentDelay('0', 30)).toBe(0);
    expect(parseFirstCommentDelay('30', 30)).toBe(30);
    expect(parseFirstCommentDelay(15, 30)).toBe(15);
  });

  it.each([-1, 31, 1.2, '1.2', ' 2', '2x', Number.MAX_SAFE_INTEGER + 1, true])('rejects invalid delay %s', value => {
    expect(() => parseFirstCommentDelay(value, 30)).toThrow();
  });

  it('refuses a missing or invalid operational ceiling', () => {
    expect(() => parseFirstCommentDelay(1, Number.NaN)).toThrow(/limit is unavailable/i);
  });
});
