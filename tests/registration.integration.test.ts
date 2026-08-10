import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Locale, WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Sign-up, end to end at the service layer.
 *
 * This suite exists because of a real bug: the register route seeded default
 * queue slots *and* `createWorkspace` seeded them too, so every sign-up hit a
 * unique-constraint failure. Every test until then went straight to
 * `createWorkspace` or to Prisma, so nothing exercised the path a new customer
 * actually takes.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let auth: typeof import('../src/lib/auth');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('registration');

  ({ prisma } = await import('../src/lib/prisma'));
  auth = await import('../src/lib/auth');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.queueSlot.deleteMany();
  await prisma.notificationSetting.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

const email = () => `new-${randomBytes(4).toString('hex')}@example.com`;

describe('registerUser', () => {
  it('creates a user, a workspace and an owner membership', async () => {
    const address = email();

    const { userId } = await auth.registerUser({
      email: address,
      password: 'a-long-enough-password',
      name: 'Robin',
      workspaceName: 'Acme Marketing',
    });

    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId },
      include: { workspace: true },
    });

    expect(membership.role).toBe(WorkspaceRole.owner);
    expect(membership.workspace.name).toBe('Acme Marketing');
    expect(membership.workspace.slug).toBe('acme-marketing');
  });

  it('seeds the default queue exactly once', async () => {
    // The bug: slots were created by both the route and createWorkspace, so
    // sign-up failed on the unique constraint.
    const { userId } = await auth.registerUser({
      email: email(),
      password: 'a-long-enough-password',
      name: 'Robin',
    });

    const membership = await prisma.membership.findFirstOrThrow({ where: { userId } });
    const slots = await prisma.queueSlot.findMany({
      where: { workspaceId: membership.workspaceId },
    });

    expect(slots.length).toBeGreaterThan(0);
    const keys = slots.map((slot) => `${slot.dayOfWeek}-${slot.hour}-${slot.minute}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('creates notification preferences for the owner', async () => {
    const { userId } = await auth.registerUser({
      email: email(),
      password: 'a-long-enough-password',
      name: 'Robin',
    });

    expect(await prisma.notificationSetting.count({ where: { userId } })).toBe(1);
  });

  it('sets the new workspace as the active one', async () => {
    const { userId } = await auth.registerUser({
      email: email(),
      password: 'a-long-enough-password',
      name: 'Robin',
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.lastActiveWorkspaceId).not.toBeNull();
  });

  it('names the workspace after the person when none is given', async () => {
    const { userId } = await auth.registerUser({
      email: email(),
      password: 'a-long-enough-password',
      name: 'Robin',
    });

    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId },
      include: { workspace: true },
    });
    expect(membership.workspace.name).toBe("Robin's workspace");
  });

  it('stores the requested locale', async () => {
    const { userId } = await auth.registerUser({
      email: email(),
      password: 'a-long-enough-password',
      name: 'Robin',
      locale: Locale.fr,
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.locale).toBe(Locale.fr);

    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId },
      include: { workspace: true },
    });
    // The workspace follows, so its client-facing emails match.
    expect(membership.workspace.defaultLocale).toBe(Locale.fr);
  });

  it('rejects a duplicate email', async () => {
    const address = email();
    await auth.registerUser({ email: address, password: 'a-long-enough-password', name: 'First' });

    await expect(
      auth.registerUser({ email: address, password: 'a-long-enough-password', name: 'Second' }),
    ).rejects.toThrow(/already exists/i);
  });

  it('treats email as case-insensitive', async () => {
    const address = email();
    await auth.registerUser({ email: address, password: 'a-long-enough-password', name: 'First' });

    await expect(
      auth.registerUser({
        email: address.toUpperCase(),
        password: 'a-long-enough-password',
        name: 'Second',
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('gives two workspaces of the same name distinct slugs', async () => {
    for (const name of ['Acme', 'Acme']) {
      await auth.registerUser({
        email: email(),
        password: 'a-long-enough-password',
        name: 'Owner',
        workspaceName: name,
      });
    }

    const workspaces = await prisma.workspace.findMany({ where: { name: 'Acme' } });
    expect(workspaces).toHaveLength(2);
    expect(new Set(workspaces.map((workspace) => workspace.slug)).size).toBe(2);
  });

  it('can register without a workspace, for someone accepting an invitation', async () => {
    const { userId } = await auth.registerUser({
      email: email(),
      password: 'a-long-enough-password',
      name: 'Invitee',
      skipWorkspace: true,
    });

    expect(await prisma.membership.count({ where: { userId } })).toBe(0);
    expect(await prisma.workspace.count()).toBe(0);
  });
});

describe('authenticate', () => {
  it('accepts the right password', async () => {
    const address = email();
    await auth.registerUser({ email: address, password: 'a-long-enough-password', name: 'Robin' });

    const token = await auth.authenticate(address, 'a-long-enough-password');
    expect(token).toBeTruthy();
    expect(await prisma.session.count()).toBeGreaterThan(0);
  });

  it('rejects the wrong password', async () => {
    const address = email();
    await auth.registerUser({ email: address, password: 'a-long-enough-password', name: 'Robin' });

    await expect(auth.authenticate(address, 'wrong-password')).rejects.toThrow(/incorrect/i);
  });

  it('rejects an unknown address without revealing that it is unknown', async () => {
    await expect(auth.authenticate('nobody@example.com', 'whatever')).rejects.toThrow(/incorrect/i);
  });
});
