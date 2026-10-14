import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * The analysis against a database: which posts it reads, which Page figures,
 * and whose.
 *
 * Also the three places the older analytics views read the wrong thing, fixed
 * alongside it: interactions that ignored every post made in Facebook itself,
 * follower gains read from a metric Meta withdrew, and a running total of
 * followers summed as if it were daily activity.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let data: typeof import('../src/lib/page-analysis-data');
let analytics: typeof import('../src/lib/analytics');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-06-30T12:00:00Z');
const FROM = new Date(NOW.getTime() - 30 * DAY);

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('page_analysis');

  ({ prisma } = await import('../src/lib/prisma'));
  data = await import('../src/lib/page-analysis-data');
  analytics = await import('../src/lib/analytics');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.pageInsight.deleteMany();
  await prisma.externalPost.deleteMany();
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.target.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

async function seed() {
  const user = await prisma.user.create({
    data: { email: `o-${randomBytes(3).toString('hex')}@example.com`, name: 'Owner', passwordHash: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: { name: 'Client', slug: `c-${randomBytes(3).toString('hex')}`, timezone: 'UTC' },
  });
  const page = await prisma.target.create({
    data: {
      workspaceId: workspace.id,
      type: 'page',
      providerId: randomBytes(4).toString('hex'),
      name: 'Bakery',
      followersCount: 1000,
    },
  });
  return { user, workspace, page };
}

function insights(reactions: number, reach: number | null = 1000) {
  return { impressions: null, reach, engagedUsers: null, reactions, comments: 2, shares: 1, clicks: 5 };
}

describe('loadPagePosts', () => {
  it('reads posts made on the Page and posts published from here, as one list', async () => {
    const { user, workspace, page } = await seed();

    await prisma.externalPost.create({
      data: {
        targetId: page.id,
        remoteId: 'ext-1',
        message: 'From the Facebook app',
        statusType: 'added_video',
        createdTime: new Date(NOW.getTime() - 3 * DAY),
        insights: insights(40),
      },
    });
    await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        message: 'From the composer',
        link: 'https://example.com',
        status: 'published',
        targets: {
          create: {
            targetId: page.id,
            status: 'published',
            publishedAt: new Date(NOW.getTime() - 2 * DAY),
            insights: insights(10, null),
          },
        },
      },
    });

    const posts = await data.loadPagePosts(page.id, FROM, NOW);

    expect(posts.map((post) => [post.source, post.format, post.interactions])).toEqual([
      ['page', 'video', 43],
      ['app', 'link', 13],
    ]);
    // No reach, no rate — rather than a rate against zero.
    expect(posts[1]!.rate).toBeNull();
  });
});

describe('loadPageTotals', () => {
  it('reads follows from whichever metric this Page actually holds', async () => {
    const { page } = await seed();
    const day = (offset: number) => new Date(NOW.getTime() - offset * DAY);

    // Only the newer name, as on any Page connected since Meta's switch.
    for (const offset of [1, 2, 3]) {
      await prisma.pageInsight.create({
        data: { targetId: page.id, metric: 'page_daily_follows_unique', period: 'day', endTime: day(offset), value: 4, numeric: 4 },
      });
    }
    await prisma.pageInsight.create({
      data: { targetId: page.id, metric: 'page_daily_unfollows_unique', period: 'day', endTime: day(1), value: 2, numeric: 2 },
    });

    const [totals] = await data.loadPageTotals(page.id, [{ from: FROM, to: NOW }]);
    expect(totals).toMatchObject({ follows: 12, unfollows: 2, reach: null });
  });

  it('reads reach across the July 2026 switch to viewers, counting each day once', async () => {
    const { page } = await seed();
    const day = (offset: number) => new Date(NOW.getTime() - offset * DAY);
    const row = (metric: string, offset: number, value: number) => ({
      targetId: page.id,
      metric,
      period: 'day',
      endTime: day(offset),
      value,
      numeric: value,
    });

    await prisma.pageInsight.createMany({
      data: [
        // Before the switch: reach only.
        row('page_impressions_unique', 5, 100),
        row('page_impressions_unique', 4, 100),
        // A day synced under both names is counted once, from the new one.
        row('page_impressions_unique', 3, 999),
        row('page_total_media_view_unique', 3, 300),
        // After the switch: viewers only.
        row('page_total_media_view_unique', 2, 300),
      ],
    });

    const [totals] = await data.loadPageTotals(page.id, [{ from: FROM, to: NOW }]);
    expect(totals!.reach).toBe(100 + 100 + 300 + 300);
  });

  it('ignores anything that is not a daily figure', async () => {
    const { page } = await seed();
    await prisma.pageInsight.create({
      data: { targetId: page.id, metric: 'page_impressions_unique', period: 'day', endTime: new Date(NOW.getTime() - DAY), value: 100, numeric: 100 },
    });
    await prisma.pageInsight.create({
      data: { targetId: page.id, metric: 'page_impressions_unique', period: 'days_28', endTime: new Date(NOW.getTime() - DAY), value: 9999, numeric: 9999 },
    });

    const [totals] = await data.loadPageTotals(page.id, [{ from: FROM, to: NOW }]);
    expect(totals!.reach).toBe(100);
  });
});

