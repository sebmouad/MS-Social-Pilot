import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Goals per Page (NEXT_PHASES H12): targets stay inside the member's Pages,
 * and progress is read from stored insights and posts.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let goals: typeof import('../src/lib/page-goals');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('page_goals');
  ({ prisma } = await import('../src/lib/prisma'));
  goals = await import('../src/lib/page-goals');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.workspace.deleteMany();
});

async function seed() {
  const stamp = `${Date.now()}-${Math.random()}`;
  const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${stamp}`, timezone: 'UTC' } });
  const page = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: `a-${stamp}`, name: 'Page A' } });
  const other = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: `b-${stamp}`, name: 'Page B' } });
  return { workspace, page, other };
}

const day = (date: string) => new Date(`${date}T08:00:00Z`);

describe('page goals', () => {
  it('works out the month in the workspace time zone', () => {
    const window = goals.monthWindow(new Date('2026-11-30T23:30:00Z'), 'Asia/Tokyo');
    expect(window.month).toBe('2026-12');
    expect(window.start.toISOString()).toBe('2026-11-30T15:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-12-31T15:00:00.000Z');
  });

  it('refuses a Page outside the member’s scope and clears a goal set to null', async () => {
    const { workspace, page, other } = await seed();
    const limited = { all: false as const, ids: [page.id] };
    await expect(goals.saveGoals(workspace.id, limited, { targetId: other.id, goals: { posts: 10 } })).rejects.toMatchObject({ status: 404 });

    await goals.saveGoals(workspace.id, limited, { targetId: page.id, goals: { posts: 10, followers: 50 } });
    await goals.saveGoals(workspace.id, limited, { targetId: page.id, goals: { followers: null, views: 1000 } });
    expect(await goals.goalsOf(workspace.id, limited, page.id)).toEqual({ posts: 10, views: 1000 });
    await expect(goals.goalsOf(workspace.id, limited, other.id)).rejects.toMatchObject({ status: 404 });
  });

  it('reads progress from stored insights and posts, with the pace', async () => {
    const { workspace, page, other } = await seed();
    await goals.saveGoals(workspace.id, { all: true }, { targetId: page.id, goals: { followers: 20, views: 100, engagements: 10, posts: 4 } });
    const insight = (metric: string, date: string, numeric: number) =>
      prisma.pageInsight.create({ data: { targetId: page.id, metric, period: 'day', endTime: new Date(`${date}T07:00:00Z`), value: numeric, numeric } });
    await insight('page_daily_follows_unique', '2026-11-03', 12);
    await insight('page_daily_unfollows_unique', '2026-11-03', 2);
    await insight('page_media_view', '2026-11-03', 30);
    await insight('page_impressions', '2026-11-03', 999); // same day, older name: not counted twice
    await insight('page_media_view', '2026-10-20', 500); // last month
    await insight('page_post_engagements', '2026-11-04', 3);
    await prisma.externalPost.create({ data: { targetId: page.id, remoteId: `x-${Date.now()}`, createdTime: day('2026-11-02') } });

    const result = await goals.readGoals({
      workspaceId: workspace.id,
      targetIds: [page.id, other.id],
      timeZone: 'UTC',
      now: new Date('2026-11-16T00:00:00Z'),
    });
    expect(result).toEqual([
      {
        targetId: page.id,
        name: 'Page A',
        month: '2026-11',
        goals: [
          { metric: 'followers', target: 20, actual: 10, pace: 'onTrack' },
          { metric: 'views', target: 100, actual: 30, pace: 'behind' },
          { metric: 'engagements', target: 10, actual: 3, pace: 'behind' },
          { metric: 'posts', target: 4, actual: 1, pace: 'behind' },
        ],
      },
    ]);
  });
});
