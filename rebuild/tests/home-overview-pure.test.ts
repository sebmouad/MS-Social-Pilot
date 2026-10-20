import { describe, expect, it } from 'vitest';
import { engagementHeatmap, lastDays, periodTotals, scheduleMode, snippet, spendByCurrency, sumKnown } from '@/modules/home/server/overview-pure';
import { homeCopy, fill } from '@/modules/home/copy';
import { HOME_CONFIG } from '@/modules/home/config';

describe('home overview arithmetic', () => {
  it('treats missing figures as unknown, never zero', () => {
    expect(sumKnown([null, null])).toBeNull();
    expect(sumKnown([null, 3, 4])).toBe(7);
    expect(sumKnown([0, null])).toBe(0);
  });

  it('compares only channels known in both periods', () => {
    const totals = periodTotals([{ current: 120, previous: 100 }, { current: 50, previous: null }, { current: null, previous: 40 }]);
    expect(totals.current).toBe(170);
    expect(totals.previous).toBe(100);
    expect(totals.change).toBeCloseTo(0.2);
    expect(totals.covered).toBe(2);
    expect(totals.comparable).toBe(1);
  });

  it('has no change without a positive previous period', () => {
    expect(periodTotals([{ current: 5, previous: 0 }]).change).toBeNull();
    expect(periodTotals([{ current: null, previous: null }]).current).toBeNull();
  });

  it('classifies where a scheduled post is held', () => {
    expect(scheduleMode(['scheduled', 'scheduled'])).toBe('app');
    expect(scheduleMode(['scheduled_remote', 'scheduled_remote'])).toBe('platform');
    expect(scheduleMode(['scheduled', 'scheduled_remote'])).toBe('mixed');
  });

  it('shortens post text on one line', () => {
    expect(snippet('  a\n\n b  ', 20)).toBe('a b');
    expect(snippet('abcdefghij', 5)).toBe('abcd…');
  });

  it('builds an inclusive UTC day range', () => {
    expect(lastDays(new Date('2026-10-20T10:00:00Z'), 28)).toEqual({ start: '2026-09-23', end: '2026-10-20' });
  });

  it('never adds spend across currencies', () => {
    const groups = spendByCurrency([
      { currency: 'EUR', spend: 10, date: '2026-10-01' }, { currency: 'EUR', spend: 5, date: '2026-10-01' },
      { currency: 'USD', spend: 7, date: '2026-10-02' }, { currency: 'EUR', spend: 1, date: '2026-10-02' },
    ]);
    expect(groups.find(group => group.currency === 'EUR')).toMatchObject({ total: 16, daily: [{ date: '2026-10-01', value: 15 }, { date: '2026-10-02', value: 1 }] });
    expect(groups.find(group => group.currency === 'USD')?.total).toBe(7);
  });
});

describe('best-time heatmap', () => {
  // 2026-10-19 is a Monday; UTC so hour/day are unambiguous.
  const post = (id: string, iso: string, rankValue: number | null) => ({ postId: id, publishedAt: new Date(iso), rankValue });

  it('scores each channel against its own median and averages channels equally', () => {
    const big = [post('a', '2026-10-19T09:10:00Z', 1000), post('b', '2026-10-20T09:10:00Z', 500), post('c', '2026-10-21T15:00:00Z', 500)];
    const small = [post('d', '2026-10-19T09:30:00Z', 20), post('e', '2026-10-20T15:00:00Z', 10), post('f', '2026-10-21T15:00:00Z', 10)];
    const { cells, measuredPosts } = engagementHeatmap([big, small], 'UTC', 3);
    expect(measuredPosts).toBe(6);
    const monday9 = cells.find(cell => cell.day === 1 && cell.hour === 9)!;
    expect(monday9.value).toBeCloseTo(2); // both channels doubled their typical post
    expect(monday9.posts).toBe(2);
    expect(cells.find(cell => cell.day === 3 && cell.hour === 15)!.value).toBeCloseTo(1);
  });

  it('reports not enough history instead of a thin map', () => {
    expect(engagementHeatmap([[post('a', '2026-10-19T09:00:00Z', 5)]], 'UTC', 10).cells).toEqual([]);
  });

  it('ignores unmeasured, negative and duplicate posts', () => {
    const history = [post('a', '2026-10-19T09:00:00Z', 4), post('a', '2026-10-19T10:00:00Z', 400), post('b', '2026-10-19T09:00:00Z', null), post('c', '2026-10-19T09:00:00Z', -1), post('d', '2026-10-20T09:00:00Z', 4)];
    expect(engagementHeatmap([history], 'UTC', 1).measuredPosts).toBe(2);
  });

  it('uses the workspace time zone for weekday and hour', () => {
    const { cells } = engagementHeatmap([[post('a', '2026-10-19T23:30:00Z', 2), post('b', '2026-10-19T23:40:00Z', 2)]], 'Africa/Casablanca', 1);
    // Monday 23:30 UTC is Tuesday 00:30 in Casablanca (UTC+1 in October).
    expect(cells.map(cell => [cell.day, cell.hour])).toEqual([[2, 0]]);
  });
});

describe('home copy and settings', () => {
  it('has the same keys in English and French', () => {
    expect(Object.keys(homeCopy('fr')).sort()).toEqual(Object.keys(homeCopy('en')).sort());
    expect(Object.keys(homeCopy('fr').moduleNames).sort()).toEqual(Object.keys(homeCopy('en').moduleNames).sort());
  });

  it('fills placeholders and leaves unknown ones', () => {
    expect(fill('{n} days {x}', { n: 28 })).toBe('28 days {x}');
  });

  it('declares every setting under the home prefix with a valid default', () => {
    for (const entry of HOME_CONFIG) {
      expect(entry.key.startsWith('home.')).toBe(true);
      expect(entry.schema.safeParse(entry.defaultValue).success).toBe(true);
    }
  });
});
