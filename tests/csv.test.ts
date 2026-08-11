import { describe, expect, it } from 'vitest';

import { parseCsv, parseCsvWithHeader } from '../src/lib/csv';
import { bulkRowSchema } from '../src/lib/validation';

describe('parseCsv', () => {
  it('parses simple rows', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    // The reason this parser exists: post copy is full of commas.
    expect(parseCsv('message,link\n"Hello, world, again",https://x.com')).toEqual([
      ['message', 'link'],
      ['Hello, world, again', 'https://x.com'],
    ]);
  });

  it('unescapes doubled quotes', () => {
    expect(parseCsv('a\n"She said ""hi"""')).toEqual([['a'], ['She said "hi"']]);
  });

  it('supports newlines inside quoted fields', () => {
    expect(parseCsv('a\n"line one\nline two"')).toEqual([['a'], ['line one\nline two']]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips a UTF-8 BOM from the first header', () => {
    expect(parseCsv('﻿message,link\nhi,')[0]).toEqual(['message', 'link']);
  });

  it('preserves empty trailing fields', () => {
    expect(parseCsv('a,b,c\n1,,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]);
  });

  it('ignores a trailing newline', () => {
    expect(parseCsv('a,b\n1,2\n')).toHaveLength(2);
  });
});

describe('parseCsvWithHeader', () => {
  it('keys rows by normalised header name', () => {
    const rows = parseCsvWithHeader('Message,Scheduled At\nHello,2026-09-01 09:00');
    expect(rows).toEqual([{ message: 'Hello', scheduled_at: '2026-09-01 09:00' }]);
  });

  it('trims whitespace around values', () => {
    expect(parseCsvWithHeader('message\n  padded  ')[0]).toEqual({ message: 'padded' });
  });

  it('fills missing trailing columns with empty strings', () => {
    const rows = parseCsvWithHeader('message,link,scheduled_at\nHello');
    expect(rows[0]).toEqual({ message: 'Hello', link: '', scheduled_at: '' });
  });

  it('returns nothing for an empty document', () => {
    expect(parseCsvWithHeader('')).toEqual([]);
  });
});

/**
 * A spreadsheet is not a form: nobody is watching the field as it is typed, and
 * a whole column can be wrong at once.
 */
describe('bulkRowSchema', () => {
  it('treats an empty cell as no link at all', () => {
    const parsed = bulkRowSchema.parse({ message: 'Hello', link: '', media_url: '   ' });
    expect(parsed.link).toBeUndefined();
    expect(parsed.media_url).toBeUndefined();
  });

  it('accepts an ordinary link', () => {
    const parsed = bulkRowSchema.parse({ message: 'Hello', link: 'https://example.com/a' });
    expect(parsed.link).toBe('https://example.com/a');
  });

  it('refuses a link that is not a URL', () => {
    // Reported as a bad row while the uploader is still looking at the upload,
    // rather than at publish time when Facebook refuses it.
    expect(bulkRowSchema.safeParse({ message: 'Hi', link: 'not a url' }).success).toBe(false);
  });

  it('refuses a scheme that is not http or https', () => {
    // The link is rendered as an href on the post list and the approvals
    // screen, so this one matters beyond whether Facebook would take it.
    for (const link of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd']) {
      expect(bulkRowSchema.safeParse({ message: 'Hi', link }).success).toBe(false);
    }
  });

  it('applies the same rule to the media column', () => {
    expect(bulkRowSchema.safeParse({ message: 'Hi', media_url: 'file:///etc/passwd' }).success).toBe(
      false,
    );
    expect(
      bulkRowSchema.safeParse({ message: 'Hi', media_url: 'https://cdn.example.com/a.jpg' }).success,
    ).toBe(true);
  });
});
