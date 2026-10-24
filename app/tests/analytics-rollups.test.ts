import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  policy: null as null | Record<string, number>,
  insights: [] as Array<{ targetId: string; metric: string; period: string; endTime: Date; numeric: number | null; value: unknown; fetchedAt: Date }>,
  runs: [] as Array<{ id: string; status: string; windowFrom: Date; finishedAt: Date; targetIds: string[] }>,
  dailyRows: [] as Array<{ targetId: string; metric: string; period: string; value: number; asOf: Date; fetchedAt: Date }>,
  weeklyRows: [] as Array<{ targetId: string; metric: string; period: string; weekStart: Date; value: number; fetchedAt: Date }>,
  breakdowns: false,
  targets: [] as Array<{ id: string; workspaceId: string }>,
  watermarks: [] as Array<{ targetId: string; maxDay: Date }>,
  writes: [] as string[],
  computed: [] as Array<{ workspaceId: string; targetIds: readonly string[]; from: Date; to: Date }>,
}));

vi.mock('@/server/config/store', () => ({
  runtimeConfig: vi.fn(async (key: string) => (key === 'analytics.rollups.policy' ? state.policy : null)),
  runtimeSecret: vi.fn(async () => null),
}));
vi.mock('@/server/config/config-or-default', () => ({
  configOrDefault: vi.fn(async () => state.policy),
}));
vi.mock('@/server/data-control/guard', () => ({ assertWorkspaceNotPurging: vi.fn(async () => undefined) }));
vi.mock('@/server/platforms/registry', () => ({
  analyticsPlatformIds: vi.fn(async () => ['facebook']),
  platformAnalytics: vi.fn(async () => ({
    rollups: {
      computeDaily: vi.fn(async (input: { workspaceId: string; targetIds: readonly string[]; from: Date; to: Date }) => {
        state.computed.push(input);
        return [{ targetId: input.targetIds[0], metric: 'page_media_view', period: 'day', day: '2026-10-20', kind: 'flow', value: 7, samples: 2, asOf: new Date('2026-10-20T00:00:00Z'), fetchedAt: new Date('2026-10-21T01:00:00Z') }];
      }),
    },
  })),
}));
vi.mock('@/server/data', () => {
  const queryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('FROM analytics_rollup_runs')) {
      const [from, todayStart, wantedJson] = [values[3] as Date, values[4] as Date, values[5] as string];
      const wanted = JSON.parse(wantedJson) as string[];
      return state.runs.filter(run => ['completed', 'partial'].includes(run.status) && run.windowFrom <= from && run.finishedAt >= todayStart && wanted.every(id => run.targetIds.includes(id)));
    }
    if (sql.includes('FROM analytics_rollup_daily') && sql.includes('MAX(day)')) return state.watermarks;
    if (sql.includes('FROM analytics_rollup_daily')) return state.dailyRows;
    if (sql.includes('FROM analytics_rollup_weekly')) return state.weeklyRows;
    if (sql.includes('FROM page_insights pi')) return state.breakdowns ? [{ one: 1 }] : [];
    if (sql.includes('FROM targets t')) return state.targets;
    throw new Error(`unexpected query: ${sql}`);
  });
  const executeRaw = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('INSERT INTO analytics_rollup_daily')) {
      state.writes.push('daily');
      return 1;
    }
    if (sql.includes('INSERT INTO analytics_rollup_weekly')) {
      state.writes.push('weekly');
      return 1;
    }
    if (sql.includes('INSERT INTO analytics_rollup_runs')) {
      state.writes.push('run');
      return 1;
    }
    if (sql.includes('DELETE FROM analytics_rollup_runs')) {
      state.writes.push('retention');
      return 1;
    }
    throw new Error(`unexpected execute: ${sql}`);
  });
  const tx = { $queryRaw: queryRaw, $executeRaw: executeRaw };
  return {
    prisma: {
      $queryRaw: queryRaw,
      $executeRaw: executeRaw,
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
      pageInsight: { findMany: vi.fn(async () => state.insights) },
    },
  };
});

