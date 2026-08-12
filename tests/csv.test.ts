import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ACTIVITY_ACTIONS } from '../src/lib/activity';

import { bulkCsvTemplate, csvCell, parseCsv, parseCsvWithHeader, toCsv } from '../src/lib/csv';
import { bulkRowSchema, bulkUploadSchema } from '../src/lib/validation';
import { localInputToUtc } from '../src/lib/time';

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

describe('parseCsv with a quote that is never closed', () => {
  it('refuses the file rather than swallowing the rest of it', () => {
    // Without this the remaining rows do not fail loudly, they stop existing:
    // the uploader is told their 200-row campaign scheduled one post.
    expect(() => parseCsv('message,link\n"Hello,https://example.com/a\nSecond,https://example.com/b')).toThrow(
      /never closed/i,
    );
  });

  it('points at the line the quote opened on', () => {
    const csv = ['message', 'Fine', 'Also fine', '"Broken from here'].join('\n');
    expect(() => parseCsv(csv)).toThrow(/line 4/);
  });

  it('counts newlines inside a quoted field when reporting the line', () => {
    const csv = ['message', '"line one\nline two"', '"and this one never closes'].join('\n');
    expect(() => parseCsv(csv)).toThrow(/line 4/);
  });

  it('is happy with a quote that is closed', () => {
    expect(parseCsv('message\n"Hello, world"')).toEqual([['message'], ['Hello, world']]);
  });
});

describe('parseCsvWithHeader', () => {
  it('keys rows by normalised header name', () => {
    const { rows } = parseCsvWithHeader('Message,Scheduled At\nHello,2026-09-01 09:00');
    expect(rows).toEqual([{ message: 'Hello', scheduled_at: '2026-09-01 09:00' }]);
  });

  it('trims whitespace around values', () => {
    expect(parseCsvWithHeader('message\n  padded  ').rows[0]).toEqual({ message: 'padded' });
  });

  it('fills missing trailing columns with empty strings', () => {
    const { rows, problems } = parseCsvWithHeader('message,link,scheduled_at\nHello');
    expect(rows[0]).toEqual({ message: 'Hello', link: '', scheduled_at: '' });
    // Hand-written files leave trailing commas off, and a blank cell already
    // means something useful here, so this is not worth complaining about.
    expect(problems).toEqual([]);
  });

  it('reports a row with more values than the header', () => {
    // The classic mistake: a comma inside a message nobody quoted. Everything
    // after it has shifted, and the extra value was about to be dropped.
    const { problems } = parseCsvWithHeader(
      'message,link\nHello, world,https://example.com/a',
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.line).toBe(2);
    expect(problems[0]?.message).toMatch(/quotes/);
  });

  it('counts lines from the header, so the number matches the file', () => {
    const { problems } = parseCsvWithHeader(
      ['message,link', 'Fine,https://example.com/a', 'Also fine,https://example.com/b', 'a,b,c'].join(
        '\n',
      ),
    );

    expect(problems.map((problem) => problem.line)).toEqual([4]);
  });

  it('says nothing about a properly quoted comma', () => {
    const { rows, problems } = parseCsvWithHeader(
      'message,link\n"Hello, world",https://example.com/a',
    );

    expect(problems).toEqual([]);
    expect(rows[0]?.message).toBe('Hello, world');
  });

  it('returns nothing for an empty document', () => {
    expect(parseCsvWithHeader('')).toEqual({ rows: [], problems: [] });
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

/**
 * The file people download to start from. Every rule the uploader enforces has
 * to accept it, or the product's own example is the first thing that fails.
 */
describe('bulkCsvTemplate', () => {
  const now = new Date('2026-08-11T12:00:00Z');

  it('parses without complaint', () => {
    const { rows, problems } = parseCsvWithHeader(bulkCsvTemplate(now));

    expect(problems).toEqual([]);
    expect(rows).toHaveLength(3);
  });

  it('passes the row rules it will be validated against', () => {
    const { rows } = parseCsvWithHeader(bulkCsvTemplate(now));

    for (const row of rows) {
      expect(bulkRowSchema.safeParse(row).success).toBe(true);
    }
  });

  it('shows the em dash and the comma-free example intact', () => {
    const { rows } = parseCsvWithHeader(bulkCsvTemplate(now));

    expect(rows[0]?.message).toBe('Spring sale starts today — 20% off everything.');
    expect(rows[2]?.link).toBe('');
    expect(rows[2]?.media_url).toBe('https://example.com/photo.jpg');
  });

  it('dates the examples in the future, whenever it is downloaded', () => {
    // Hardcoded dates turn the sample file into one that fails on every row
    // the moment they pass, for someone using the product for the first time.
    const { rows } = parseCsvWithHeader(bulkCsvTemplate(now));

    for (const row of rows) {
      const when = localInputToUtc(row.scheduled_at!.replace(' ', 'T'), 'UTC');
      expect(when.getTime()).toBeGreaterThan(now.getTime());
    }
  });

  it('is still in the future for a download a year from now', () => {
    const later = new Date('2027-12-31T23:00:00Z');
    const { rows } = parseCsvWithHeader(bulkCsvTemplate(later));

    for (const row of rows) {
      const when = localInputToUtc(row.scheduled_at!.replace(' ', 'T'), 'UTC');
      expect(when.getTime()).toBeGreaterThan(later.getTime());
    }
  });
});

/**
 * These files exist to be opened in Excel or Sheets, where a cell beginning
 * `=`, `+`, `-` or `@` is code rather than text — and the text is not ours.
 * Page names, comment bodies and reviewer names all come from Facebook.
 */
describe('csvCell', () => {
  it('quotes what RFC 4180 requires', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('has,comma')).toBe('"has,comma"');
    expect(csvCell('has"quote')).toBe('"has""quote"');
    expect(csvCell('has\nnewline')).toBe('"has\nnewline"');
  });

  it('defuses a cell a spreadsheet would run', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('=HYPERLINK("http://evil","Click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""Click"")"',
    );
  });

  it('is not fooled by leading whitespace, which Excel skips', () => {
    // No quotes: a tab is not a delimiter in a comma-separated file, so the
    // apostrophe alone is what this cell needs.
    expect(csvCell('\t=SUM(A1)')).toBe("'\t=SUM(A1)");
  });

  it('leaves numbers alone, including negative ones', () => {
    // The obvious over-correction: these are analytics exports, and turning
    // -5 into text breaks every sum in the sheet they exist to feed.
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(1234.5)).toBe('1234.5');
  });

  it('writes nothing for a missing value', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('assembles a document', () => {
    expect(toCsv([['name', 'posts'], ['Acme', 3]])).toBe('name,posts\nAcme,3\n');
  });
});

/**
 * What a CSV upload is allowed to ask for.
 *
 * The endpoint schedules; every row without a time goes into the queue. A
 * whole file published the instant it is uploaded is a different gesture
 * altogether, and an unrecoverable one: the rows go to Facebook one after
 * another inside a single request, so the connection times out long before the
 * last one, and the uploader is left with no record of which of five hundred
 * posts went out.
 */
describe('bulkUploadSchema', () => {
  const upload = (publishMode?: string) =>
    bulkUploadSchema.safeParse({
      csv: 'message\nHello',
      targetIds: ['t1'],
      ...(publishMode ? { publishMode } : {}),
    });

  it('schedules through the worker unless told otherwise', () => {
    const parsed = upload();
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.publishMode).toBe('worker');
  });

  it('allows handing the schedule to Facebook', () => {
    // Legitimate for a bulk file: the posts survive our worker being down.
    expect(upload('native').success).toBe(true);
  });

  it('refuses to publish a whole file on the spot', () => {
    const parsed = upload('immediate');
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/one at a time|schedule/i);
    }
  });
});

