import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Best time per Page, automatically: once a week, for
 * workspaces that chose "apply", each Page's strongest new times go into its
 * own queue, and the history says so.
 */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let applyBestTimes: typeof import('../src/lib/best-times')['applyBestTimes'];

const now = new Date('2026-11-02T09:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('best_times');
  ({ prisma } = await import('../src/lib/prisma'));
  ({ applyBestTimes } = await import('../src/lib/best-times'));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.queueSlot.deleteMany();
  await prisma.externalPost.deleteMany();
  await prisma.target.deleteMany();
  await prisma.workspace.deleteMany();
});

/** A Page whose Tuesday-evening posts do far better than the rest. */
async function seed(mode: 'suggest' | 'apply') {
  const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${mode}-${Date.now()}`, bestTimeMode: mode } });
  const target = await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: 'page-1', name: 'Client A Page' } });
  const posts: Array<[string, number]> = [
    ['2026-10-27T18:30:00Z', 50],
    ['2026-10-20T18:45:00Z', 60],
    ['2026-10-21T10:00:00Z', 10],
    ['2026-10-22T10:00:00Z', 10],
    ['2026-10-23T10:00:00Z', 10],
    ['2026-10-24T10:00:00Z', 10],
  ];
  await prisma.externalPost.createMany({
    data: posts.map(([at, reactions], index) => ({
      targetId: target.id,
      remoteId: `post-${index}`,
      createdTime: new Date(at),
      insights: { reactions, comments: 0, shares: 0 },
    })),
  });
  return { workspace, target };
}

describe('applyBestTimes', () => {
  it('adds the Page’s best new time once a week and logs it', async () => {
    const { workspace, target } = await seed('apply');

    const added = await applyBestTimes(now);
    expect(added).toHaveLength(1);
    const slots = await prisma.queueSlot.findMany({ where: { workspaceId: workspace.id } });
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ targetId: target.id, dayOfWeek: 2, hour: 18 });
    expect(await prisma.activityLog.count({ where: { workspaceId: workspace.id, action: 'queue.bestTimesAdded' } })).toBe(1);

    // Same week: not looked at again. Next week: the time is already covered.
    expect(await applyBestTimes(new Date(now.getTime() + DAY))).toEqual([]);
    expect(await applyBestTimes(new Date(now.getTime() + 8 * DAY))).toEqual([]);
    expect(await prisma.queueSlot.count({ where: { workspaceId: workspace.id } })).toBe(1);
  });

  it('leaves a workspace that only wants suggestions alone', async () => {
    const { workspace } = await seed('suggest');
    expect(await applyBestTimes(now)).toEqual([]);
    expect(await prisma.queueSlot.count({ where: { workspaceId: workspace.id } })).toBe(0);
  });
});
