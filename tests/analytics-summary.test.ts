import { describe, expect, it } from 'vitest';

import {
  channelChanges,
  combinedFindings,
  summaryFigures,
  sumSeries,
  weekly,
  type SummaryChannel,
} from '../src/lib/analytics-summary';

function channel(overrides: Partial<SummaryChannel> & { name: string }): SummaryChannel {
  return {
    targetId: overrides.name,
    followers: 1000,
    netFollows: 10,
    posts: 4,
    interactions: 200,
    reach: 1000,
    follows: 15,
    unfollows: 5,
    findings: [],
    previous: { posts: 2, interactions: 100, reach: 800, netFollows: 5 },
    ...overrides,
  };
}

const figure = (rows: SummaryChannel[], key: string) => summaryFigures(rows).kpis.find((kpi) => kpi.key === key)!;

describe('summaryFigures', () => {
  it('adds counts up and compares them with the previous period', () => {
    const rows = [channel({ name: 'Client A' }), channel({ name: 'Client B', interactions: 100, posts: 1 })];
    expect(figure(rows, 'interactions')).toEqual({ key: 'interactions', current: 300, previous: 200, change: 50 });
    expect(figure(rows, 'posts')).toEqual({ key: 'posts', current: 5, previous: 4, change: 25 });
    // All interactions over all posts, not an average of averages.
    expect(figure(rows, 'perPost').current).toBe(60);
    expect(figure(rows, 'perPost').previous).toBe(50);
  });

  it('sums reach as an upper bound across channels and recomputes the rate from parts', () => {
    const rows = [channel({ name: 'Client A' }), channel({ name: 'Client B', reach: 3000, interactions: 0 })];
    const result = summaryFigures(rows);
    expect(result.reachIsUpperBound).toBe(true);
    expect(figure(rows, 'reach').current).toBe(4000);
    // 200 interactions over 4000 people, per hundred.
    expect(figure(rows, 'rate').current).toBe(5);
    expect(figure(rows, 'rate').previous).toBe(12.5);
  });

  it('reads one channel’s reach as exact', () => {
    expect(summaryFigures([channel({ name: 'Client A' })]).reachIsUpperBound).toBe(false);
  });

  it('puts followers before the window at today less the net change, with gained and lost', () => {
    const result = summaryFigures([channel({ name: 'Client A' }), channel({ name: 'Client B', netFollows: -30, follows: null, unfollows: 30 })]);
    expect(result.kpis.find((kpi) => kpi.key === 'followers')).toMatchObject({ current: 2000, previous: 2020 });
    expect(result.netFollows).toBe(-20);
    expect(result.follows).toBe(15);
    expect(result.unfollows).toBe(35);
  });

  it('has no previous figure where none is known', () => {
    const rows = [channel({ name: 'Client A', netFollows: null, reach: null, previous: { posts: 0, interactions: 0, reach: null, netFollows: null } })];
    expect(figure(rows, 'followers').previous).toBeNull();
    expect(figure(rows, 'reach')).toMatchObject({ current: null, change: null });
    expect(figure(rows, 'interactions').change).toBeNull();
  });
});

describe('combinedFindings', () => {
  const good = { tone: 'good' as const, key: 'interactionsUp', params: { percent: 20 } };
  const warning = { tone: 'warning' as const, key: 'goneQuiet', params: { days: 9 } };
  const info = { tone: 'info' as const, key: 'bestTime', params: {} };
  const stale = { tone: 'info' as const, key: 'stale', params: { days: 3 } };

  it('names no channel when only one is selected, and leaves out sync notes', () => {
    expect(combinedFindings([channel({ name: 'Client A', findings: [stale, good, info] })])).toEqual([
      { finding: good, channels: [] },
      { finding: info, channels: [] },
    ]);
  });

  it('gives every channel its first finding before anyone gets a second, warnings first', () => {
    const rows = [
      channel({ name: 'Client A', findings: [good, info] }),
      channel({ name: 'Client B', findings: [warning] }),
      channel({ name: 'Client C', findings: [info] }),
    ];
    expect(combinedFindings(rows).map(({ finding, channels }) => `${channels.join(', ')}:${finding.key}`)).toEqual([
      'Client B:goneQuiet',
      'Client A:interactionsUp',
      'Client A, Client C:bestTime',
    ]);
  });

  it('says the same sentence once for every channel it fits', () => {
    const rows = ['Client A', 'Client B', 'Client C'].map((name) => channel({ name, findings: [warning] }));
    expect(combinedFindings(rows)).toEqual([{ finding: warning, channels: ['Client A', 'Client B', 'Client C'] }]);
  });

  it('is empty when there is nothing to say', () => {
    expect(combinedFindings([channel({ name: 'Client A' })])).toEqual([]);
  });
});

describe('channelChanges', () => {
  it('ranks channels by how much their interactions moved, falling back to reach', () => {
    const rows = [
      channel({ name: 'Client A', interactions: 110 }),
      channel({ name: 'Client B', interactions: 20 }),
      channel({ name: 'Client C', interactions: 0, previous: { posts: 0, interactions: 0, reach: 500, netFollows: null } }),
    ];
    expect(channelChanges(rows).map((row) => [row.name, row.figure, row.change])).toEqual([
      ['Client C', 'reach', 100],
      ['Client B', 'interactions', -80],
      ['Client A', 'interactions', 10],
    ]);
  });
});

describe('series helpers', () => {
  it('adds daily series up, padding the shorter', () => {
    expect(sumSeries([[1, 2, 3], [4, 5]])).toEqual([5, 7, 3]);
    expect(sumSeries([])).toEqual([]);
  });

  it('groups days into weeks from the first day', () => {
    expect(weekly([1, 1, 1, 1, 1, 1, 1, 2, 2])).toEqual([7, 4]);
  });
});