/**
 * What a bulk upload leaves behind for rejected rows.
 *
 * The per-row outcome lives only in the response. A large file can outlast a
 * request timeout, and the uploader can simply close the tab — either way a
 * campaign quietly twenty posts short looks exactly like one that worked. The
 * scheduled rows log `post.created` on their own; this is about the ones that
 * did not.
 */
describe('the bulk upload audit entry', () => {
  const route = readFileSync('src/app/api/posts/bulk/route.ts', 'utf8');

  it('records the upload as a whole', () => {
    expect(route).toContain("'post.bulkUploaded'");
  });

  it('names which rows were rejected, not just how many', () => {
    // A count alone tells somebody their file was short without telling them
    // where to look.
    const entry = route.slice(route.indexOf("'post.bulkUploaded'"), route.indexOf('return ok('));
    expect(entry).toMatch(/rejected:/);
    expect(entry).toMatch(/row: result\.row/);
    expect(entry).toMatch(/message: result\.message/);
  });

  it('bounds what it writes', () => {
    // A file where every row is wrong must not put a row's worth of JSON per
    // row into the audit trail.
    const entry = route.slice(route.indexOf("'post.bulkUploaded'"), route.indexOf('return ok('));
    expect(entry).toMatch(/slice\(0, \d+\)/);
  });

  it('is a known action, so the history screen has words for it', () => {
    expect(ACTIVITY_ACTIONS).toContain('post.bulkUploaded');
  });
});