describe('analysePage', () => {
  it('refuses a Page from another workspace', async () => {
    const { page } = await seed();
    const other = await seed();

    await expect(
      data.analysePage({ workspaceId: other.workspace.id, targetId: page.id, from: FROM, to: NOW, timeZone: 'UTC', now: NOW }),
    ).rejects.toThrow(/not found/i);
  });

  it('compares with the period before, and knows when figures were last read', async () => {
    const { page } = await seed();
    const syncedAt = new Date(NOW.getTime() - 3 * DAY);

    await prisma.externalPost.createMany({
      data: [
        { targetId: page.id, remoteId: 'now-1', statusType: 'added_photos', createdTime: new Date(NOW.getTime() - 5 * DAY), insights: insights(97), insightsSyncedAt: syncedAt },
        { targetId: page.id, remoteId: 'before-1', statusType: 'added_photos', createdTime: new Date(FROM.getTime() - 5 * DAY), insights: insights(47), insightsSyncedAt: syncedAt },
      ],
    });

    const result = await data.analysePage({ workspaceId: page.workspaceId, targetId: page.id, from: FROM, to: NOW, timeZone: 'UTC', now: NOW });

    expect(result.kpis.find((kpi) => kpi.key === 'avgInteractions')).toMatchObject({ current: 100, previous: 50, change: 100 });
    expect(result.lastSyncedAt?.toISOString()).toBe(syncedAt.toISOString());
    expect(result.findings.find((finding) => finding.key === 'stale')?.params.days).toBe(3);
  });
});

