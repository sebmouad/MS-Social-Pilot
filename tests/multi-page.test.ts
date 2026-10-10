import { describe, expect, it } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { ALL_PAGES, assertPageParam, assertPagesAllowed, mayUsePage, postScope, scopeOf, targetScope } from '../src/lib/page-access';
import { visiblePages } from '../src/lib/page-groups';
import { slotsForPages } from '../src/lib/posts';
import { commentIsDue } from '../src/lib/first-comment';
import { dailySeries, postingTips, type AnalysedPost } from '../src/lib/page-analysis';
import { parseSections, REPORT_SECTIONS } from '../src/lib/report-sections';

/**
 * Running many Pages at once: who may work on which Page, how a screen is
 * narrowed to some of them, and the queue that keeps a timetable per Page.
 */

describe('page access', () => {
  const limited = scopeOf({ role: WorkspaceRole.editor, allPages: false, pages: [{ targetId: 'a' }, { targetId: 'b' }] });

  it('gives owners and admins every Page, whatever the flag says', () => {
    expect(scopeOf({ role: WorkspaceRole.admin, allPages: false, pages: [] })).toEqual(ALL_PAGES);
    expect(scopeOf({ role: WorkspaceRole.owner, allPages: false, pages: [] })).toEqual(ALL_PAGES);
  });

  it('limits a member below admin to the Pages they were given', () => {
    expect(limited).toEqual({ all: false, ids: ['a', 'b'] });
    expect(mayUsePage(limited, 'a')).toBe(true);
    expect(mayUsePage(limited, 'c')).toBe(false);
  });

  it('narrows queries only when limited', () => {
    expect(targetScope(ALL_PAGES)).toEqual({});
    expect(postScope(ALL_PAGES)).toEqual({});
    expect(targetScope(limited)).toEqual({ id: { in: ['a', 'b'] } });
    expect(postScope(limited)).toEqual({ targets: { some: { targetId: { in: ['a', 'b'] } } } });
  });

  it('refuses a write that names somebody else’s Page', () => {
    expect(() => assertPagesAllowed(limited, ['a'])).not.toThrow();
    expect(() => assertPagesAllowed(limited, ['a', 'c'])).toThrow();
    expect(() => assertPagesAllowed(ALL_PAGES, ['anything'])).not.toThrow();
  });

  it('makes a limited member name a Page where others may leave it out', () => {
    expect(() => assertPageParam(ALL_PAGES, null)).not.toThrow();
    expect(() => assertPageParam(limited, null)).toThrow();
    expect(() => assertPageParam(limited, 'c')).toThrow();
    expect(() => assertPageParam(limited, 'b')).not.toThrow();
  });
});

describe('the Pages sidebar', () => {
  const groups = [{ id: 'g', name: 'Food', color: 'green' as const, targetIds: ['a', 'b'] }];
  const allIds = ['a', 'b', 'c'];

  it('narrows nothing without parameters', () => {
    expect(visiblePages({ allIds, groups })).toBeNull();
  });

  it('shows a group’s Pages', () => {
    expect(visiblePages({ allIds, groups, group: 'g' })).toEqual(['a', 'b']);
  });

  it('hides Pages with the eye, inside the group', () => {
    expect(visiblePages({ allIds, groups, group: 'g', pages: 'a' })).toEqual(['a']);
  });

  it('can only take Pages away, never add one the member does not have', () => {
    expect(visiblePages({ allIds, groups, pages: 'a,zzz' })).toEqual(['a']);
  });
});

describe('the queue, per Page', () => {
  const rows = [
    { dayOfWeek: 1, hour: 9, minute: 0, targetId: null },
    { dayOfWeek: 1, hour: 12, minute: 0, targetId: 'a' },
    { dayOfWeek: 1, hour: 18, minute: 0, targetId: 'a' },
    { dayOfWeek: 1, hour: 18, minute: 0, targetId: 'b' },
  ];
  const times = (slots: Array<{ hour: number }>) => slots.map((slot) => slot.hour).sort((x, y) => x - y);

  it('gives one Page the shared times and its own', () => {
    expect(times(slotsForPages(rows, ['a']))).toEqual([9, 12, 18]);
  });

  it('gives several Pages only the times they all have', () => {
    expect(times(slotsForPages(rows, ['a', 'b']))).toEqual([9, 18]);
  });

  it('keeps the shared timetable for a post with no Page named', () => {
    expect(times(slotsForPages(rows, []))).toEqual([9]);
  });
});

