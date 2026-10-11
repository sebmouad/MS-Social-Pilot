import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));

import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Two-step sign-in: a password alone no longer signs in an account that has a
 * second step, or one that must have it.
 */

let database: TestDatabase;
type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let auth: typeof import('../src/lib/auth');
let twoStep: typeof import('../src/lib/two-step');
let totp: typeof import('../src/lib/totp');
let crypto: typeof import('../src/lib/crypto');
let settings: typeof import('../src/lib/settings');

const PASSWORD = 'a-long-enough-password';

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('twostep');
  ({ prisma } = await import('../src/lib/prisma'));
  auth = await import('../src/lib/auth');
  twoStep = await import('../src/lib/two-step');
  totp = await import('../src/lib/totp');
  crypto = await import('../src/lib/crypto');
  settings = await import('../src/lib/settings');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  cookieJar.clear();
  await settings.clearSetting('security.twoStep');
  await settings.ensureSettings();
  await prisma.session.deleteMany();
  await prisma.target.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.workspace.deleteMany();
  await prisma.user.deleteMany();
});

let counter = 0;
async function person(options: { root?: boolean; role?: WorkspaceRole; withPage?: boolean } = {}) {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      email: `p${counter}@example.test`,
      name: `P ${counter}`,
      passwordHash: crypto.hashPassword(PASSWORD),
      isInstanceOwner: options.root ?? false,
    },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: `W ${counter}`,
      slug: `w-${counter}`,
      timezone: 'UTC',
      memberships: { create: { userId: user.id, role: options.role ?? WorkspaceRole.owner } },
    },
  });
  if (options.withPage) {
    await prisma.target.create({
      data: { workspaceId: workspace.id, type: 'page', providerId: `page-${counter}`, name: 'Client A' },
    });
  }
  return user;
}

async function signIn(email: string) {
  const result = await auth.authenticate(email, PASSWORD, cookieJar.get('msp_trusted') ?? null);
  cookieJar.set('msp_session', result.token);
  return result.next;
}

/** Set up the app for a user the way the screens do, returning its secret. */
async function enrolApp(userId: string): Promise<string> {
  const { secret } = await twoStep.beginTotp(userId);
  await twoStep.confirmTotp(userId, totp.totpCode(secret, totp.timeStep()));
  return secret;
}

describe('who must use it', () => {
  it('root and admins of a workspace with a profile must; others need not', async () => {
    expect(await twoStep.twoStepRequired((await person({ root: true })).id)).toBe(true);
    expect(await twoStep.twoStepRequired((await person({ withPage: true })).id)).toBe(true);
    expect(await twoStep.twoStepRequired((await person()).id)).toBe(false);
    expect(await twoStep.twoStepRequired((await person({ role: WorkspaceRole.editor, withPage: true })).id)).toBe(false);
  });

  it('an account that must have it sets it up before it is signed in', async () => {
    const root = await person({ root: true });
    expect(await signIn(root.email)).toBe('enroll');
    expect(await auth.getAuthContext()).toBeNull();
  });

  it('"off" lets everybody in with a password', async () => {
    await settings.writeSetting('security.twoStep', 'off', null);
    await settings.ensureSettings();
    const root = await person({ root: true });
    expect(await signIn(root.email)).toBeNull();
  });
});

describe('the second step', () => {
  it('a pending session signs nobody in until the code is right, and a code works once', async () => {
    const user = await person();
    const secret = await enrolApp(user.id);
    // Codes already used during setup cannot be replayed; wait for the next step.
    await prisma.user.update({ where: { id: user.id }, data: { totpLastStep: totp.timeStep() - 2 } });

    expect(await signIn(user.email)).toBe('verify');
    expect(await auth.getAuthContext()).toBeNull();

    await expect(twoStep.checkSecondStepCode(user.id, '000000')).rejects.toMatchObject({ key: 'errors.twoStepWrongCode' });
    const code = totp.totpCode(secret, totp.timeStep());
    await expect(twoStep.checkSecondStepCode(user.id, code)).resolves.toBe('totp');
    await expect(twoStep.checkSecondStepCode(user.id, code)).rejects.toMatchObject({ key: 'errors.twoStepWrongCode' });

    const pending = await auth.getPendingSession();
    await auth.completePendingSession(pending!.id);
    expect((await auth.getAuthContext())?.user.id).toBe(user.id);
  });

  it('a recovery code works once', async () => {
    const user = await person();
    await enrolApp(user.id);
    const [first] = await twoStep.newRecoveryCodes(user.id);
    await expect(twoStep.checkSecondStepCode(user.id, first!.toUpperCase())).resolves.toBe('recovery');
    await expect(twoStep.checkSecondStepCode(user.id, first!)).rejects.toMatchObject({ key: 'errors.twoStepWrongCode' });
    expect(await twoStep.recoveryCodesLeft(user.id)).toBe(9);
  });

  it('a trusted device skips the step for that account only', async () => {
    const user = await person();
    const other = await person();
    await enrolApp(user.id);
    await enrolApp(other.id);
    cookieJar.set('msp_trusted', await twoStep.trustDevice(user.id, 'test'));

    expect(await signIn(user.email)).toBeNull();
    expect(await signIn(other.email)).toBe('verify');
  });

  it('cannot be turned off while required; can be when not', async () => {
    const admin = await person({ withPage: true });
    await enrolApp(admin.id);
    await expect(twoStep.disableTwoStep(admin.id, PASSWORD)).rejects.toMatchObject({ key: 'errors.twoStepRequired' });

    const member = await person();
    await enrolApp(member.id);
    await expect(twoStep.disableTwoStep(member.id, 'wrong')).rejects.toMatchObject({ key: 'errors.currentPasswordWrong' });
    await twoStep.disableTwoStep(member.id, PASSWORD);
    expect(await twoStep.hasSecondFactor(member.id)).toBe(false);
  });
});