describe('comparePages', () => {
  it('lists every Page in the workspace, and only those', async () => {
    const { workspace } = await seed();
    await prisma.target.create({
      data: { workspaceId: workspace.id, type: 'page', providerId: 'second', name: 'Another' },
    });
    await seed();

    const rows = await data.comparePages({ workspaceId: workspace.id, from: FROM, to: NOW, timeZone: 'UTC' });
    expect(rows.map((row) => row.name)).toEqual(['Another', 'Bakery']);
  });

  it('uses a nearby stored follower snapshot for the comparison, not inferred growth', async () => {
    const { workspace, page } = await seed();
    await prisma.pageInsight.createMany({ data: [
      { targetId: page.id, metric: 'page_follows', period: 'day', endTime: new Date(FROM.getTime() - 2 * DAY), value: 970, numeric: 970 },
      { targetId: page.id, metric: 'page_follows', period: 'day', endTime: new Date(FROM.getTime() - DAY), value: 980, numeric: 980 },
      { targetId: page.id, metric: 'page_follows', period: 'day', endTime: new Date(FROM.getTime() + DAY), value: 990, numeric: 990 },
    ] });
    const [row] = await data.comparePages({ workspaceId: workspace.id, from: FROM, to: NOW, timeZone: 'UTC' });
    expect(row?.followers).toBe(1000);
    expect(row?.previous.followers).toBe(980);
  });

  it('withholds old or like-count snapshots from follower comparison', async () => {
    const { workspace, page } = await seed();
    await prisma.pageInsight.create({ data: {
      targetId: page.id, metric: 'page_follows', period: 'day',
      endTime: new Date(FROM.getTime() - 20 * DAY), value: 900, numeric: 900,
    } });
    let [row] = await data.comparePages({ workspaceId: workspace.id, from: FROM, to: NOW, timeZone: 'UTC' });
    expect(row?.previous.followers).toBeNull();
    await prisma.target.update({ where: { id: page.id }, data: { followersCount: null, fanCount: 1000 } });
    await prisma.pageInsight.create({ data: {
      targetId: page.id, metric: 'page_follows', period: 'day',
      endTime: new Date(FROM.getTime() - DAY), value: 980, numeric: 980,
    } });
    [row] = await data.comparePages({ workspaceId: workspace.id, from: FROM, to: NOW, timeZone: 'UTC' });
    expect(row?.previous.followers).toBeNull();
  });
});

describe('the older views, corrected', () => {
  it('counts interactions on posts made in Facebook itself', async () => {
    const { workspace, page } = await seed();
    await prisma.externalPost.create({
      data: {
        targetId: page.id,
        remoteId: 'ext',
        createdTime: new Date(NOW.getTime() - DAY),
        insights: { ...insights(30), reactionsByType: { like: 20, love: 10 } },
      },
    });

    const summary = await analytics.readInteractions({ workspaceId: workspace.id, targetId: page.id, from: FROM, to: NOW });
    expect(summary.totals.reactions).toBe(30);
    expect(summary.reactionsByType).toMatchObject({ like: 20, love: 10 });
  });

  it('gives each post an engagement rate from interactions, not the retired engaged-users metric', async () => {
    const { user, workspace, page } = await seed();
    await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        message: 'Hello',
        status: 'published',
        targets: {
          create: {
            targetId: page.id,
            status: 'published',
            publishedAt: new Date(NOW.getTime() - DAY),
            // Reach 1,000; 40 reactions, 8 comments, 2 shares; no engaged users.
            insights: { impressions: null, reach: 1000, engagedUsers: null, reactions: 40, comments: 8, shares: 2, clicks: 5 },
          },
        },
      },
    });

    const [row] = await analytics.readPostAnalytics({ workspaceId: workspace.id, targetId: page.id, from: FROM, to: NOW });
    expect(row!.engagementRate).toBe(5);
  });

  it('reads gained and lost followers from the metrics Meta still serves', async () => {
    const { page } = await seed();
    await prisma.pageInsight.createMany({
      data: [
        { targetId: page.id, metric: 'page_daily_follows_unique', period: 'day', endTime: new Date(NOW.getTime() - DAY), value: 9, numeric: 9 },
        { targetId: page.id, metric: 'page_daily_unfollows_unique', period: 'day', endTime: new Date(NOW.getTime() - DAY), value: 3, numeric: 3 },
      ],
    });

    const audience = await analytics.readAudience({ targetId: page.id, from: FROM, to: NOW });
    expect(audience).toMatchObject({ adds: 9, removes: 3, net: 6 });
  });

  it('shows the latest follower total rather than a month of totals added up', async () => {
    const { page } = await seed();
    await prisma.pageInsight.createMany({
      data: [1000, 1010, 1025].map((value, index) => ({
        targetId: page.id,
        metric: 'page_follows',
        period: 'day',
        endTime: new Date(NOW.getTime() - (3 - index) * DAY),
        value,
        numeric: value,
      })),
    });

    const series = await analytics.readStoredAnalytics({ targetId: page.id, from: FROM, to: NOW });
    expect(series.find((entry) => entry.metric === 'page_follows')?.total).toBe(1025);
  });
});
