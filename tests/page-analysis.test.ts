import { describe, expect, it } from 'vitest';

import {
  analyse,
  bestTimes,
  cadence,
  change,
  compareKpis,
  findings,
  formatBreakdown,
  formatOfAppPost,
  formatOfStatusType,
  healthScore,
  median,
  rateOf,
  summarise,
  type AnalysedPost,
  type PageTotals,
  captionBreakdown,
  hashtagBreakdown,
} from '../src/lib/page-analysis';

/**
 * Reading a Page's numbers for somebody.
 *
 * Every rule here ends up as a sentence on screen that a client may act on —
 * post more video, post on Tuesday evenings — so the tests are mostly about
 * when a rule must *not* fire: on a sample too small to mean anything, on data
 * Meta does not serve, on a comparison with nothing.
 */

const DAY = 24 * 60 * 60 * 1000;
const TO = new Date('2026-06-30T23:00:00Z');
const FROM = new Date(TO.getTime() - 28 * DAY);

let sequence = 0;
function post(overrides: Partial<AnalysedPost> & { at?: string } = {}): AnalysedPost {
  const reactions = overrides.reactions ?? 10;
  const comments = overrides.comments ?? 0;
  const shares = overrides.shares ?? 0;
  const interactions = overrides.interactions ?? reactions + comments + shares;
  const reach = overrides.reach === undefined ? 1000 : overrides.reach;
  sequence += 1;
  return {
    id: `p${sequence}`,
    source: 'page',
    message: 'Hello',
    url: null,
    publishedAt: overrides.at ? new Date(overrides.at) : new Date(TO.getTime() - DAY),
    format: 'photo',
    impressions: null,
    clicks: null,
    ...overrides,
    reactions,
    comments,
    shares,
    interactions,
    reach,
    rate: rateOf(interactions, reach),
  };
}

const NO_TOTALS: PageTotals = { reach: null, engagements: null, profileViews: null, follows: null, unfollows: null };

describe('formats', () => {
  it('reads Graph status types as the kind of post a person would name', () => {
    expect(formatOfStatusType('added_photos')).toBe('photo');
    expect(formatOfStatusType('added_video')).toBe('video');
    expect(formatOfStatusType('shared_story')).toBe('link');
    expect(formatOfStatusType('mobile_status_update')).toBe('text');
    expect(formatOfStatusType('created_event')).toBe('other');
    expect(formatOfStatusType(null)).toBe('other');
  });

  it('reads a post written here by what it carries, video first', () => {
    expect(formatOfAppPost([{ kind: 'image' }, { kind: 'video' }], null)).toBe('video');
    expect(formatOfAppPost([{ kind: 'image' }], 'https://x.test')).toBe('photo');
    expect(formatOfAppPost([], 'https://x.test')).toBe('link');
    expect(formatOfAppPost([], null)).toBe('text');
  });
});

