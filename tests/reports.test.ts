import { describe, expect, it } from 'vitest';

import { reportToCsv, type Report } from '../src/lib/reports';

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
