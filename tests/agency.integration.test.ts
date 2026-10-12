import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Agency overview for root (NEXT_PHASES H14): each workspace's figures stay its own. */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let agency: typeof import('../src/lib/agency');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('agency');
  ({ prisma } = await import('../src/lib/prisma'));
  agency = await import('../src/lib/agency');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

describe('agency overview', () => {
  it('sums each workspace on its own and sorts unknown figures last', async () => {
    const now = new Date('2026-10-12T12:00:00Z');
    const user = await prisma.user.create({ data: { email: 'owner@example.com', name: 'Owner', passwordHash: 'x' } });
    const a = await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a', timezone: 'UTC' } });
    const b = await prisma.workspace.create({ data: { name: 'Client B', slug: 'client-b', timezone: 'UTC' } });
    const pageA = await prisma.target.create({ data: { workspaceId: a.id, type: 'page', providerId: '1', name: 'Page A', accessToken: 'x' } });
    await prisma.target.create({ data: { workspaceId: a.id, type: 'page', providerId: '2', name: 'Page A2', accessToken: null } });
    await prisma.target.create({ data: { workspaceId: b.id, type: 'page', providerId: '3', name: 'Page B', accessToken: 'x' } });

    const day = (date: string) => new Date(`${date}T07:00:00Z`);
    await prisma.pageInsight.createMany({
      data: [
        { targetId: pageA.id, metric: 'page_daily_follows_unique', period: 'day', endTime: day('2026-10-10'), numeric: 10, value: 10 },
        { targetId: pageA.id, metric: 'page_fan_adds', period: 'day', endTime: day('2026-10-10'), numeric: 99, value: 99 },
        { targetId: pageA.id, metric: 'page_daily_unfollows_unique', period: 'day', endTime: day('2026-10-10'), numeric: 3, value: 3 },
        { targetId: pageA.id, metric: 'page_post_engagements', period: 'day', endTime: day('2026-10-11'), numeric: 40, value: 40 },
        { targetId: pageA.id, metric: 'page_post_engagements', period: 'day', endTime: day('2026-08-01'), numeric: 1000, value: 1000 },
      ],
    });
    await prisma.post.createMany({
      data: [
        { workspaceId: a.id, authorId: user.id, message: 'Product launch', status: 'scheduled' },
        { workspaceId: b.id, authorId: user.id, message: 'Product launch', status: 'failed' },
      ],
    });
    await prisma.aiGeneration.create({
      data: { workspaceId: b.id, userId: user.id, kind: 'generate', prompt: 'p', output: 'o', model: 'm', costUsd: 0.25, createdAt: day('2026-10-01') },
    });

    const rows = await agency.agencyOverview(now);
    const rowA = rows.find((row) => row.id === a.id)!;
    const rowB = rows.find((row) => row.id === b.id)!;
    expect(rowA).toMatchObject({ pages: 2, disconnected: 1, scheduled: 1, failed: 0, followers: 7, engagements: 40, aiSpend: null });
    expect(rowB).toMatchObject({ pages: 1, disconnected: 0, scheduled: 0, failed: 1, followers: null, engagements: null, aiSpend: 0.25 });

    expect(agency.sortAgency(rows, 'engagements', 'asc').map((row) => row.name)).toEqual(['Client A', 'Client B']);
    expect(agency.sortAgency(rows, 'aiSpend', 'desc').map((row) => row.name)).toEqual(['Client B', 'Client A']);
    expect(agency.sortAgency(rows, 'name', 'desc').map((row) => row.name)).toEqual(['Client B', 'Client A']);
  });
});
