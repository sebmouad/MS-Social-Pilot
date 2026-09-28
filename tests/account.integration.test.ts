import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * A person's own account: the password they can now change, and the other
 * browsers they can now sign out.
 *
 * The behaviour that matters most is what happens to *other* sessions. Somebody
 * changing their password usually believes somebody else has it, and a change
 * that leaves that somebody signed in has fixed nothing.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let account: typeof import('../src/lib/account');
let auth: typeof import('../src/lib/auth');
let crypto: typeof import('../src/lib/crypto');
let rateLimit: typeof import('../src/lib/rate-limit');

const LIMIT = { limit: 5, windowMs: 60_000 };

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('account');

  ({ prisma } = await import('../src/lib/prisma'));
  account = await import('../src/lib/account');
  auth = await import('../src/lib/auth');
  crypto = await import('../src/lib/crypto');
  rateLimit = await import('../src/lib/rate-limit');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  rateLimit.reset();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

async function seedUser(password = 'original-password') {
  const user = await prisma.user.create({
    data: { email: 'sam@example.com', name: 'Sam', passwordHash: crypto.hashPassword(password) },
  });
  const here = await auth.createSession(user.id);
  const laptop = await auth.createSession(user.id);
  const phone = await auth.createSession(user.id);
  return { user, here: crypto.hashToken(here), laptop, phone };
}

describe('changePassword', () => {
  it('changes it, and signs out every other browser but keeps this one', async () => {
    const { user, here } = await seedUser();

    const result = await account.changePassword({
      userId: user.id,
      currentTokenHash: here,
      currentPassword: 'original-password',
      newPassword: 'a-brand-new-password',
      limit: LIMIT,
    });

    expect(result.signedOut).toBe(2);
    const remaining = await prisma.session.findMany({ where: { userId: user.id } });
    expect(remaining.map((session) => session.tokenHash)).toEqual([here]);

    // The new one signs in; the old one no longer does.
    await expect(auth.authenticate('sam@example.com', 'a-brand-new-password')).resolves.toBeTruthy();
    await expect(auth.authenticate('sam@example.com', 'original-password')).rejects.toThrow(/incorrect/i);
  });

  it('refuses without the current password, and changes nothing', async () => {
    const { user, here } = await seedUser();

    await expect(
      account.changePassword({
        userId: user.id,
        currentTokenHash: here,
        currentPassword: 'a-guess',
        newPassword: 'a-brand-new-password',
        limit: LIMIT,
      }),
    ).rejects.toThrow(/current password/i);

    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(3);
    await expect(auth.authenticate('sam@example.com', 'original-password')).resolves.toBeTruthy();
  });

  it('refuses a new password that is the old one', async () => {
    const { user, here } = await seedUser();

    await expect(
      account.changePassword({
        userId: user.id,
        currentTokenHash: here,
        currentPassword: 'original-password',
        newPassword: 'original-password',
        limit: LIMIT,
      }),
    ).rejects.toThrow(/different/i);
  });

  it('limits guesses at the current password, so a stolen session cannot brute-force it', async () => {
    const { user, here } = await seedUser();
    const guess = () =>
      account.changePassword({
        userId: user.id,
        currentTokenHash: here,
        currentPassword: 'a-guess',
        newPassword: 'a-brand-new-password',
        limit: { limit: 2, windowMs: 60_000 },
      });

    await expect(guess()).rejects.toThrow(/current password/i);
    await expect(guess()).rejects.toThrow(/current password/i);
    await expect(guess()).rejects.toThrow(/too many/i);
  });
});

describe('signOutOtherSessions', () => {
  it('signs out the others and leaves this browser alone', async () => {
    const { user, here } = await seedUser();

    expect((await account.readAccount(user.id, here)).otherSessions).toBe(2);
    expect(await account.signOutOtherSessions(user.id, here)).toBe(2);
    expect((await account.readAccount(user.id, here)).otherSessions).toBe(0);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it('never reaches another person', async () => {
    const { user, here } = await seedUser();
    const other = await prisma.user.create({
      data: { email: 'alex@example.com', name: 'Alex', passwordHash: 'x' },
    });
    await auth.createSession(other.id);

    await account.signOutOtherSessions(user.id, here);
    expect(await prisma.session.count({ where: { userId: other.id } })).toBe(1);
  });
});

describe('updateProfile', () => {
  it('changes the name and the language, which sign-up had fixed for ever', async () => {
    const { user, here } = await seedUser();

    await account.updateProfile(user.id, { name: '  Samira ', locale: 'fr' });

    const summary = await account.readAccount(user.id, here);
    expect(summary.name).toBe('Samira');
    expect(summary.locale).toBe('fr');
    expect(summary.email).toBe('sam@example.com');
  });
});
