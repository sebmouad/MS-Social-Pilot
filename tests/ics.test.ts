import { describe, expect, it } from 'vitest';

import { buildCalendar, escapeText, foldLine } from '../src/lib/ics';

describe('ics', () => {
  it('escapes text values', () => {
    expect(escapeText('a, b; c\\d\nnext')).toBe('a\\, b\; c\\\\d\\nnext');
  });

  it('folds long lines at 75 octets without splitting a character', () => {
    const line = `SUMMARY:${'é'.repeat(60)}`;
    const folded = foldLine(line);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(parts.map((part, index) => (index === 0 ? part : part.slice(1))).join('')).toBe(line);
  });

  it('writes one event per post with UTC times', () => {
    const text = buildCalendar(
      'Client A',
      [
        {
          uid: 'p1@example.test',
          start: new Date('2026-11-02T10:00:00Z'),
          minutes: 15,
          summary: 'Page A: Product launch',
          description: 'Product launch, on Friday',
          url: 'https://example.test/posts',
          updated: new Date('2026-10-01T08:30:00Z'),
        },
      ],
      new Date('2026-10-12T09:00:00Z'),
    );
    expect(text).toContain('X-WR-CALNAME:Client A\r\n');
    expect(text).toContain('DTSTART:20261102T100000Z\r\n');
    expect(text).toContain('DTSTAMP:20261012T090000Z\r\n');
    expect(text).toContain('DESCRIPTION:Product launch\\, on Friday\r\n');
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
