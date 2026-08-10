import { describe, expect, it } from 'vitest';

import { parseCsv, parseCsvWithHeader } from '../src/lib/csv';

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