import { fullWeeksInRange, readChannelRollupPreference } from '@/modules/analytics/rollups/read';
import { deriveWeeklyRollups, runAnalyticsRollups } from '@/modules/analytics/rollups/runner';
import { weekStartOfDay } from '@/modules/analytics/rollups/weeks';
import { ROLLUPS_POLICY_DEFAULTS } from '@/modules/analytics/rollups/config';
import { computeFacebookDailyRollups, hasUnrolledDayBreakdowns } from '@/platforms/facebook/rollups';
import { normalizeFacebookAnalytics } from '@/platforms/facebook/analytics';

const POLICY = { ...ROLLUPS_POLICY_DEFAULTS };
const TODAY = new Date('2026-10-23T12:00:00Z');

beforeEach(() => {
  state.policy = { ...POLICY };
  state.insights = [];
  state.runs = [];
  state.dailyRows = [];
  state.weeklyRows = [];
  state.breakdowns = false;
  state.targets = [];
  state.watermarks = [];
  state.writes = [];
  state.computed = [];
});

describe('rollup week helpers', () => {
  it('starts weeks on Monday and lists only fully covered weeks', () => {
    expect(weekStartOfDay('2026-10-19')).toBe('2026-10-19');
    expect(weekStartOfDay('2026-10-25')).toBe('2026-10-19');
    expect(weekStartOfDay('2026-10-18')).toBe('2026-10-12');
    expect(fullWeeksInRange('2026-10-19', '2026-10-25')).toEqual(['2026-10-19']);
    expect(fullWeeksInRange('2026-10-20', '2026-10-25')).toEqual([]);
    expect(fullWeeksInRange('2026-10-19', '2026-11-01')).toEqual(['2026-10-19', '2026-10-26']);
    expect(fullWeeksInRange('2026-10-25', '2026-10-19')).toEqual([]);
  });

  it('derives weekly rows by summing flows and keeping the latest stock day', () => {
    const rows = deriveWeeklyRollups([
      { targetId: 't1', metric: 'page_media_view', period: 'day', day: '2026-10-19', kind: 'flow', value: 4, samples: 1, asOf: new Date('2026-10-19T00:00:00Z'), fetchedAt: new Date('2026-10-20T00:00:00Z') },
      { targetId: 't1', metric: 'page_media_view', period: 'day', day: '2026-10-20', kind: 'flow', value: 6, samples: 2, asOf: new Date('2026-10-20T00:00:00Z'), fetchedAt: new Date('2026-10-21T00:00:00Z') },
      { targetId: 't1', metric: 'page_follows', period: 'day', day: '2026-10-19', kind: 'stock', value: 100, samples: 1, asOf: new Date('2026-10-19T00:00:00Z'), fetchedAt: new Date('2026-10-20T00:00:00Z') },
      { targetId: 't1', metric: 'page_follows', period: 'day', day: '2026-10-20', kind: 'stock', value: 110, samples: 1, asOf: new Date('2026-10-20T00:00:00Z'), fetchedAt: new Date('2026-10-21T00:00:00Z') },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.metric === 'page_media_view')).toMatchObject({ weekStart: '2026-10-19', value: 10, samples: 3 });
    expect(rows.find(row => row.metric === 'page_follows')).toMatchObject({ weekStart: '2026-10-19', value: 110, samples: 2 });
  });
});

