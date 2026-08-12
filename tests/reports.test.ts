import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import en from '../messages/en.json';
import fr from '../messages/fr.json';

import {
  csvFilename,
  parseReportRange,
  reportToCsv,
  spreadClicks,
  type Report,
} from '../src/lib/reports';

function report(overrides: Partial<Report> = {}): Report {
  return {
    from: new Date('2026-08-01T00:00:00Z'),
    to: new Date('2026-08-31T23:59:59Z'),
    postsPublished: 2,
    totals: { impressions: 100, reach: 80, engagement: 12, linkClicks: 5 },
    destinations: [
      {
        targetId: 't1',
        name: 'Acme Page',
        type: 'page',
        posts: 2,
        impressions: 100,
        reach: 80,
        reactions: 8,
        comments: 3,
        shares: 1,
        clicks: 5,
      },
    ],
    topPosts: [],
    ...overrides,
  };
}

describe('reportToCsv', () => {
  it('emits a header row and one row per destination', () => {
    const lines = reportToCsv(report()).trim().split('\n');
    expect(lines[0]).toBe(
      'destination,type,posts,impressions,reach,reactions,comments,shares,link_clicks',
    );
    expect(lines[1]).toBe('Acme Page,page,2,100,80,8,3,1,5');
  });

  it('quotes a name containing a comma', () => {
    const csv = reportToCsv(
      report({
        destinations: [{ ...report().destinations[0]!, name: 'Acme, Inc.' }],
      }),
    );
    expect(csv).toContain('"Acme, Inc."');
  });

  it('escapes embedded quotes by doubling them, per RFC 4180', () => {
    const csv = reportToCsv(
      report({
        destinations: [{ ...report().destinations[0]!, name: 'The "Big" Page' }],
      }),
    );
    expect(csv).toContain('"The ""Big"" Page"');
  });

  it('quotes a name containing a newline', () => {
    const csv = reportToCsv(
      report({ destinations: [{ ...report().destinations[0]!, name: 'Line one\nLine two' }] }),
    );
    expect(csv).toContain('"Line one\nLine two"');
  });

  it('produces only a header when there is no data', () => {
    const csv = reportToCsv(report({ destinations: [] }));
    expect(csv.trim().split('\n')).toHaveLength(1);
  });

  it('ends with a newline, as a well-formed CSV should', () => {
    expect(reportToCsv(report()).endsWith('\n')).toBe(true);
  });
});

/**
 * The per-destination click column has to add up to the total beside it. A
 * client reads this report; a table that sums to something other than the
 * headline number costs more credibility than the rounding ever bought.
 */
describe('spreadClicks', () => {
  it('adds up to the total, whatever the split', () => {
    for (let total = 0; total <= 40; total += 1) {
      for (let parts = 1; parts <= 7; parts += 1) {
        const shares = spreadClicks(total, parts);
        expect(shares, `${total} over ${parts}`).toHaveLength(parts);
        expect(
          shares.reduce((sum, share) => sum + share, 0),
          `${total} over ${parts}`,
        ).toBe(total);
      }
    }
  });

  it('never invents clicks that did not happen', () => {
    // Rounding each equal share on its own gave three each here, claiming six.
    expect(spreadClicks(5, 2)).toEqual([3, 2]);
  });

  it('never loses one either', () => {
    // And three each here, losing the tenth.
    expect(spreadClicks(10, 3)).toEqual([4, 3, 3]);
  });

  it('splits evenly when it divides', () => {
    expect(spreadClicks(9, 3)).toEqual([3, 3, 3]);
    expect(spreadClicks(0, 3)).toEqual([0, 0, 0]);
  });

  it('has nothing to split when a post reached nowhere', () => {
    expect(spreadClicks(7, 0)).toEqual([]);
  });

  it('keeps the shares as close together as they can be', () => {
    const shares = spreadClicks(11, 4);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });
});

/**
 * The summary card and the per-destination table count different things. The
 * card counts posts; the column counts the times each destination was posted
 * to, so one post to three Pages is 1 in the card and 1+1+1 in the column.
 * Both are useful, and both were labelled "Posts published" — which made the
 * table look like broken arithmetic to the client reading it.
 */
describe('the report labels', () => {
  const page = readFileSync('src/app/(app)/reports/page.tsx', 'utf8');
  const table = page.slice(page.indexOf('<thead>'), page.indexOf('</thead>'));

  it('does not head the destination column with the summary figure', () => {
    expect(table).toContain("t('postsSent')");
    expect(table).not.toContain("t('postsPublished')");
  });

  it('says something different in each language, not just under a different key', () => {
    // A second key translated to the same words puts the reader back where
    // they started.
    for (const [language, messages] of [['en', en], ['fr', fr]] as const) {
      const reports = messages.reports as Record<string, string>;
      expect(reports.postsSent, language).toBeTruthy();
      expect(reports.postsSent, language).not.toBe(reports.postsPublished);
    }
  });

  it('heads the name column with a noun rather than the section title', () => {
    // "By destination" titles the section; as a column header over a list of
    // Page names it reads like a leftover.
    expect(table).toContain("t('destination')");
  });
});

describe('parseReportRange', () => {
  const now = new Date('2026-08-31T12:00:00Z');

  it('defaults to the last thirty days', () => {
    const range = parseReportRange({ from: null, to: null, now });
    expect(range.ok).toBe(true);
    if (!range.ok) return;
    expect(range.to.toISOString()).toBe(now.toISOString());
    expect(range.from.toISOString()).toBe('2026-08-01T12:00:00.000Z');
  });

  it('refuses a range that runs backwards', () => {
    const range = parseReportRange({ from: '2026-08-31', to: '2026-08-01', now });

    // Running it returns nothing, and a report of nothing looks exactly like a
    // month in which the client's pages were silent — so a typo in the dates
    // reads as bad news about their account.
    expect(range.ok).toBe(false);
    if (range.ok) return;
    expect(range.message).toMatch(/after its end/i);
  });

  it('accepts a range of a single instant', () => {
    const range = parseReportRange({ from: '2026-08-01', to: '2026-08-01', now });
    expect(range.ok).toBe(true);
  });

  it('refuses a date it cannot read', () => {
    expect(parseReportRange({ from: 'last tuesday', to: null, now }).ok).toBe(false);
    expect(parseReportRange({ from: null, to: 'soon', now }).ok).toBe(false);
  });

  it('keeps an explicit start with a defaulted end', () => {
    const range = parseReportRange({ from: '2026-08-10', to: null, now });
    expect(range.ok).toBe(true);
    if (!range.ok) return;
    expect(range.from.toISOString()).toBe('2026-08-10T00:00:00.000Z');
    expect(range.to.toISOString()).toBe(now.toISOString());
  });
});

describe('csvFilename', () => {
  const range = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-08-31T00:00:00Z') };

  it('names the file after the whole period', () => {
    expect(csvFilename('report', 'acme', range)).toBe('report-acme-2026-06-01_2026-08-31.csv');
  });

  it('tells two ranges ending on the same day apart', () => {
    const shorter = { from: new Date('2026-08-01T00:00:00Z'), to: range.to };

    // A client sent last quarter and last month otherwise receives two files
    // with the same name, and the browser renames one without saying so.
    expect(csvFilename('report', 'acme', shorter)).not.toBe(csvFilename('report', 'acme', range));
  });

  it('keeps the export kind in front', () => {
    expect(csvFilename('posts', 'acme', range)).toMatch(/^posts-/);
  });
});
