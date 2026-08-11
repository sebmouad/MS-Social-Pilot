import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A cookie jar, because signing in sets one and `next/headers` only works
 * inside a real request. Mocking the framework boundary is what lets the
 * success path be tested at all; everything below it is the real thing.
 */
const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined,
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
  headers: async () => new Headers(),
}));
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
  await prisma.invitation.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

const email = () => `new-${randomBytes(4).toString('hex')}@example.com`;

/**
 * These suites are about sign-up working, not about who is allowed to use it,
 * so they register several unrelated people and need the door open. The policy
 * itself is exercised in "who may register" below.
 */
beforeEach(async () => {
  const settings = await import('../src/lib/settings');
  await settings.writeSetting('auth.openRegistration', true, null);
  await settings.ensureSettings();
});

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

/**
 * The app must be reachable from the internet for Facebook to call back, so an
 * open sign-up form is open to everyone who finds the address.
 */
/**
 * The sign-in form is the one unauthenticated thing that does deliberate slow
 * work, so it is both a way to guess passwords and a way to load the server.
 */
describe('signing in too often', () => {
  let login: typeof import('../src/app/api/auth/login/route');
  let limiter: typeof import('../src/lib/rate-limit');
  let settings: typeof import('../src/lib/settings');

  beforeAll(async () => {
    login = await import('../src/app/api/auth/login/route');
    limiter = await import('../src/lib/rate-limit');
    settings = await import('../src/lib/settings');
  });

  beforeEach(() => {
    limiter.reset();
  });

  function attempt(address: string, password: string, client = '198.51.100.7') {
    return login.POST(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': client },
        body: JSON.stringify({ email: address, password }),
      }),
    );
  }

  async function withLimit(attempts: number, body: () => Promise<void>) {
    await settings.writeSetting('auth.loginAttempts', attempts, null);
    await settings.ensureSettings();
    try {
      await body();
    } finally {
      await settings.clearSetting('auth.loginAttempts');
      await settings.ensureSettings();
    }
  }

  it('stops guessing at one address', async () => {
    const address = email();
    await auth.registerUser({ email: address, password: 'a-long-enough-password', name: 'Robin' });

    await withLimit(3, async () => {
      for (let guess = 0; guess < 3; guess += 1) {
        expect((await attempt(address, 'wrong-password')).status).toBe(401);
      }

      const refused = await attempt(address, 'wrong-password');
      expect(refused.status).toBe(429);

      // And the right password does not get through either, or the limit would
      // only slow down the guess that was going to fail anyway.
      expect((await attempt(address, 'a-long-enough-password')).status).toBe(429);
    });
  });

  it('stops one machine working through a list of addresses', async () => {
    await withLimit(3, async () => {
      for (let guess = 0; guess < 3; guess += 1) {
        expect((await attempt(email(), 'wrong-password')).status).toBe(401);
      }

      // A different address every time, so only the client key can catch this.
      expect((await attempt(email(), 'wrong-password')).status).toBe(429);
    });
  });

  it('does not punish someone else on a different connection', async () => {
    await withLimit(3, async () => {
      for (let guess = 0; guess < 3; guess += 1) {
        await attempt(email(), 'wrong-password', '203.0.113.1');
      }

      expect((await attempt(email(), 'wrong-password', '203.0.113.99')).status).toBe(401);
    });
  });

  it('does not spend an office\'s allowance on people signing in successfully', async () => {
    // Everyone behind one address shares the client key, so counting their
    // successful sign-ins would turn the tenth colleague of the morning away.
    const people: string[] = [];
    for (let person = 0; person < 5; person += 1) {
      const address = email();
      await auth.registerUser({
        email: address,
        password: 'a-long-enough-password',
        name: `Colleague ${person}`,
      });
      people.push(address);
    }

    await withLimit(3, async () => {
      for (const address of people) {
        expect((await attempt(address, 'a-long-enough-password')).status).toBe(200);
      }
    });
  });

  it('forgives the address once the password is right', async () => {
    const address = email();
    await auth.registerUser({ email: address, password: 'a-long-enough-password', name: 'Robin' });

    await withLimit(3, async () => {
      await attempt(address, 'wrong-password');
      await attempt(address, 'wrong-password');
      expect((await attempt(address, 'a-long-enough-password')).status).toBe(200);

      // Two earlier mistakes must not leave them one slip from being locked
      // out for the rest of the window.
      await attempt(address, 'wrong-password');
      await attempt(address, 'wrong-password');
      expect((await attempt(address, 'a-long-enough-password')).status).toBe(200);
    });
  });
});

