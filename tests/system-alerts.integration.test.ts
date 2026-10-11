import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Root's alerts: one message when an incident opens, one when it clears, nothing in between. */

const sent: string[] = [];
vi.mock('../src/lib/email/send', () => ({
  sendEmail: async (options: { subject: string }) => {
    sent.push(options.subject);
    return { status: 'sent' };
  },
}));

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let alerts: typeof import('../src/lib/system-alerts');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('alerts');
  ({ prisma } = await import('../src/lib/prisma'));
  alerts = await import('../src/lib/system-alerts');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  sent.length = 0;
  await prisma.systemAlert.deleteMany();
  await prisma.workerHeartbeat.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({ data: { email: 'root@example.test', name: 'Root', passwordHash: 'x', isInstanceOwner: true } });
});

describe('incidents', () => {
  it('alert once when opened, stay quiet while open, say "fixed" once when cleared', async () => {
    const firing = { key: 'disk.full' as const, firing: true, params: { percent: 91 } };
    await alerts.applyChecks([firing]);
    await alerts.applyChecks([firing]);
    expect(sent).toHaveLength(1);
    expect(await prisma.systemAlert.count({ where: { resolvedAt: null } })).toBe(1);

    await alerts.applyChecks([{ ...firing, firing: false }]);
    await alerts.applyChecks([{ ...firing, firing: false }]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/^Fixed: /);
    expect(await prisma.systemAlert.count({ where: { resolvedAt: null } })).toBe(0);
  });

  it('the worker check fires only after five quiet minutes', async () => {
    const now = Date.now();
    await prisma.workerHeartbeat.create({
      data: { workerId: 'w1', seenAt: new Date(now - 4 * 60_000), jobs: [] },
    });
    expect((await alerts.checkWorker(now)).firing).toBe(false);
    expect((await alerts.checkWorker(now + 2 * 60_000)).firing).toBe(true);
  });

  it('no heartbeat ever is not an alert: the worker was never started here', async () => {
    expect((await alerts.checkWorker()).firing).toBe(false);
  });
});
