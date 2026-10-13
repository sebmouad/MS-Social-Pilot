import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Requests per workspace: one workspace's members share a
 * budget per minute, and running it out does not touch any other workspace.
 */
const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let auth: typeof import('../src/lib/auth');
let settings: typeof import('../src/lib/settings');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('workspace_limit');
  ({ prisma } = await import('../src/lib/prisma'));
  auth = await import('../src/lib/auth');
  settings = await import('../src/lib/settings');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  cookieJar.clear();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
  await settings.writeSetting('auth.openRegistration', true, null);
  await settings.ensureSettings();
});

let n = 0;
async function signUp() {
  n += 1;
  const { token } = await auth.registerUser({ email: `person-${n}-${Date.now()}@example.com`, password: 'a-long-enough-password', name: 'Sam' });
  return token;
}

describe('requests per workspace', () => {
  it('refuses the call over the limit with a 429, and only for that workspace', async () => {
    await settings.writeSetting('limits.workspaceRequestsPerMinute', 3, null);
    await settings.ensureSettings();
    const busy = await signUp();
    const other = await signUp();

    cookieJar.set('msp_session', busy);
    for (let i = 0; i < 3; i += 1) await auth.requireAuth();
    await expect(auth.requireAuth()).rejects.toMatchObject({ status: 429, key: 'errors.workspaceBusy' });

    cookieJar.set('msp_session', other);
    await expect(auth.requireAuth()).resolves.toBeTruthy();
  });

  it('0 turns the limit off', async () => {
    await settings.writeSetting('limits.workspaceRequestsPerMinute', 0, null);
    await settings.ensureSettings();
    cookieJar.set('msp_session', await signUp());
    for (let i = 0; i < 20; i += 1) await auth.requireAuth();
  });
});