describe('Facebook daily rollup computation', () => {
  it('sums same-day flows, keeps the latest stock and skips non-numeric rows', async () => {
    state.insights = [
      { targetId: 't1', metric: 'page_media_view', period: 'day', endTime: new Date('2026-10-20T00:00:00Z'), numeric: 4, value: 4, fetchedAt: new Date('2026-10-20T01:00:00Z') },
      { targetId: 't1', metric: 'page_media_view', period: 'day', endTime: new Date('2026-10-20T00:00:00Z'), numeric: 6, value: 6, fetchedAt: new Date('2026-10-20T02:00:00Z') },
      { targetId: 't1', metric: 'page_follows', period: 'day', endTime: new Date('2026-10-20T00:00:00Z'), numeric: 100, value: 100, fetchedAt: new Date('2026-10-20T01:00:00Z') },
      { targetId: 't1', metric: 'page_follows', period: 'day', endTime: new Date('2026-10-20T00:00:00Z'), numeric: 110, value: 110, fetchedAt: new Date('2026-10-20T02:00:00Z') },
      { targetId: 't1', metric: 'page_media_view', period: 'day', endTime: new Date('2026-10-21T00:00:00Z'), numeric: null, value: { unknown: true }, fetchedAt: new Date('2026-10-21T02:00:00Z') },
    ];
    const rows = await computeFacebookDailyRollups({ workspaceId: 'w1', targetIds: ['t1'], from: new Date('2026-10-20T00:00:00Z'), to: new Date('2026-10-22T00:00:00Z') });
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.metric === 'page_media_view')).toMatchObject({ day: '2026-10-20', kind: 'flow', value: 10, samples: 2 });
    expect(rows.find(row => row.metric === 'page_follows')).toMatchObject({ day: '2026-10-20', kind: 'stock', value: 110, samples: 2 });
  });

  it('reads stored insights only for the requested workspace channels', async () => {
    await computeFacebookDailyRollups({ workspaceId: 'w1', targetIds: [], from: new Date(), to: new Date() });
    expect(state.insights).toEqual([]);
  });
});

