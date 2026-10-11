import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Metrics pinned from Overview: which may be pinned, and how they add up over several profiles. */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let pinned: typeof import('../src/lib/pinned-metrics');
const ids: string[] = [];

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('pinned_metrics');
  ({ prisma } = await import('../src/lib/prisma'));
  pinned = await import('../src/lib/pinned-metrics');
  const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a', timezone: 'UTC' } });
  for (const key of ['one', 'two']) {
    ids.push((await prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: key, name: key } })).id);
  }
  const day = (n: number) => new Date(Date.UTC(2026, 8, n, 7));
  const rows = [
    [ids[0], 'page_media_view', 1, 10],
    [ids[0], 'page_media_view', 2, 5],
    [ids[1], 'page_media_view', 2, 20],
    [ids[0], 'page_total_media_view_unique', 2, 30],
    [ids[1], 'page_total_media_view_unique', 2, 40],
    [ids[0], 'page_follows', 1, 100],
    [ids[0], 'page_follows', 2, 110],
    [ids[1], 'page_follows', 2, 50],
  ] as const;
  for (const [targetId, metric, n, numeric] of rows) {
    await prisma.pageInsight.create({ data: { targetId: targetId!, metric, period: 'day', endTime: day(n), value: numeric, numeric } });
  }
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

describe('pinned metrics', () => {
  it('only daily Page metrics Meta still serves, as one number, at most eight', () => {
    expect(pinned.isPinnable('page_media_view::day')).toBe(true);
    expect(pinned.isPinnable('page_media_view::week')).toBe(false);
    expect(pinned.isPinnable('page_follows_country::day')).toBe(false);
    expect(pinned.isPinnable('page_impressions::day')).toBe(false);
    expect(pinned.isPinnable('nonsense::day')).toBe(false);
    expect(pinned.cleanPinned(['page_media_view::day', 'page_media_view::day', 'x::day'])).toEqual(['page_media_view::day']);
  });

  it('sums counts over days and profiles, takes the last level, and flags unique people', async () => {
    const figures = await pinned.readPinnedFigures({
      keys: ['page_media_view::day', 'page_total_media_view_unique::day', 'page_follows::day'],
      targetIds: ids,
      from: new Date(Date.UTC(2026, 7, 31)),
      to: new Date(Date.UTC(2026, 8, 3)),
    });
    expect(figures.map((figure) => [figure.key.split('::')[0], figure.value, figure.unique, figure.profiles])).toEqual([
      ['page_media_view', 35, false, 2],
      ['page_total_media_view_unique', 70, true, 2],
      ['page_follows', 160, false, 2],
    ]);
  });
});
