import { beforeAll, expect, it, vi } from 'vitest';
import { setTestEnv } from './helpers/database';
const db = vi.hoisted(() => ({ values: {} as Record<string, number> }));
vi.mock('../src/lib/prisma', () => ({ prisma: {
  $queryRaw: async () => [],
  target: { findUniqueOrThrow: async () => ({ fanCount: null, followersCount: null, talkingAboutCount: null }) },
  pageInsight: {
    findMany: async () => [],
    aggregate: async ({ where }: { where: { metric: string } }) => ({ _count: where.metric in db.values ? 1 : 0, _sum: { numeric: db.values[where.metric] ?? null } }),
  },
} }));
let readAudience: typeof import('../src/lib/analytics').readAudience;
beforeAll(async () => { setTestEnv(); ({ readAudience } = await import('../src/lib/analytics')); });
it('keeps missing values unavailable and historical likes separate from follows', async () => {
  const input = { targetId: 'page', from: new Date('2026-01-01'), to: new Date('2026-01-31') };
  expect(await readAudience(input)).toMatchObject({ adds: null, removes: null, net: null, addsMetric: null });
  db.values = { page_fan_adds_unique: 9, page_daily_unfollows_unique: 3 };
  expect(await readAudience(input)).toMatchObject({ adds: 9, removes: 3, net: null, addsMetric: 'page_fan_adds_unique' });
  db.values.page_daily_follows_unique = 0;
  expect(await readAudience(input)).toMatchObject({ adds: 0, removes: 3, net: -3, addsMetric: 'page_daily_follows_unique' });
});
