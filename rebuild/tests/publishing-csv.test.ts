import { describe, expect, it } from 'vitest';
import { parsePublishingCsv } from '../src/server/publishing/lifecycle';

describe('publishing CSV parser', () => {
  it('keeps commas, escaped quotes, and line breaks inside quoted cells', () => {
    expect(parsePublishingCsv('message,firstComment,targetIds\n"Hello, team","She said ""go""\nnow",page-1;page-2')).toEqual([
      ['message', 'firstComment', 'targetIds'],
      ['Hello, team', 'She said "go"\nnow', 'page-1;page-2'],
    ]);
  });

  it('ignores blank rows and rejects malformed quoted fields', () => {
    expect(parsePublishingCsv('message,firstComment,targetIds\n\nPost,,page-1\n')).toEqual([
      ['message', 'firstComment', 'targetIds'], ['Post', '', 'page-1'],
    ]);
    expect(() => parsePublishingCsv('message,firstComment,targetIds\n"unfinished,,page-1')).toThrow(/unclosed/);
    expect(() => parsePublishingCsv('message,firstComment,targetIds\n"quoted"oops,,page-1')).toThrow(/after a closing quote/);
  });
});
