import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * The dashboard's reads against a database: which posts head "Recently
 * published", totals that survive a value that is not a whole number, and the
 * audience breakdowns read in one query.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let analytics: typeof import('../src/lib/analytics');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('analytics_dashboard');

  ({ prisma } = await import('../src/lib/prisma'));
  analytics = await import('../src/lib/analytics');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.pageInsight.deleteMany();
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
    },
  });
  return { user, workspace, page };
}

async function post(
  context: Awaited<ReturnType<typeof seed>>,
  options: { message: string; status: 'published' | 'failed'; publishedAt: Date | null; insights?: object },
) {
  return prisma.post.create({
    data: {
      workspaceId: context.workspace.id,
      authorId: context.user.id,
      message: options.message,
      status: options.status,
      publishedAt: options.publishedAt,
      targets: {
        create: {
          targetId: context.page.id,
          status: options.status,
          ...(options.insights ? { insights: options.insights } : {}),
        },
      },
    },
  });
}

describe('recentOutcomes', () => {
  it('puts posts that never went out after the ones that did', async () => {
    const context = await seed();

    // Created last, so under the old NULLS FIRST ordering it headed the list.
    await post(context, { message: 'Older', status: 'published', publishedAt: new Date('2026-06-01T09:00:00Z') });
    await post(context, { message: 'Newer', status: 'published', publishedAt: new Date('2026-06-02T09:00:00Z') });
    await post(context, { message: 'Never sent', status: 'failed', publishedAt: null });

    const rows = await analytics.recentOutcomes(context.workspace.id);
    expect(rows.map((row) => row.message)).toEqual(['Newer', 'Older', 'Never sent']);
  });
});

describe('publishedTotals', () => {
  it('sums values stored as decimals or text instead of throwing', async () => {
    const context = await seed();

    await post(context, {
      message: 'Whole',
      status: 'published',
      publishedAt: new Date(),
      insights: { impressions: null, reach: 100, reactions: 3, comments: 2 },
    });
    await post(context, {
      message: 'Odd shapes',
      status: 'published',
      publishedAt: new Date(),
      // A decimal, a numeric string, a breakdown object and junk: the first
      // two count, the last two count as nothing. `::bigint` threw on all but
      // the second.
      insights: { impressions: '40', reach: 12.5, reactions: { like: 4 }, comments: 'n/a' },
    });

    const totals = await analytics.publishedTotals(context.workspace.id);
    expect(totals).toEqual({ impressions: 40, reach: 113, reactions: 3, comments: 2, posts: 2 });
  });

  it('reads zero, not null, for a workspace with nothing published', async () => {
    const { workspace } = await seed();
    const totals = await analytics.publishedTotals(workspace.id);
    expect(totals).toEqual({ impressions: 0, reach: 0, reactions: 0, comments: 0, posts: 0 });
  });
});

describe('readAudience', () => {
  it('retains historical likes provenance and never invents missing growth', async () => {
    const { page } = await seed();
    const from = new Date('2026-06-01T00:00:00Z');
    const to = new Date('2026-06-30T23:59:59Z');
    const empty = await analytics.readAudience({ targetId: page.id, from, to });
    expect(empty).toMatchObject({ adds: null, removes: null, net: null, addsMetric: null, removesMetric: null });
    await prisma.pageInsight.createMany({ data: [
      { targetId: page.id, metric: 'page_fan_adds_unique', period: 'day', endTime: new Date('2026-06-15T00:00:00Z'), value: 9, numeric: 9 },
      { targetId: page.id, metric: 'page_daily_unfollows_unique', period: 'day', endTime: new Date('2026-06-15T00:00:00Z'), value: 3, numeric: 3 },
    ] });
    const mixed = await analytics.readAudience({ targetId: page.id, from, to });
    expect(mixed).toMatchObject({ adds: 9, removes: 3, net: null, addsMetric: 'page_fan_adds_unique', removesMetric: 'page_daily_unfollows_unique' });
    await prisma.pageInsight.create({ data: { targetId: page.id, metric: 'page_daily_follows_unique', period: 'day', endTime: new Date('2026-06-15T00:00:00Z'), value: 0, numeric: 0 } });
    const current = await analytics.readAudience({ targetId: page.id, from, to });
    expect(current).toMatchObject({ adds: 0, removes: 3, net: -3, addsMetric: 'page_daily_follows_unique' });
  });

  it('takes the newest snapshot of the newest metric name that has one', async () => {
    const { page } = await seed();
    const at = (day: number) => new Date(Date.UTC(2026, 5, day));

    await prisma.pageInsight.createMany({
      data: [
        // The retired name, newer than anything under the new one: still
        // loses, because the new name is preferred whenever it has data.
        { targetId: page.id, metric: 'page_fans_country', period: 'lifetime', endTime: at(20), value: { FR: 1 } },
        { targetId: page.id, metric: 'page_follows_country', period: 'lifetime', endTime: at(5), value: { FR: 5 } },
        { targetId: page.id, metric: 'page_follows_country', period: 'lifetime', endTime: at(10), value: { FR: 9 } },
        // Only the old name for cities: it is the fallback.
        { targetId: page.id, metric: 'page_fans_city', period: 'lifetime', endTime: at(10), value: { Paris: 3 } },
      ],
    });

    const audience = await analytics.readAudience({ targetId: page.id, from: at(1), to: at(30) });
    expect(audience.byCountry).toEqual({ FR: 9 });
    expect(audience.byCity).toEqual({ Paris: 3 });
    expect(audience.byLocale).toEqual({});
  });
});
