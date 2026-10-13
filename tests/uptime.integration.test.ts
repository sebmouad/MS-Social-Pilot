import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Uptime history for the root status page. */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let uptime: typeof import('../src/lib/uptime');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('uptime');
  ({ prisma } = await import('../src/lib/prisma'));
  uptime = await import('../src/lib/uptime');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.uptimeDay.deleteMany();
  await prisma.workerHeartbeat.deleteMany();
});

describe('uptime', () => {
  it('counts the worker only while its heartbeat is fresh', async () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    await uptime.recordUptimeMinute(now);
    await prisma.workerHeartbeat.create({ data: { workerId: 'w1', seenAt: new Date(now - 30_000), jobs: [] } });
    await uptime.recordUptimeMinute(now);
    const rows = await prisma.uptimeDay.findMany({ orderBy: { component: 'asc' } });
    expect(rows.map((row) => [row.component, row.minutes])).toEqual([
      ['app', 2],
      ['worker', 1],
    ]);
  });

  it('turns minutes into daily shares, with no data before counting began', async () => {
    const now = Date.parse('2026-10-12T12:00:00Z');
    await prisma.uptimeDay.createMany({
      data: [
        { day: '2026-10-10', component: 'app', minutes: 600 }, // First day: counted from its first minute.
        { day: '2026-10-10', component: 'worker', minutes: 300 },
        { day: '2026-10-11', component: 'app', minutes: 1440 },
        { day: '2026-10-11', component: 'worker', minutes: 1368 },
        { day: '2026-10-12', component: 'app', minutes: 720 },
      ],
    });
    const history = await uptime.loadUptime(now);
    expect(history.days).toHaveLength(uptime.UPTIME_DAYS);
    expect(history.days[0]).toMatchObject({ app: null, worker: null });
    expect(history.days.slice(-3)).toEqual([
      { day: '2026-10-10', app: 1, worker: 0.5 },
      { day: '2026-10-11', app: 1, worker: 0.95 },
      { day: '2026-10-12', app: 1, worker: 0 },
    ]);
    expect(history.overall.app).toBe(1);
    expect(history.overall.worker).toBeCloseTo((300 + 1368) / (600 + 1440 + 720));
  });
});
