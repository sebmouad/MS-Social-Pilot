import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * `GET /api/health`: what a load balancer, an uptime monitor and Docker see.
 *
 * Two promises are held here. The status code is the web container's own
 * health and nothing else — a stopped worker must not get `web` restarted, or
 * hold up a first boot in which the worker waits for `web`. And the body, which
 * anyone who can reach the port can read, carries a heartbeat age and no more.
 */

let database: TestDatabase;
type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let GET: typeof import('../src/app/api/health/route')['GET'];

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('healthroute');
  ({ prisma } = await import('../src/lib/prisma'));
  ({ GET } = await import('../src/app/api/health/route'));
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.workerHeartbeat.deleteMany();
});

async function probe() {
  const response = await GET();
  return { status: response.status, body: await response.json() };
}

describe('GET /api/health', () => {
  it('is healthy with no worker at all, and says the worker is missing', async () => {
    const { status, body } = await probe();

    expect(status).toBe(200);
    expect(body).toEqual({ status: 'ok', worker: { status: 'missing', lastBeatSeconds: null } });
  });

  it('reports a worker that beat a moment ago', async () => {
    await prisma.workerHeartbeat.create({
      data: { workerId: 'web-1234', seenAt: new Date(Date.now() - 10_000), jobs: ['publish'] },
    });

    const { status, body } = await probe();

    expect(status).toBe(200);
    expect(body.worker.status).toBe('ok');
    expect(body.worker.lastBeatSeconds).toBeGreaterThanOrEqual(9);
    expect(body.worker.lastBeatSeconds).toBeLessThan(60);
  });

  it('stays 200 when the worker has gone quiet, and says so in the body', async () => {
    await prisma.workerHeartbeat.create({
      data: { workerId: 'gone', seenAt: new Date(Date.now() - 60 * 60 * 1000), jobs: [] },
    });

    const { status, body } = await probe();

    expect(status).toBe(200);
    expect(body.worker.status).toBe('stale');
    expect(body.worker.lastBeatSeconds).toBeGreaterThanOrEqual(3599);
  });

  it('reads the newest heartbeat across several workers', async () => {
    await prisma.workerHeartbeat.createMany({
      data: [
        { workerId: 'stopped', seenAt: new Date(Date.now() - 60 * 60 * 1000), jobs: [] },
        { workerId: 'running', seenAt: new Date(), jobs: ['publish'] },
      ],
    });

    expect((await probe()).body.worker.status).toBe('ok');
  });

  it('never names a worker or its jobs', async () => {
    await prisma.workerHeartbeat.create({
      data: { workerId: 'internal-host-9f8e-4242', seenAt: new Date(), jobs: ['publish', 'rss'] },
    });

    const text = JSON.stringify((await probe()).body);
    expect(text).not.toContain('internal-host');
    expect(text).not.toContain('publish');
    expect(Object.keys((await probe()).body.worker).sort()).toEqual(['lastBeatSeconds', 'status']);
  });
});