describe('who may register', () => {
  let settings: typeof import('../src/lib/settings');

  beforeAll(async () => {
    settings = await import('../src/lib/settings');
  });

  async function withRegistrationClosed(body: () => Promise<void>) {
    // Closed is the default; the suite-wide beforeEach opens it for the tests
    // that only care about sign-up mechanics, so close it again here.
    await settings.writeSetting('auth.openRegistration', false, null);
    await settings.ensureSettings();
    try {
      await body();
    } finally {
      await settings.writeSetting('auth.openRegistration', true, null);
      await settings.ensureSettings();
    }
  }

  it('lets the first account through, so a new installation can be set up', async () => {
    await withRegistrationClosed(async () => {
      expect(await prisma.user.count()).toBe(0);

      const { userId } = await auth.registerUser({
        email: email(),
        password: 'a-long-enough-password',
        name: 'First',
      });

      expect(userId).toBeTruthy();
    });
  });

  it('turns away a stranger once somebody is here', async () => {
    await withRegistrationClosed(async () => {
      await auth.registerUser({
        email: email(),
        password: 'a-long-enough-password',
        name: 'First',
      });

      await expect(
        auth.registerUser({
          email: email(),
          password: 'a-long-enough-password',
          name: 'Stranger',
        }),
      ).rejects.toThrow(/does not accept new accounts/i);
    });
  });

  it('admits someone holding a live invitation to their own address', async () => {
    await withRegistrationClosed(async () => {
      const owner = await auth.registerUser({
        email: email(),
        password: 'a-long-enough-password',
        name: 'Owner',
      });
      const workspace = await prisma.workspace.findFirstOrThrow();
      const invited = email();

      await prisma.invitation.create({
        data: {
          workspaceId: workspace.id,
          email: invited,
          role: 'contributor',
          tokenHash: `hash-${invited}`,
          invitedById: owner.userId,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      const { userId } = await auth.registerUser({
        email: invited,
        password: 'a-long-enough-password',
        name: 'Invited',
      });
      expect(userId).toBeTruthy();
    });
  });

  it('does not admit someone whose invitation has expired', async () => {
    await withRegistrationClosed(async () => {
      const owner = await auth.registerUser({
        email: email(),
        password: 'a-long-enough-password',
        name: 'Owner',
      });
      const workspace = await prisma.workspace.findFirstOrThrow();
      const invited = email();

      await prisma.invitation.create({
        data: {
          workspaceId: workspace.id,
          email: invited,
          role: 'contributor',
          tokenHash: `hash-${invited}`,
          invitedById: owner.userId,
          expiresAt: new Date(Date.now() - 60 * 1000),
        },
      });

      await expect(
        auth.registerUser({
          email: invited,
          password: 'a-long-enough-password',
          name: 'Too late',
        }),
      ).rejects.toThrow(/does not accept new accounts/i);
    });
  });

  it('lets anyone in when an operator opens registration', async () => {
    await settings.writeSetting('auth.openRegistration', true, null);
    await settings.ensureSettings();

    try {
      await auth.registerUser({
        email: email(),
        password: 'a-long-enough-password',
        name: 'First',
      });

      const { userId } = await auth.registerUser({
        email: email(),
        password: 'a-long-enough-password',
        name: 'Second',
      });
      expect(userId).toBeTruthy();
    } finally {
      await settings.clearSetting('auth.openRegistration');
      await settings.ensureSettings();
    }
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
