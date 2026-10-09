import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * The manual "Pull from Facebook" endpoint.
 *
 * It spends the Pages' Graph allowance — the one the scheduler needs to
 * publish — so it answers to the same rule as the button that calls it
 * (editors and above), and a workspace pressing it repeatedly is told to wait.
 */

const jar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));

let database: TestDatabase;

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('engagementsync');
}, 120_000);

afterAll(async () => {
  const { prisma } = await import('../src/lib/prisma');
  await prisma.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  const { reset } = await import('../src/lib/rate-limit');
  reset();
  jar.clear();
});

async function signInAs(role: 'contributor' | 'editor') {
  const { prisma } = await import('../src/lib/prisma');
  const { createSession } = await import('../src/lib/auth');
  const suffix = Math.random().toString(36).slice(2, 8);

  const user = await prisma.user.create({
    data: { email: `${role}-${suffix}@example.test`, name: role, passwordHash: 'x' },
  });
  await prisma.workspace.create({
    data: {
      name: `Client ${suffix}`,
      slug: `client-${suffix}`,
      timezone: 'UTC',
      memberships: { create: { userId: user.id, role } },
    },
  });
  jar.set('msp_session', await createSession(user.id));
}

async function pull(): Promise<Response> {
  const { POST } = await import('../src/app/api/engagement/sync/route');
  return POST(
    new Request('http://localhost/api/engagement/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
  );
}

describe('POST /api/engagement/sync', () => {
  it('refuses a contributor, who is not shown the button either', async () => {
    await signInAs('contributor');
    expect((await pull()).status).toBe(403);
  });

  it('lets an editor through, then throttles the workspace', async () => {
    await signInAs('editor');

    // No Pages in this workspace, so an allowed pass answers "nothing to
    // refresh" — which is past the role and the throttle.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) statuses.push((await pull()).status);

    expect(statuses).toEqual([404, 404, 404, 429]);
  });
});
