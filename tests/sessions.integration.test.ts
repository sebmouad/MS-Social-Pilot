import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Signed-in browsers: each session remembers what it was
 * opened from, a new browser after the first gets an email, and a person can
 * end their own sessions but nobody else's.
 */

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const FIREFOX_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';

let userAgent = CHROME_MAC;
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ 'user-agent': userAgent }),
}));

const sent: Array<{ to: string; subject: string; text: string }> = [];
vi.mock('../src/lib/email/send', () => ({
  sendEmail: async (options: { to: string; subject: string; text: string }) => {
    sent.push(options);
    return { status: 'sent' };
  },
}));

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let auth: typeof import('../src/lib/auth');
let sessions: typeof import('../src/lib/sessions');
let crypto: typeof import('../src/lib/crypto');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('sessions');
  ({ prisma } = await import('../src/lib/prisma'));
  auth = await import('../src/lib/auth');
  sessions = await import('../src/lib/sessions');
  crypto = await import('../src/lib/crypto');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  sent.length = 0;
  userAgent = CHROME_MAC;
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

const seed = (email = 'sam@example.test') =>
  prisma.user.create({ data: { email, name: email.split('@')[0]!, passwordHash: 'x' } });

describe('describeDevice', () => {
  it('names the browser and the system', () => {
    expect(sessions.describeDevice(CHROME_MAC)).toEqual({ browser: 'Chrome', os: 'macOS' });
    expect(sessions.describeDevice(FIREFOX_WIN)).toEqual({ browser: 'Firefox', os: 'Windows' });
    expect(sessions.describeDevice(SAFARI_IPHONE)).toEqual({ browser: 'Safari', os: 'iOS' });
    expect(sessions.describeDevice(null)).toEqual({ browser: null, os: null });
  });
});

describe('sign-in from a new browser', () => {
  it('stays quiet the first time and for a browser seen before, emails for a new one', async () => {
    const user = await seed();

    await auth.createSession(user.id);
    expect(sent).toHaveLength(0);

    await auth.createSession(user.id);
    expect(sent).toHaveLength(0);

    userAgent = FIREFOX_WIN;
    await auth.createSession(user.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('sam@example.test');
    expect(sent[0]!.text).toContain('Firefox');
  });

  it('waits for the second step before counting a sign-in', async () => {
    const user = await seed();
    await auth.createSession(user.id);

    userAgent = FIREFOX_WIN;
    const token = await auth.createSession(user.id, 'verify');
    expect(sent).toHaveLength(0);

    const pending = await prisma.session.findUniqueOrThrow({ where: { tokenHash: crypto.hashToken(token) } });
    await auth.completePendingSession(pending.id);
    expect(sent).toHaveLength(1);
  });
});

describe('listSessions and signOutSession', () => {
  it('lists this browser first, with what it is', async () => {
    const user = await seed();
    userAgent = FIREFOX_WIN;
    await auth.createSession(user.id);
    userAgent = CHROME_MAC;
    const here = crypto.hashToken(await auth.createSession(user.id));

    const list = await sessions.listSessions(user.id, here);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ current: true, browser: 'Chrome', os: 'macOS' });
    expect(list[1]).toMatchObject({ current: false, browser: 'Firefox' });
  });

  it("ends one's own session, never somebody else's", async () => {
    const sam = await seed();
    const alex = await seed('alex@example.test');
    await auth.createSession(sam.id);
    await auth.createSession(alex.id);
    const alexSession = await prisma.session.findFirstOrThrow({ where: { userId: alex.id } });
    const samSession = await prisma.session.findFirstOrThrow({ where: { userId: sam.id } });

    expect(await sessions.signOutSession(sam.id, alexSession.id)).toBe(false);
    expect(await prisma.session.count({ where: { userId: alex.id } })).toBe(1);

    expect(await sessions.signOutSession(sam.id, samSession.id)).toBe(true);
    expect(await prisma.session.count({ where: { userId: sam.id } })).toBe(0);
  });

  it('root sees everybody, and can end any one', async () => {
    const sam = await seed();
    const alex = await seed('alex@example.test');
    await auth.createSession(sam.id);
    await auth.createSession(alex.id);

    const all = await sessions.listAllSessions(null);
    expect(all.map((row) => row.user.email).sort()).toEqual(['alex@example.test', 'sam@example.test']);

    const ended = await sessions.rootSignOutSession(all[0]!.id);
    expect(ended?.email).toBe(all[0]!.user.email);
    expect(await prisma.session.count()).toBe(1);
  });
});

describe('touchSession', () => {
  it('writes at most every five minutes', async () => {
    const user = await seed();
    await auth.createSession(user.id);
    const row = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });

    const soon = new Date(row.lastSeenAt.getTime() + 60_000);
    await sessions.touchSession(row.id, row.lastSeenAt, soon);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: row.id } })).lastSeenAt).toEqual(row.lastSeenAt);

    const later = new Date(row.lastSeenAt.getTime() + 6 * 60_000);
    await sessions.touchSession(row.id, row.lastSeenAt, later);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: row.id } })).lastSeenAt).toEqual(later);
  });
});
