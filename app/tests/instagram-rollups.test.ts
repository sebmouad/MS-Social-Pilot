import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  targets: [] as Array<{ id: string; providerId: string; socialAccountId: string | null }>,
  accounts: [] as Array<{ id: string; targetId: string | null; igUserId: string; socialAccountId: string | null }>,
  insights: [] as Array<{ accountId: string; metric: string; period: string; endTime: Date; numeric: number | null; value: unknown; fetchedAt: Date }>,
  breakdowns: false,
}));

vi.mock('@/server/data', () => ({
  prisma: {
    target: { findMany: vi.fn(async () => state.targets) },
    instagramAccount: { findMany: vi.fn(async () => state.accounts) },
    instagramInsight: { findMany: vi.fn(async () => state.insights) },
    $queryRaw: vi.fn(async () => (state.breakdowns ? [{ one: 1 }] : [])),
  },
}));

import { computeInstagramDailyRollups, hasUnrolledInstagramDayBreakdowns } from '@/platforms/instagram/rollups';

const envelope = (value: unknown, rangeTotal = false) => ({ instagramHostVersion: 1, period: 'day', value, rangeTotal, raw: {} });

beforeEach(() => {
  state.targets = [{ id: 't1', providerId: 'ig1', socialAccountId: 'sa1' }];
  state.accounts = [{ id: 'a1', targetId: 't1', igUserId: 'ig1', socialAccountId: 'sa1' }];
  state.insights = [];
  state.breakdowns = false;
});

describe('Instagram daily rollup computation', () => {
  it('sums same-day flows, keeps the latest stock and skips non-numeric rows', async () => {
    state.insights = [
      { accountId: 'a1', metric: 'views', period: 'day', endTime: new Date('2026-10-20T00:00:00Z'), numeric: 4, value: envelope(4), fetchedAt: new Date('2026-10-20T01:00:00Z') },
      { accountId: 'a1', metric: 'views', period: 'day', endTime: new Date('2026-10-20T00:00:00Z'), numeric: 6, value: envelope(6), fetchedAt: new Date('2026-10-20T02:00:00Z') },
      { accountId: 'a1', metric: 'reach', period: 'day', endTime: new Date('2026-10-20T00:00:00Z'), numeric: 100, value: envelope(100), fetchedAt: new Date('2026-10-20T01:00:00Z') },
      { accountId: 'a1', metric: 'reach', period: 'day', endTime: new Date('2026-10-20T00:00:00Z'), numeric: 110, value: envelope(110), fetchedAt: new Date('2026-10-20T02:00:00Z') },
      { accountId: 'a1', metric: 'views', period: 'day', endTime: new Date('2026-10-21T00:00:00Z'), numeric: null, value: envelope({ city: 1 }), fetchedAt: new Date('2026-10-21T02:00:00Z') },
    ];
    const rows = await computeInstagramDailyRollups({ workspaceId: 'w1', targetIds: ['t1'], from: new Date('2026-10-20T00:00:00Z'), to: new Date('2026-10-22T00:00:00Z') });
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.metric === 'views')).toMatchObject({ day: '2026-10-20', kind: 'flow', value: 10, samples: 2, targetId: 't1' });
    expect(rows.find(row => row.metric === 'reach')).toMatchObject({ day: '2026-10-20', kind: 'stock', value: 110, samples: 2, targetId: 't1' });
  });

  it('keeps older rows without a series envelope as non-additive stocks', async () => {
    state.insights = [
      { accountId: 'a1', metric: 'views', period: 'day', endTime: new Date('2026-10-20T00:00:00Z'), numeric: 4, value: 4, fetchedAt: new Date('2026-10-20T01:00:00Z') },
      { accountId: 'a1', metric: 'views', period: 'day', endTime: new Date('2026-10-20T00:00:00Z'), numeric: 9, value: 9, fetchedAt: new Date('2026-10-20T02:00:00Z') },
    ];
    const rows = await computeInstagramDailyRollups({ workspaceId: 'w1', targetIds: ['t1'], from: new Date('2026-10-20T00:00:00Z'), to: new Date('2026-10-21T00:00:00Z') });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'stock', value: 9, samples: 2 });
  });

  it('ignores accounts that do not match the selected channel binding', async () => {
    state.accounts = [{ id: 'a1', targetId: 't1', igUserId: 'other', socialAccountId: 'sa1' }];
    state.insights = [{ accountId: 'a1', metric: 'views', period: 'day', endTime: new Date('2026-10-20T00:00:00Z'), numeric: 5, value: envelope(5), fetchedAt: new Date('2026-10-20T01:00:00Z') }];
    await expect(computeInstagramDailyRollups({ workspaceId: 'w1', targetIds: ['t1'], from: new Date(), to: new Date() })).resolves.toEqual([]);
  });

  it('reads stored insights only for the requested workspace channels', async () => {
    await expect(computeInstagramDailyRollups({ workspaceId: 'w1', targetIds: [], from: new Date(), to: new Date() })).resolves.toEqual([]);
  });
});

describe('Instagram unrolled breakdown guard', () => {
  it('detects non-numeric day rows that need detailed reads', async () => {
    const input = { workspaceId: 'w1', targetIds: ['t1'], from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-10-22T00:00:00Z') };
    expect(await hasUnrolledInstagramDayBreakdowns(input)).toBe(false);
    state.breakdowns = true;
    expect(await hasUnrolledInstagramDayBreakdowns(input)).toBe(true);
    expect(await hasUnrolledInstagramDayBreakdowns({ ...input, targetIds: [] })).toBe(false);
  });
});
