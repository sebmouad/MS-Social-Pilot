import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Self-hosted error tracking: scrubbed, grouped, pruned. */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let tracking: typeof import('../src/lib/error-tracking');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('error_tracking');
  ({ prisma } = await import('../src/lib/prisma'));
  tracking = await import('../src/lib/error-tracking');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.errorEvent.deleteMany();
});

describe('scrub', () => {
  it('takes out tokens, secrets, credentials and email addresses', () => {
    const text = tracking.scrub(
      'GET https://graph.facebook.com/v23.0/me?access_token=EAAB12345678901234567890xyz&fields=id failed for owner@example.com ' +
        'Bearer abc.def.ghi {"password":"hunter2"} key sk-ant-abcdefghijklmnop1234',
    );
    expect(text).not.toMatch(/EAAB|owner@example|abc\.def|hunter2|sk-ant/);
    expect(text).toContain('access_token=[scrubbed]');
    expect(text).toContain('[email]');
    expect(text).toContain('Bearer [scrubbed]');
  });

  it('drops query strings from locations', () => {
    expect(tracking.cleanLocation('/compose?text=private#x')).toBe('/compose');
    expect(tracking.cleanLocation(null)).toBeNull();
  });
});

describe('recordError', () => {
  it('groups the same error with different ids and reopens a resolved one', async () => {
    const make = (id: string) => {
      const error = new Error(`Post ${id} failed after 3 attempts`);
      error.stack = `Error: Post ${id} failed\n    at publish (/app/src/lib/publish.ts:10:5)`;
      return error;
    };
    await tracking.recordError({ source: 'worker', error: make('clx1234567890abcdefghij'), location: 'publish' });
    await prisma.errorEvent.updateMany({ data: { resolvedAt: new Date() } });
    await tracking.recordError({ source: 'worker', error: make('clx0987654321zyxwvutsrq'), location: 'publish' });
    await tracking.recordError({ source: 'server', error: 'plain text', location: '/api/posts?x=1' });

    const rows = await prisma.errorEvent.findMany({ orderBy: { source: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ source: 'server', message: 'plain text', location: '/api/posts', release: 'dev' });
    expect(rows[1]).toMatchObject({ source: 'worker', count: 2, resolvedAt: null, location: 'publish' });
  });

  it('forgets errors not seen for the retention period', async () => {
    await tracking.recordError({ source: 'server', error: new Error('old') });
    await prisma.errorEvent.updateMany({ data: { lastSeenAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) } });
    await tracking.recordError({ source: 'server', error: new Error('new') });
    expect(await tracking.pruneErrors()).toBe(1);
    expect(await prisma.errorEvent.count()).toBe(1);
  });
});
