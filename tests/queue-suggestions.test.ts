import { describe, expect, it } from 'vitest';

import { rateOf, type AnalysedPost } from '../src/lib/page-analysis';
import { suggestSlots, upcomingOccurrences } from '../src/lib/queue-suggestions';
import { localInputToUtc } from '../src/lib/time';

/**
 * Suggesting queue times from what worked. The rule under test is fairness:
 * a big Page's ordinary posts must not outvote a small Page's best ones.
 */

let sequence = 0;
function post(at: string, interactions: number): AnalysedPost {
  sequence += 1;
  return {
    id: `p${sequence}`,
    source: 'page',
    message: '',
    url: null,
    publishedAt: new Date(at),
    format: 'photo',
    reach: 1000,
    impressions: null,
    reactions: interactions,
    comments: 0,
    shares: 0,
    clicks: null,
    interactions,
    rate: rateOf(interactions, 1000),
  };
}

// Tuesdays at about 18:30 UTC, and Thursday mornings.
const tuesday = (week: number, minute = 30) => new Date(Date.UTC(2026, 5, 2 + week * 7, 18, minute)).toISOString();
const thursday = (week: number) => new Date(Date.UTC(2026, 5, 4 + week * 7, 9, 0)).toISOString();

describe('suggestSlots', () => {
  it('suggests the block that beats each Page’s typical post, at a concrete time', () => {
    const suggestions = suggestSlots({
      pages: [
        {
          pageName: 'Bakery',
          posts: [post(tuesday(0), 200), post(tuesday(1, 45), 220), post(thursday(0), 100), post(thursday(1), 90), post(thursday(2), 110)],
        },
      ],
      timeZone: 'UTC',
      existing: [],
    });

    expect(suggestions[0]).toMatchObject({ dayOfWeek: 2, hour: 18, posts: 2, pages: ['Bakery'] });
    expect([30, 45]).toContain(suggestions[0]!.minute);
    expect(suggestions[0]!.lift).toBeGreaterThan(1.5);
  });

  it('does not let a big Page outvote a small one', () => {
    // The big Page's ordinary Thursday posts have far more interactions than
    // the small Page's great Tuesday ones — but they are only typical for it.
    const suggestions = suggestSlots({
      pages: [
        { pageName: 'Big', posts: [post(thursday(0), 5000), post(thursday(1), 5000), post(thursday(2), 5000)] },
        { pageName: 'Small', posts: [post(tuesday(0), 60), post(tuesday(1), 60), post(thursday(0), 20), post(thursday(1), 20)] },
      ],
      timeZone: 'UTC',
      existing: [],
    });

    expect(suggestions[0]).toMatchObject({ dayOfWeek: 2, pages: ['Small'] });
    expect(suggestions.find((entry) => entry.dayOfWeek === 4 && entry.hour === 9)).toBeUndefined();
  });

  it('leaves out a block the queue already covers', () => {
    const pages = [{ pageName: 'Bakery', posts: [post(tuesday(0), 200), post(tuesday(1), 200), post(thursday(0), 50), post(thursday(1), 50)] }];
    const suggestions = suggestSlots({ pages, timeZone: 'UTC', existing: [{ dayOfWeek: 2, hour: 19, minute: 0 }] });
    expect(suggestions.find((entry) => entry.dayOfWeek === 2)).toBeUndefined();
  });

  it('says nothing on a single lucky post', () => {
    const pages = [{ pageName: 'Bakery', posts: [post(tuesday(0), 900), post(thursday(0), 50), post(thursday(1), 50)] }];
    expect(suggestSlots({ pages, timeZone: 'UTC', existing: [] })).toEqual([]);
  });

  it('works in the workspace’s own time zone', () => {
    // 18:30 UTC in June is 20:30 in Paris.
    const pages = [{ pageName: 'Bakery', posts: [post(tuesday(0), 200), post(tuesday(1), 200), post(thursday(0), 50), post(thursday(1), 50)] }];
    const [first] = suggestSlots({ pages, timeZone: 'Europe/Paris', existing: [] });
    expect(first).toMatchObject({ dayOfWeek: 2, hour: 20, minute: 30 });
  });
});

describe('upcomingOccurrences', () => {
  it('lists each weekly slot as a real instant, earliest first', () => {
    const from = new Date('2026-06-01T12:00:00Z'); // a Monday
    const upcoming = upcomingOccurrences({
      slots: [
        { dayOfWeek: 1, hour: 9, minute: 0 }, // already passed today
        { dayOfWeek: 1, hour: 18, minute: 0 },
        { dayOfWeek: 3, hour: 9, minute: 30 },
      ],
      timeZone: 'UTC',
      from,
      days: 7,
      toUtc: localInputToUtc,
    });

    expect(upcoming.slice(0, 3).map((entry) => entry.at.toISOString())).toEqual([
      '2026-06-01T18:00:00.000Z',
      '2026-06-03T09:30:00.000Z',
      '2026-06-08T09:00:00.000Z',
    ]);
  });
});