describe('the first comment’s delay', () => {
  const published = new Date('2026-10-10T10:00:00Z');

  it('goes straight away without one', () => {
    expect(commentIsDue(published, 0, published)).toBe(true);
  });

  it('waits until the delay is up', () => {
    expect(commentIsDue(published, 15, new Date('2026-10-10T10:14:00Z'))).toBe(false);
    expect(commentIsDue(published, 15, new Date('2026-10-10T10:15:00Z'))).toBe(true);
  });

  it('does not wait for ever when the publish time was not recorded', () => {
    expect(commentIsDue(null, 60, published)).toBe(true);
  });
});

function post(at: string, interactions: number, reach: number | null = 100): AnalysedPost {
  return {
    id: at,
    source: 'app',
    message: '',
    url: null,
    publishedAt: new Date(at),
    format: 'photo',
    reach,
    impressions: null,
    reactions: interactions,
    comments: 0,
    shares: 0,
    clicks: null,
    interactions,
    rate: reach ? (interactions / reach) * 100 : null,
  };
}

describe('the KPI cards’ days', () => {
  it('has one value per day, zero on a day with nothing', () => {
    const series = dailySeries(
      [post('2026-10-01T09:00:00Z', 10), post('2026-10-01T15:00:00Z', 20), post('2026-10-03T09:00:00Z', 5)],
      new Date('2026-10-01T00:00:00Z'),
      new Date('2026-10-03T23:00:00Z'),
      'UTC',
    );
    expect(series.days).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(series.posts).toEqual([2, 0, 1]);
    expect(series.interactions).toEqual([30, 0, 5]);
    expect(series.avgInteractions).toEqual([15, 0, 5]);
  });
});

describe('the posting tips', () => {
  it('says nothing until there is enough behind it', () => {
    expect(postingTips([post('2026-10-01T09:00:00Z', 10)], 'UTC')).toEqual({ bestDay: null, bestPerDay: null });
  });

  it('finds the day whose posts do best', () => {
    // Thursdays (1, 8, 15 Oct 2026) do four times the Mondays.
    const posts = [
      ...['2026-10-01', '2026-10-08', '2026-10-15'].map((day) => post(`${day}T09:00:00Z`, 40)),
      ...['2026-10-05', '2026-10-12', '2026-10-19'].map((day) => post(`${day}T09:00:00Z`, 10)),
    ];
    const tips = postingTips(posts, 'UTC');
    expect(tips.bestDay?.weekday).toBe(4);
    expect(tips.bestDay?.lift).toBeGreaterThan(1);
  });

  it('suggests the busiest day count whose posts still hold up', () => {
    const posts = [
      // One post a day: 10 each.
      ...['2026-10-01', '2026-10-02', '2026-10-03'].map((day) => post(`${day}T09:00:00Z`, 10)),
      // Two a day: 9 each — still most of the best.
      ...['2026-10-04', '2026-10-05', '2026-10-06'].flatMap((day) => [post(`${day}T09:00:00Z`, 9), post(`${day}T15:00:00Z`, 9)]),
    ];
    expect(postingTips(posts, 'UTC').bestPerDay?.count).toBe(2);
  });
});

describe('report sections', () => {
  it('prints everything by default', () => {
    expect(parseSections(undefined)).toEqual([...REPORT_SECTIONS]);
    expect(parseSections('nonsense')).toEqual([...REPORT_SECTIONS]);
  });

  it('keeps the order the report prints in, whatever the link says', () => {
    expect(parseSections('topPosts,analysis')).toEqual(['analysis', 'topPosts']);
  });
});
