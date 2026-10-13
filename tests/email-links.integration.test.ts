import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Email links: a self-service sign-up proves its address
 * before using the app, and a forgotten password is reset by a one-time link.
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

let mailOn = true;
const sent: Array<{ to: string; template: string; text: string }> = [];
vi.mock('../src/lib/email/send', async (original) => ({
  ...(await original<typeof import('../src/lib/email/send')>()),
  emailEnabled: () => mailOn,
  sendEmail: async (options: { to: string; template: string; text: string }) => {
    sent.push(options);
    return { status: 'sent' };
  },
}));

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let auth: typeof import('../src/lib/auth');
let links: typeof import('../src/lib/email-tokens');
let settings: typeof import('../src/lib/settings');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('email_links');
  ({ prisma } = await import('../src/lib/prisma'));
  auth = await import('../src/lib/auth');
  links = await import('../src/lib/email-tokens');
  settings = await import('../src/lib/settings');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  sent.length = 0;
  mailOn = true;
  cookieJar.clear();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
  await settings.writeSetting('auth.openRegistration', true, null);
  await settings.ensureSettings();
});

const address = () => `person-${randomBytes(4).toString('hex')}@example.com`;
/** The token in the last email's link. */
const lastToken = () => /token=([\w-]+)/.exec(sent.at(-1)!.text)![1]!;

async function register(email = address()) {
  return auth.registerUser({ email, password: 'a-long-enough-password', name: 'Sam' });
}

describe('confirming the address', () => {
  it('root and invited people are confirmed already; a stranger is not', async () => {
    const root = await register();
    expect(root.verified).toBe(true);

    const stranger = await register();
    expect(stranger.verified).toBe(false);

    const invitedEmail = address();
    const owner = await prisma.membership.findFirstOrThrow({ where: { userId: root.userId } });
    await prisma.invitation.create({
      data: {
        workspaceId: owner.workspaceId,
        email: invitedEmail,
        role: 'editor',
        tokenHash: `hash-${randomBytes(4).toString('hex')}`,
        invitedById: root.userId,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect((await register(invitedEmail)).verified).toBe(true);
  });

  it('does not ask when the server cannot send email', async () => {
    await register();
    mailOn = false;
    expect((await register()).verified).toBe(true);
  });

  it('keeps an unconfirmed person out of the API until the link is opened, once', async () => {
    await register();
    const { userId, token } = await register();
    cookieJar.set('msp_session', token);
    await links.sendVerificationEmail(userId);
    const link = lastToken();

    const { getAuthContext } = auth;
    const context = await getAuthContext();
    expect(context?.user.emailVerified).toBe(false);

    expect(await links.verifyEmail('not-a-token')).toBe(false);
    expect(await links.verifyEmail(link)).toBe(true);
    expect(await links.verifyEmail(link)).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt).not.toBeNull();
  });

  it('a newer link replaces the older one', async () => {
    await register();
    const { userId } = await register();
    await links.sendVerificationEmail(userId);
    const first = lastToken();
    await links.sendVerificationEmail(userId);
    expect(await links.verifyEmail(first)).toBe(false);
    expect(await links.verifyEmail(lastToken())).toBe(true);
  });
});

describe('resetting a password', () => {
  it('emails nobody for an unknown or disabled address, and says nothing either way', async () => {
    const { userId } = await register();
    await links.requestPasswordReset(address());
    await prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await links.requestPasswordReset(user.email);
    expect(sent).toHaveLength(0);
  });

  it('sets the new password once, ends every session, and expires', async () => {
    const email = address();
    const { userId } = await register(email);
    await prisma.session.create({ data: { userId, tokenHash: `s-${randomBytes(4).toString('hex')}`, expiresAt: new Date(Date.now() + 86_400_000) } });

    await links.requestPasswordReset(email.toUpperCase());
    expect(sent.at(-1)!.to).toBe(email);
    const link = lastToken();

    expect(await links.resetPassword(link, 'a-brand-new-password')).toBe(true);
    expect(await prisma.session.count({ where: { userId } })).toBe(0);
    await expect(auth.authenticate(email, 'a-long-enough-password', null)).rejects.toBeTruthy();
    await expect(auth.authenticate(email, 'a-brand-new-password', null)).resolves.toBeTruthy();
    expect(await links.resetPassword(link, 'yet-another-password')).toBe(false);

    await links.requestPasswordReset(email);
    await prisma.emailToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await links.resetPassword(lastToken(), 'yet-another-password')).toBe(false);
  });

  it('a verify link cannot reset a password', async () => {
    await register();
    const { userId } = await register();
    await links.sendVerificationEmail(userId);
    expect(await links.resetPassword(lastToken(), 'a-brand-new-password')).toBe(false);
  });
});
