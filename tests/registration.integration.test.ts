import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
/**
 * Two people creating a workspace with the same name at the same moment — or
 * one person double-clicking the button — both find the slug free and both
 * insert it.
 */
describe('creating workspaces at the same moment', () => {
  it('gives everyone a workspace and nobody an error', async () => {
    const people = await Promise.all(
      [1, 2, 3, 4, 5].map(async () => {
        const address = email();
        const user = await prisma.user.create({
          data: { email: address, name: 'Sam', passwordHash: 'x' },
        });
        return user.id;
      }),
    );

    const created = await Promise.all(
      people.map((ownerId) => auth.createWorkspace({ name: 'Acme', ownerId })),
    );

    expect(created).toHaveLength(5);
    expect(new Set(created.map((workspace) => workspace.slug)).size).toBe(5);
    for (const workspace of created) {
      expect(workspace.slug).toMatch(/^acme(-\w+)?$/);
    }
  });

  it('does not mistake a real failure for a taken slug', async () => {
    // Retrying anything that throws would turn a genuine problem — here an
    // owner who does not exist — into five silent retries and a misleading
    // "could not find a free slug".
    await expect(
      auth.createWorkspace({ name: 'Acme', ownerId: 'no-such-user' }),
    ).rejects.toThrow(/foreign key|constraint/i);
  });

  it('still numbers them in order when they arrive one at a time', async () => {
    const slugs: string[] = [];
    for (let person = 0; person < 3; person += 1) {
      const user = await prisma.user.create({
        data: { email: email(), name: 'Sam', passwordHash: 'x' },
      });
      slugs.push((await auth.createWorkspace({ name: 'Acme', ownerId: user.id })).slug);
    }

    expect(slugs).toEqual(['acme', 'acme-2', 'acme-3']);
  });
});

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
    // These tests speak for the client through x-forwarded-for, which is only
    // believed when the operator says a proxy sets it.
    process.env.TRUST_PROXY = 'true';
  });

  afterEach(() => {
    delete process.env.TRUST_PROXY;
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

  it('does not let one working account reset the allowance for guessing at others', async () => {
    // The attack: guess at other people's addresses, sign in to your own to
    // wipe the count, guess again. Only what was spent on your own address may
    // be given back.
    const mine = email();
    await auth.registerUser({ email: mine, password: 'a-long-enough-password', name: 'Mallory' });

    await withLimit(3, async () => {
      const refused: number[] = [];
      for (let round = 0; round < 4; round += 1) {
        refused.push((await attempt(email(), 'guess')).status);
        await attempt(mine, 'a-long-enough-password');
      }

      expect(refused.slice(0, 3)).toEqual([401, 401, 401]);
      expect(refused[3]).toBe(429);
    });
  });

  it('keys on the address alone when no proxy says who the client is', async () => {
    // One shared "unknown" key would let a single visitor's wrong guesses turn
    // every other visitor away.
    delete process.env.TRUST_PROXY;

    await withLimit(3, async () => {
      for (let guess = 0; guess < 5; guess += 1) {
        expect((await attempt(email(), 'wrong-password')).status).toBe(401);
      }
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

/**
 * Who owns the installation, as opposed to who owns a workspace on it.
 *
 * Everybody who registers is given a workspace of their own to own, invited or
 * not. Instance settings used to ask only "owner of the active workspace?", so
 * someone invited as a contributor could switch to their own workspace and
 * rewrite the Facebook app credentials every client publishes through.
 */
describe('the installation owner', () => {
  let settings: typeof import('../src/lib/settings');
  let config: typeof import('../src/app/api/root/config/route');
  let setupRoute: typeof import('../src/app/api/setup/route');

  beforeAll(async () => {
    settings = await import('../src/lib/settings');
    config = await import('../src/app/api/root/config/route');
    setupRoute = await import('../src/app/api/setup/route');
  });

  beforeEach(() => {
    cookieJar.clear();
  });

  async function withRegistrationClosed(body: () => Promise<void>) {
    await settings.writeSetting('auth.openRegistration', false, null);
    await settings.ensureSettings();
    try {
      await body();
    } finally {
      await settings.writeSetting('auth.openRegistration', true, null);
      await settings.ensureSettings();
    }
  }

  /** The first account, and somebody it invited as a contributor. */
  async function ownerAndInvitee() {
    const owner = await auth.registerUser({
      email: email(),
      password: 'a-long-enough-password',
      name: 'Owner',
      workspaceName: 'Agency',
    });
    const agency = await prisma.workspace.findFirstOrThrow({ where: { name: 'Agency' } });
    const invited = email();
    await prisma.invitation.create({
      data: {
        workspaceId: agency.id,
        email: invited,
        role: 'contributor',
        tokenHash: `hash-${invited}`,
        invitedById: owner.userId,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const invitee = await auth.registerUser({
      email: invited,
      password: 'a-long-enough-password',
      name: 'Invitee',
    });
    await prisma.membership.create({
      data: { userId: invitee.userId, workspaceId: agency.id, role: WorkspaceRole.contributor },
    });
    const own = await prisma.membership.findFirstOrThrow({
      where: { userId: invitee.userId, role: WorkspaceRole.owner },
    });

    return { owner, invitee, agency, inviteeWorkspaceId: own.workspaceId };
  }

  function signInAs(token: string, workspaceId?: string) {
    cookieJar.set('msp_session', token);
    if (workspaceId) cookieJar.set('msp_workspace', workspaceId);
  }

  const setupWrite = () =>
    setupRoute.POST(
      new Request('http://localhost/api/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ facebookAppId: 'attacker-app', facebookAppSecret: 'x' }),
      }),
    );

  it('is the first account, and only the first', async () => {
    await withRegistrationClosed(async () => {
      const { owner, invitee } = await ownerAndInvitee();

      const users = await prisma.user.findMany({ select: { id: true, isInstanceOwner: true } });
      expect(users.find((user) => user.id === owner.userId)?.isInstanceOwner).toBe(true);
      expect(users.find((user) => user.id === invitee.userId)?.isInstanceOwner).toBe(false);
    });
  });

  it('keeps an invitee out of instance settings, even from a workspace they own', async () => {
    await withRegistrationClosed(async () => {
      const { invitee, inviteeWorkspaceId } = await ownerAndInvitee();
      signInAs(invitee.token, inviteeWorkspaceId);

      const context = await auth.getAuthContext();
      // The precondition of the attack: they really do own this one.
      expect(context?.role).toBe(WorkspaceRole.owner);
      expect(context?.isInstanceOwner).toBe(false);

      const write = await config.POST(
        new Request('http://localhost/api/settings/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ values: { 'facebook.appId': 'attacker-app' } }),
        }),
      );
      // The root section answers 404, so it is not even advertised.
      expect(write.status).toBe(404);
      expect((await config.GET()).status).toBe(404);
      expect((await setupWrite()).status).toBe(403);
    });
  });

  it('lets the installation owner in from any workspace', async () => {
    await withRegistrationClosed(async () => {
      const { owner } = await ownerAndInvitee();
      signInAs(owner.token);

      expect((await config.GET()).status).toBe(200);
    });
  });

  it('refuses a setup write before anybody has registered', async () => {
    // Nobody legitimate writes the app credentials before the first account
    // exists, so an open door here only served whoever found the server first.
    expect((await setupWrite()).status).toBe(403);
  });

  it('crowns exactly one of several people signing up on a fresh installation at once', async () => {
    // Each used to count zero users and pass as "the first account", so all of
    // them came out owning the installation — and with registration shut, a
    // stranger racing the operator got in as well.
    await withRegistrationClosed(async () => {
      const results = await Promise.allSettled(
        [1, 2, 3, 4].map((person) =>
          auth.registerUser({
            email: email(),
            password: 'a-long-enough-password',
            name: `Racer ${person}`,
          }),
        ),
      );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await prisma.user.count()).toBe(1);
      expect(await prisma.user.count({ where: { isInstanceOwner: true } })).toBe(1);
    });
  });

  it('crowns one even when registration is open and everyone arrives at once', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map((person) =>
        auth.registerUser({ email: email(), password: 'a-long-enough-password', name: `P${person}` }),
      ),
    );

    expect(results).toHaveLength(4);
    expect(await prisma.user.count({ where: { isInstanceOwner: true } })).toBe(1);
  });
});