describe('rollup read preference', () => {
  const freshRun = (targetIds: string[] = ['t1']) => {
    state.runs = [{ id: 'arr_1', status: 'completed', windowFrom: new Date('2026-01-01T00:00:00Z'), finishedAt: new Date('2026-10-23T01:30:00Z'), targetIds }];
  };

  it('prefers daily rollups for complete past days when a fresh run covers the request', async () => {
    freshRun();
    state.dailyRows = [{ targetId: 't1', metric: 'page_media_view', period: 'day', value: 10, asOf: new Date('2026-10-20T00:00:00Z'), fetchedAt: new Date('2026-10-23T01:00:00Z') }];
    const preference = await readChannelRollupPreference({
      provider: 'facebook', workspaceId: 'w1', targetIds: ['t1'],
      from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-23T23:59:59Z'), today: TODAY,
    });
    expect(preference?.granularity).toBe('daily');
    expect(preference?.rolledTo).toEqual(new Date('2026-10-22T23:59:59.999Z'));
    expect(preference?.rows).toHaveLength(1);
  });

  it('falls back without a fresh covering run or with uncovered channels', async () => {
    const input = { provider: 'facebook', workspaceId: 'w1', targetIds: ['t1'], from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-22T00:00:00Z'), today: TODAY };
    expect(await readChannelRollupPreference(input)).toBeNull();
    state.runs = [{ id: 'arr_1', status: 'completed', windowFrom: new Date('2026-01-01T00:00:00Z'), finishedAt: new Date('2026-10-22T01:30:00Z'), targetIds: ['t1'] }];
    expect(await readChannelRollupPreference(input)).toBeNull();
    freshRun(['t2']);
    expect(await readChannelRollupPreference(input)).toBeNull();
  });

  it('renders long ranges from weekly rollups with daily edges', async () => {
    freshRun();
    state.weeklyRows = [{ targetId: 't1', metric: 'page_media_view', period: 'day', weekStart: new Date('2026-08-03T00:00:00Z'), value: 70, fetchedAt: new Date('2026-10-23T01:00:00Z') }];
    state.dailyRows = [{ targetId: 't1', metric: 'page_media_view', period: 'day', value: 3, asOf: new Date('2026-10-23T00:00:00Z'), fetchedAt: new Date('2026-10-23T01:00:00Z') }];
    const preference = await readChannelRollupPreference({
      provider: 'facebook', workspaceId: 'w1', targetIds: ['t1'],
      from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-10-23T23:59:59Z'), today: TODAY,
    });
    expect(preference?.granularity).toBe('weekly');
    expect(preference?.rows).toHaveLength(2);
    expect(preference?.rows[0]?.date).toEqual(new Date('2026-08-03T00:00:00Z'));
  });

  it('falls back to detailed reads when the rollup tables are not yet applied', async () => {
    freshRun();
    const { prisma } = await import('@/server/data');
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(Object.assign(new Error('relation "analytics_rollup_runs" does not exist'), { code: '42P01' }));
    expect(await readChannelRollupPreference({
      provider: 'facebook', workspaceId: 'w1', targetIds: ['t1'],
      from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-22T00:00:00Z'), today: TODAY,
    })).toBeNull();
  });
});

describe('unrolled breakdown guard', () => {
  it('detects object-valued day rows that need detailed reads', async () => {
    const input = { workspaceId: 'w1', targetIds: ['t1'], from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-22T00:00:00Z') };
    expect(await hasUnrolledDayBreakdowns(input)).toBe(false);
    state.breakdowns = true;
    expect(await hasUnrolledDayBreakdowns(input)).toBe(true);
  });
});

describe('rollup worker', () => {
  it('precomputes daily and weekly rows with coverage records per workspace', async () => {
    state.targets = [{ id: 't1', workspaceId: 'w1' }, { id: 't2', workspaceId: 'w1' }];
    const summary = await runAnalyticsRollups(new Date('2026-10-23T01:30:00Z'));
    expect(summary).toMatchObject({ workspaces: 1, examined: 2, failed: 0 });
    expect(summary.written).toBeGreaterThan(0);
    expect(state.computed).toHaveLength(2);
    expect(state.computed[0]).toMatchObject({ workspaceId: 'w1', targetIds: ['t1'] });
    // Cold channels backfill the policy window; warm channels recompute the lookback.
    expect(state.computed[0]!.from).toEqual(new Date('2025-09-19T00:00:00Z'));
    expect(state.writes.filter(write => write === 'daily')).toHaveLength(2);
    expect(state.writes.filter(write => write === 'weekly')).toHaveLength(2);
    expect(state.writes.filter(write => write === 'run')).toHaveLength(2);
    expect(state.writes).toContain('retention');
  });

  it('caps channels per workspace and marks the run partial', async () => {
    state.policy = { ...POLICY, batchTargets: 1 };
    state.targets = [{ id: 't1', workspaceId: 'w1' }, { id: 't2', workspaceId: 'w1' }];
    const summary = await runAnalyticsRollups(new Date('2026-10-23T01:30:00Z'));
    expect(summary).toMatchObject({ examined: 1, skipped: 1 });
    expect(state.computed.map(call => call.targetIds[0])).toEqual(['t1']);
  });
});

describe('weekly series disclosure', () => {
  const pageRow = (endTime: Date, numeric: number | null, value: unknown = numeric) => ({
    metric: 'page_media_view', period: 'day', endTime, numeric, value, fetchedAt: endTime, target: { id: 't1', name: 'Page' },
  });
  const targets = [{ id: 't1', name: 'Page', type: 'page', socialAccountId: 'sa1' }];

  it('appends the weekly note to day series only on the weekly path', () => {
    const rows = [pageRow(new Date('2026-10-19T00:00:00Z'), 10)];
    const weekly = normalizeFacebookAnalytics({ pageRows: rows, audienceRows: [], adRows: [], selectedTargets: targets, selectedAdAccounts: [], weeklySeriesNote: true });
    const detailed = normalizeFacebookAnalytics({ pageRows: rows, audienceRows: [], adRows: [], selectedTargets: targets, selectedAdAccounts: [] });
    const series = weekly.metrics.find(metric => metric.key === 'page_media_view::day');
    expect(series?.aggregationNote).toContain('weekly points');
    expect(detailed.metrics.find(metric => metric.key === 'page_media_view::day')?.aggregationNote).toBeUndefined();
  });
});
