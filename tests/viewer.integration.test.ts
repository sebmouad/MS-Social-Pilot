import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The viewer role (owner approved, 2026-10-12): signed-in API calls that
 * would change the workspace are refused in one place, `requireAuth`.
 */
const cookieJar = new Map<string, string>();
const request = { method: 'GET', path: '/api/posts' };
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: async () => new Headers({ 'x-msp-method': request.method, 'x-msp-pathname': request.path }),
}));

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let auth: typeof import('../src/lib/auth');
let settings: typeof import('../src/lib/settings');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('viewer_role');
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

async function signUpAs(role: 'viewer' | 'contributor' | 'client') {
  const { token, userId } = await auth.registerUser({ email: `${role}-${Date.now()}@example.com`, password: 'a-long-enough-password', name: 'Sam' });
  await prisma.membership.updateMany({ where: { userId }, data: { role } });
  cookieJar.set('msp_session', token);
}

const as = (method: string, path: string) => Object.assign(request, { method, path });

describe('a viewer', () => {
  it('reads, but cannot change the workspace', async () => {
    await signUpAs('viewer');
    as('GET', '/api/posts');
    await expect(auth.requireAuth()).resolves.toMatchObject({ role: 'viewer' });
    as('POST', '/api/posts');
    await expect(auth.requireAuth()).rejects.toMatchObject({ status: 403, key: 'errors.viewerReadOnly' });
    as('PATCH', '/api/account');
    await expect(auth.requireAuth()).resolves.toBeTruthy();
  });

  it('is the only role refused', async () => {
    await signUpAs('contributor');
    as('POST', '/api/posts');
    await expect(auth.requireAuth()).resolves.toMatchObject({ role: 'contributor' });
  });
});

describe('a client', () => {
  it('approves, and cannot write anything else', async () => {
    await signUpAs('client');
    as('POST', '/api/posts/abc/approve');
    await expect(auth.requireAuth()).resolves.toMatchObject({ role: 'client' });
    as('POST', '/api/posts');
    await expect(auth.requireAuth()).rejects.toMatchObject({ status: 403 });
    as('GET', '/compose');
    await expect(auth.requireAuth()).rejects.toMatchObject({ status: 403, key: 'errors.moduleOff' });
  });

  it('gets the media library once the workspace opens it', async () => {
    await signUpAs('client');
    as('POST', '/api/media');
    await expect(auth.requireAuth()).rejects.toMatchObject({ status: 403 });
    await prisma.workspace.updateMany({ data: { clientAccess: ['analytics', 'library'] } });
    await expect(auth.requireAuth()).resolves.toMatchObject({ role: 'client' });
  });
});