describe('small arithmetic', () => {
  it('has no rate without reach, rather than a rate of infinity', () => {
    expect(rateOf(50, 1000)).toBe(5);
    expect(rateOf(50, null)).toBeNull();
    expect(rateOf(50, 0)).toBeNull();
  });

  it('will not call a rise from zero a percentage', () => {
    expect(change(10, 0)).toBeNull();
    expect(change(15, 10)).toBe(50);
    expect(change(null, 10)).toBeNull();
  });

  it('takes a median of an even list as the middle pair', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('summarise and compare', () => {
  it('counts interactions from reactions, comments and shares, not engaged users', () => {
    const summary = summarise([post({ reactions: 10, comments: 5, shares: 1 }), post({ reactions: 4 })]);
    expect(summary.interactions).toBe(20);
    expect(summary.avgInteractions).toBe(10);
  });

  it('prefers the Page’s own reach, and never compares it with a sum over posts', () => {
    const current = summarise([post({ reach: 500 })]);
    const previous = summarise([post({ reach: 400 })]);

    const pageLevel = compareKpis({
      current,
      previous,
      currentTotals: { ...NO_TOTALS, reach: 9000 },
      previousTotals: { ...NO_TOTALS, reach: 6000 },
    });
    expect(pageLevel.find((kpi) => kpi.key === 'reach')).toMatchObject({ current: 9000, previous: 6000, change: 50 });

    const postLevel = compareKpis({ current, previous, currentTotals: NO_TOTALS, previousTotals: NO_TOTALS });
    expect(postLevel.find((kpi) => kpi.key === 'reach')).toMatchObject({ current: 500, previous: 400 });
  });

  it('has no follower change when Meta serves neither half of it', () => {
    const kpis = compareKpis({
      current: summarise([]),
      previous: summarise([]),
      currentTotals: NO_TOTALS,
      previousTotals: NO_TOTALS,
    });
    expect(kpis.find((kpi) => kpi.key === 'netFollows')?.current).toBeNull();
  });
});

describe('cadence', () => {
  it('counts every week the window touches, including the empty ones', () => {
    const result = cadence([post({ at: '2026-06-29T10:00:00Z' })], FROM, TO, 'UTC');
    expect(result.weeks.length).toBeGreaterThanOrEqual(4);
    expect(result.quietWeeks).toBe(result.weeks.length - 1);
  });

  it('measures the longest gap up to the window’s edges', () => {
    // One post, ten days in: the gap after it runs to the end of the window.
    const result = cadence([post({ at: new Date(FROM.getTime() + 10 * DAY).toISOString() })], FROM, TO, 'UTC');
    expect(result.longestGapDays).toBe(18);
    expect(result.daysSinceLast).toBe(18);
  });

  it('buckets by the workspace’s own week, not UTC’s', () => {
    // Sunday 23:30 UTC is already Monday in Paris.
    const sunday = '2026-06-21T22:30:00Z';
    const utc = cadence([post({ at: sunday })], FROM, TO, 'UTC');
    const paris = cadence([post({ at: sunday })], FROM, TO, 'Europe/Paris');
    expect(utc.weeks.find((week) => week.posts === 1)?.week).toBe('2026-06-15');
    expect(paris.weeks.find((week) => week.posts === 1)?.week).toBe('2026-06-22');
  });
});

describe('formatBreakdown', () => {
  it('ranks formats by average interactions and gives each a lift against the whole', () => {
    const rows = formatBreakdown([
      post({ format: 'video', reactions: 90 }),
      post({ format: 'video', reactions: 110 }),
      post({ format: 'link', reactions: 20 }),
      post({ format: 'link', reactions: 20 }),
    ]);
    expect(rows.map((row) => row.format)).toEqual(['video', 'link']);
    expect(rows[0]).toMatchObject({ posts: 2, share: 50, avgInteractions: 100, lift: 1.7 });
  });
});

describe('bestTimes', () => {
  // A Tuesday, 18:00–21:00 in Paris.
  const tuesdayEvening = (week: number) =>
    new Date(Date.parse('2026-06-02T17:30:00Z') + week * 7 * DAY).toISOString();

  it('finds the block that does best, in local time', () => {
    const posts = [
      post({ at: tuesdayEvening(0), reactions: 100 }),
      post({ at: tuesdayEvening(1), reactions: 120 }),
      post({ at: '2026-06-04T08:00:00Z', reactions: 20 }),
      post({ at: '2026-06-11T08:00:00Z', reactions: 30 }),
      post({ at: '2026-06-18T08:00:00Z', reactions: 25 }),
    ];
    const result = bestTimes(posts, 'Europe/Paris');
    expect(result.best[0]).toMatchObject({ weekday: 2, hour: 18, posts: 2 });
    expect(result.cells).toHaveLength(7 * 8);
  });

  it('will not name a best time on the strength of one post', () => {
    const posts = [
      post({ at: tuesdayEvening(0), reactions: 500 }),
      post({ at: '2026-06-04T08:00:00Z', reactions: 20 }),
      post({ at: '2026-06-11T08:00:00Z', reactions: 30 }),
    ];
    expect(bestTimes(posts, 'Europe/Paris').best.every((cell) => cell.posts >= 2)).toBe(true);
    expect(bestTimes(posts, 'Europe/Paris').best.find((cell) => cell.weekday === 2)).toBeUndefined();
  });
});

describe('healthScore', () => {
  const steadyCadence = cadence(
    Array.from({ length: 12 }, (_, index) => post({ at: new Date(FROM.getTime() + (index * 2 + 1) * DAY).toISOString() })),
    FROM,
    TO,
    'UTC',
  );

  it('leaves out what it cannot measure rather than scoring it zero', () => {
    const health = healthScore({
      cadence: steadyCadence,
      kpis: compareKpis({ current: summarise([]), previous: summarise([]), currentTotals: NO_TOTALS, previousTotals: NO_TOTALS }),
      followers: null,
    });
    expect(health.components.map((component) => component.key)).toEqual(['consistency']);
    expect(health.score).toBe(health.components[0]!.score);
  });

  it('rewards regular posting, growth and momentum, and says which band that is', () => {
    const kpis = compareKpis({
      current: summarise([post({ reactions: 200 })]),
      previous: summarise([post({ reactions: 100 })]),
      currentTotals: { ...NO_TOTALS, reach: 2000, follows: 40, unfollows: 0 },
      previousTotals: { ...NO_TOTALS, reach: 1000 },
    });
    const health = healthScore({ cadence: steadyCadence, kpis, followers: 1000 });
    expect(health.score).toBeGreaterThanOrEqual(70);
    expect(health.band).toBe('strong');
  });

  it('has no score and no band for a Page with nothing to go on', () => {
    const health = healthScore({ cadence: { ...steadyCadence, weeks: [] }, kpis: [], followers: null });
    expect(health).toMatchObject({ score: null, band: null });
  });
});

describe('findings', () => {
  const base = {
    formats: [],
    times: { cells: [], best: [], sample: 0 },
    top: [],
    medianInteractions: null,
    lastSyncedAt: TO,
    now: TO,
  };

  function kpis(current: AnalysedPost[], previous: AnalysedPost[], totals = NO_TOTALS) {
    return compareKpis({ current: summarise(current), previous: summarise(previous), currentTotals: totals, previousTotals: NO_TOTALS });
  }

  it('says a Page has gone quiet when the silence is now, not once', () => {
    const posts = [post({ at: new Date(TO.getTime() - 12 * DAY).toISOString() })];
    const result = findings({ ...base, kpis: kpis(posts, []), cadence: cadence(posts, FROM, TO, 'UTC') });
    expect(result.find((finding) => finding.key === 'goneQuiet')?.params.days).toBe(12);
  });

  it('compares formats only with enough posts on both sides', () => {
    const few = formatBreakdown([
      post({ format: 'video', reactions: 300 }),
      post({ format: 'link', reactions: 10 }),
    ]);
    const posts = [post()];
    const quiet = findings({ ...base, kpis: kpis(posts, posts), cadence: cadence(posts, FROM, TO, 'UTC'), formats: few });
    expect(quiet.find((finding) => finding.key === 'bestFormat')).toBeUndefined();

    const enough = formatBreakdown([
      ...Array.from({ length: 3 }, () => post({ format: 'video', reactions: 300 })),
      ...Array.from({ length: 3 }, () => post({ format: 'link', reactions: 100 })),
    ]);
    const loud = findings({ ...base, kpis: kpis(posts, posts), cadence: cadence(posts, FROM, TO, 'UTC'), formats: enough });
    expect(loud.find((finding) => finding.key === 'bestFormat')?.params).toMatchObject({ best: 'video', worst: 'link', ratio: 3 });
  });

  it('warns about losing followers and about figures nobody has refreshed', () => {
    const posts = [post()];
    const result = findings({
      ...base,
      kpis: kpis(posts, posts, { ...NO_TOTALS, follows: 5, unfollows: 20 }),
      cadence: cadence(posts, FROM, TO, 'UTC'),
      lastSyncedAt: new Date(TO.getTime() - 5 * DAY),
    });
    expect(result.find((finding) => finding.key === 'losingFollowers')?.params.count).toBe(15);
    expect(result.find((finding) => finding.key === 'stale')?.params.days).toBe(5);
  });

  it('says nothing about momentum on a change too small to mean anything', () => {
    const result = findings({
      ...base,
      kpis: kpis([post({ reactions: 104 })], [post({ reactions: 100 })]),
      cadence: cadence([post()], FROM, TO, 'UTC'),
    });
    expect(result.find((finding) => finding.key.startsWith('interactions'))).toBeUndefined();
  });
});

describe('analyse', () => {
  it('keeps the strongest and weakest posts apart on a small Page', () => {
    const posts = Array.from({ length: 6 }, (_, index) => post({ reactions: index * 10 }));
    const result = analyse({
      current: posts,
      previous: [],
      timing: posts,
      currentTotals: NO_TOTALS,
      previousTotals: NO_TOTALS,
      followers: null,
      from: FROM,
      to: TO,
      timeZone: 'UTC',
      lastSyncedAt: TO,
      now: TO,
    });
    expect(result.top[0]?.reactions).toBe(50);
    expect(result.bottom).toEqual([]);
  });
});

describe('hashtagBreakdown', () => {
  it('ranks hashtags by how their posts did against the typical post', () => {
    const rows = hashtagBreakdown([
      post({ message: 'Fresh bread #Sourdough #bakery', reactions: 60 }),
      post({ message: 'More #sourdough today', reactions: 40 }),
      post({ message: 'Quiet day #bakery', reactions: 10 }),
      post({ message: 'Opening hours #bakery', reactions: 10 }),
      post({ message: 'No tags at all', reactions: 30 }),
    ]);
    // #Sourdough and #sourdough are one hashtag, as on Facebook.
    expect(rows.map((row) => row.tag)).toEqual(['#sourdough', '#bakery']);
    expect(rows[0]).toMatchObject({ posts: 2, avgInteractions: 50 });
    expect(rows[0]!.lift).toBeCloseTo(50 / 30);
  });

  it('leaves out a hashtag seen on a single post', () => {
    expect(hashtagBreakdown([post({ message: '#once' }), post({ message: 'plain' })])).toEqual([]);
  });

  it('counts a hashtag once per post, however often it repeats', () => {
    const rows = hashtagBreakdown([
      post({ message: '#a #a #a', reactions: 10 }),
      post({ message: '#a', reactions: 10 }),
    ]);
    expect(rows[0]!.posts).toBe(2);
  });
});

describe('captionBreakdown', () => {
  it('sorts captions by length without counting links and hashtags', () => {
    const long = 'x'.repeat(300);
    const rows = captionBreakdown([
      post({ message: 'Short one' }),
      post({ message: 'Another short #tag #tag2 https://example.com/a-very-long-link-that-is-not-reading' }),
      post({ message: long }),
      post({ message: long }),
    ]);
    const traits = Object.fromEntries(rows.map((row) => [row.trait, row.posts]));
    expect(traits.short).toBe(2);
    expect(traits.long).toBe(2);
    expect(traits.medium).toBeUndefined();
  });

  it('finds questions, emoji, hashtags and links', () => {
    const rows = captionBreakdown([
      post({ message: 'Croissant or pain au chocolat? 🥐 #choice', reactions: 50 }),
      post({ message: 'Which one? 🥖 #choice https://example.com', reactions: 30 }),
      post({ message: 'Plain announcement', reactions: 10 }),
    ]);
    const traits = Object.fromEntries(rows.map((row) => [row.trait, row]));
    expect(traits.question!.posts).toBe(2);
    expect(traits.emoji!.posts).toBe(2);
    expect(traits.hashtags!.posts).toBe(2);
    expect(traits.question!.lift).toBeCloseTo(40 / 30);
    // Only one post has a link: too few to say anything.
    expect(traits.link).toBeUndefined();
  });
});
