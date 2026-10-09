import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * The screen that meets whoever just deployed this.
 *
 * Two things are being tested, and the second matters more than the first.
 * The checklist has to be right, and it is derived rather than stored so that
 * it stays right when reality changes underneath it. And the access rule has to
 * be exactly as narrow as it claims: open while nobody can sign in, shut the
 * moment somebody can.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let setup: typeof import('../src/lib/setup');
let settings: typeof import('../src/lib/settings');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('setup');

  ({ prisma } = await import('../src/lib/prisma'));
  setup = await import('../src/lib/setup');
  settings = await import('../src/lib/settings');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.target.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();

  // Settings fall back to the environment, and the shared test environment
  // supplies Facebook credentials. Both have to go for a test to describe an
  // installation where nothing is configured yet.
  await settings.clearSetting('facebook.appId');
  await settings.clearSetting('facebook.appSecret');
  await settings.clearSetting('email.apiKey');
  delete process.env.FACEBOOK_APP_ID;
  delete process.env.FACEBOOK_APP_SECRET;
  await settings.ensureSettings();
});

afterEach(() => {
  process.env.FACEBOOK_APP_ID = '111';
  process.env.FACEBOOK_APP_SECRET = 'integration-app-secret';
});

async function seedWorkspace() {
  const user = await prisma.user.create({
    data: { email: `owner-${randomBytes(3).toString('hex')}@example.com`, name: 'Owner', passwordHash: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Client',
      slug: `client-${randomBytes(3).toString('hex')}`,
      timezone: 'UTC',
      memberships: { create: { userId: user.id, role: WorkspaceRole.owner } },
    },
  });
  return { user, workspace };
}

async function step(workspaceId: string | null, id: string) {
  const state = await setup.readSetupState(workspaceId);
  return state.steps.find((entry) => entry.id === id);
}

describe('what is left to do', () => {
  it('starts with nothing done and the account first', async () => {
    const state = await setup.readSetupState(null);

    expect(state.firstRun).toBe(true);
    expect(state.complete).toBe(false);
    expect(state.nextStep).toBe('account');
  });

  it('ticks the account off as soon as one exists', async () => {
    const { workspace } = await seedWorkspace();

    const state = await setup.readSetupState(workspace.id);
    expect(state.firstRun).toBe(false);
    expect(state.steps.find((entry) => entry.id === 'account')?.done).toBe(true);
    expect(state.nextStep).toBe('facebookApp');
  });

  it('needs both halves of the Facebook credentials', async () => {
    const { workspace } = await seedWorkspace();

    await settings.writeSetting('facebook.appId', '123456789012345', null);
    await settings.ensureSettings();
    expect((await step(workspace.id, 'facebookApp'))?.done).toBe(false);

    await settings.writeSetting('facebook.appSecret', 'c0ffee00c0ffee00c0ffee00c0ffee00', null);
    await settings.ensureSettings();
    expect((await step(workspace.id, 'facebookApp'))?.done).toBe(true);
  });

  it('counts credentials that came from the environment', async () => {
    // Precedence is database, then environment, then default. An installation
    // configured by .env has done this step, and a checklist that insisted on
    // the form would be asking for work already finished.
    const { workspace } = await seedWorkspace();
    process.env.FACEBOOK_APP_ID = '111';
    process.env.FACEBOOK_APP_SECRET = 'from-the-environment';
    await settings.ensureSettings();

    expect((await step(workspace.id, 'facebookApp'))?.done).toBe(true);
  });

  it('counts a connection only in the workspace asking', async () => {
    const mine = await seedWorkspace();
    const theirs = await seedWorkspace();

    await prisma.socialAccount.create({
      data: {
        workspaceId: theirs.workspace.id,
        providerUserId: '1',
        name: 'Someone else',
        accessToken: 'x',
      },
    });

    expect((await step(mine.workspace.id, 'connect'))?.done).toBe(false);
    expect((await step(theirs.workspace.id, 'connect'))?.done).toBe(true);
  });

  it('does not count a destination that cannot publish', async () => {
    const { workspace } = await seedWorkspace();
    const account = await prisma.socialAccount.create({
      data: { workspaceId: workspace.id, providerUserId: '1', name: 'Sam', accessToken: 'x' },
    });

    // Connected and visible, but Facebook will not let this account post there:
    // calling that "ready" would send somebody off to write a post that cannot
    // go out.
    await prisma.target.create({
      data: {
        workspaceId: workspace.id,
        socialAccountId: account.id,
        type: 'page',
        providerId: '1000',
        name: 'Page',
        enabled: true,
        canPublish: false,
      },
    });

    expect((await step(workspace.id, 'destination'))?.done).toBe(false);
  });

  it('does not count a destination that is turned off', async () => {
    const { workspace } = await seedWorkspace();
    const account = await prisma.socialAccount.create({
      data: { workspaceId: workspace.id, providerUserId: '1', name: 'Sam', accessToken: 'x' },
    });
    await prisma.target.create({
      data: {
        workspaceId: workspace.id,
        socialAccountId: account.id,
        type: 'page',
        providerId: '1000',
        name: 'Page',
        enabled: false,
        canPublish: true,
      },
    });

    expect((await step(workspace.id, 'destination'))?.done).toBe(false);
  });

  it('is complete without email, and says email is optional', async () => {
    const { workspace } = await seedWorkspace();
    await settings.writeSetting('facebook.appId', '123456789012345', null);
    await settings.writeSetting('facebook.appSecret', 'c0ffee00c0ffee00c0ffee00c0ffee00', null);
    await settings.ensureSettings();

    const account = await prisma.socialAccount.create({
      data: { workspaceId: workspace.id, providerUserId: '1', name: 'Sam', accessToken: 'x' },
    });
    await prisma.target.create({
      data: {
        workspaceId: workspace.id,
        socialAccountId: account.id,
        type: 'page',
        providerId: '1000',
        name: 'Page',
        enabled: true,
        canPublish: true,
      },
    });

    // A worker has to have reported in: an installation with every box ticked
    // and nothing running publishes nothing.
    await prisma.workerHeartbeat.create({
      data: { workerId: 'test-worker', seenAt: new Date(), jobs: ['publish'] },
    });

    const state = await setup.readSetupState(workspace.id);

    expect(state.complete).toBe(true);
    expect(state.steps.find((entry) => entry.id === 'email')?.optional).toBe(true);
    // Still offered, because a failure nobody hears about is the thing it
    // prevents.
    expect(state.nextStep).toBe('email');
  });

  it('reopens a step when what it depended on goes away', async () => {
    // The reason this is derived rather than stored: a wizard remembering it
    // reached step four would be wrong the moment the last connection is
    // removed, and would say so on a different machine too.
    const { workspace } = await seedWorkspace();
    const account = await prisma.socialAccount.create({
      data: { workspaceId: workspace.id, providerUserId: '1', name: 'Sam', accessToken: 'x' },
    });
    expect((await step(workspace.id, 'connect'))?.done).toBe(true);

    await prisma.socialAccount.delete({ where: { id: account.id } });
    expect((await step(workspace.id, 'connect'))?.done).toBe(false);
  });
});

describe('who may set up the installation', () => {
  it('lets anybody in while no account exists', () => {
    // Requiring a sign-in to create the first account is a deadlock.
    expect(setup.maySetUp(null, true)).toBe(true);
  });

  it('shuts to strangers the moment somebody has registered', () => {
    expect(setup.maySetUp(null, false)).toBe(false);
  });

  it('is the installation owner\'s alone once it is shut, whatever their workspace role', () => {
    // Every sign-up owns a workspace of its own, so a workspace role cannot be
    // what admits someone here.
    for (const role of Object.values(WorkspaceRole)) {
      const installer = { role, isInstanceOwner: true };
      const everyoneElse = { role, isInstanceOwner: false };
      expect(setup.maySetUp(installer, false), role).toBe(true);
      expect(setup.maySetUp(everyoneElse, false), role).toBe(false);
    }
  });

  it('never lets anybody but the installation owner write, not even on first run', () => {
    // Nobody legitimate writes the app credentials before the first account
    // exists — the form comes after it — so an open write only served whoever
    // found a fresh installation first.
    expect(setup.mayChangeSetup(null)).toBe(false);
    expect(setup.mayChangeSetup({ isInstanceOwner: false })).toBe(false);
    expect(setup.mayChangeSetup({ isInstanceOwner: true })).toBe(true);
  });

  it('reports first run from the database, not from a setting somebody could flip', () => {
    // The open door is keyed to the one fact that cannot be faked from outside.
    return (async () => {
      expect(await setup.isFirstRun()).toBe(true);
      await seedWorkspace();
      expect(await setup.isFirstRun()).toBe(false);
    })();
  });
});

/**
 * What the machine can do, as opposed to what somebody has configured.
 *
 * Each of these lets an installation look finished on screen and then fail at
 * the first post, hours later, with nothing connecting the two.
 */
describe('the runtime checks', () => {
  beforeEach(async () => {
    // A heartbeat left behind by another test would make "never started" pass
    // for the wrong reason.
    await prisma.workerHeartbeat.deleteMany();
  });

  it('is not complete while a required check fails, however many boxes are ticked', async () => {
    const { workspace } = await seedWorkspace();
    await settings.writeSetting('facebook.appId', '123456789012345', null);
    await settings.writeSetting('facebook.appSecret', 'c0ffee00c0ffee00c0ffee00c0ffee00', null);
    await settings.ensureSettings();

    const account = await prisma.socialAccount.create({
      data: { workspaceId: workspace.id, providerUserId: '9', name: 'Sam', accessToken: 'x' },
    });
    await prisma.target.create({
      data: {
        workspaceId: workspace.id,
        socialAccountId: account.id,
        type: 'page',
        providerId: '9000',
        name: 'Page',
        enabled: true,
        canPublish: true,
      },
    });

    // Every step done, and no worker. Calling that complete is how somebody
    // finds out days later that nothing was ever published.
    const withoutWorker = await setup.readSetupState(workspace.id);
    expect(withoutWorker.steps.filter((step) => !step.optional).every((step) => step.done)).toBe(
      true,
    );
    expect(withoutWorker.complete).toBe(false);

    await prisma.workerHeartbeat.create({ data: { workerId: 'running', seenAt: new Date() } });
    expect((await setup.readSetupState(workspace.id)).complete).toBe(true);
  });

  it('says the worker is not running when none has reported', async () => {
    const checks = await setup.readSetupChecks();
    const worker = checks.find((check) => check.id === 'worker')!;

    expect(worker.ok).toBe(false);
    expect(worker.optional).toBe(false);
    expect(worker.detail).toBe('never started');
  });

  it('accepts a worker seen a moment ago and rejects one from an hour back', async () => {
    await prisma.workerHeartbeat.create({
      data: { workerId: 'fresh', seenAt: new Date(), jobs: ['publish'] },
    });
    expect((await setup.readSetupChecks()).find((check) => check.id === 'worker')?.ok).toBe(true);

    await prisma.workerHeartbeat.update({
      where: { workerId: 'fresh' },
      data: { seenAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    expect((await setup.readSetupChecks()).find((check) => check.id === 'worker')?.ok).toBe(false);
  });

  it('reads the newest heartbeat, not just any one', async () => {
    // Several workers is a supported deployment, and one that has stopped must
    // not make a running fleet look dead.
    await prisma.workerHeartbeat.createMany({
      data: [
        { workerId: 'stopped', seenAt: new Date(Date.now() - 60 * 60 * 1000), jobs: [] },
        { workerId: 'running', seenAt: new Date(), jobs: ['publish'] },
      ],
    });

    expect((await setup.readSetupChecks()).find((check) => check.id === 'worker')?.ok).toBe(true);
  });

  it('rejects an encryption key that is not 32 bytes', async () => {
    const original = process.env.ENCRYPTION_KEY;
    // AES-256-GCM takes no other length, so a wrong one fails at the first
    // token rather than here — which is hours later and looks unrelated.
    process.env.ENCRYPTION_KEY = Buffer.from('too short').toString('base64');

    const key = (await setup.readSetupChecks()).find((check) => check.id === 'encryptionKey')!;
    expect(key.ok).toBe(false);
    expect(key.detail).toMatch(/not 32/);

    process.env.ENCRYPTION_KEY = original;
    expect((await setup.readSetupChecks()).find((check) => check.id === 'encryptionKey')?.ok).toBe(
      true,
    );
  });

  it('rejects a session secret short enough to brute-force', async () => {
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'short';

    const secret = (await setup.readSetupChecks()).find((check) => check.id === 'sessionSecret')!;
    expect(secret.ok).toBe(false);

    process.env.SESSION_SECRET = original;
  });

  it('reports a writable media directory, and says which one', async () => {
    const media = (await setup.readSetupChecks()).find((check) => check.id === 'mediaDir')!;

    expect(media.ok).toBe(true);
    expect(media.detail).toBeTruthy();
  });

  it('only warns about a localhost APP_URL outside production', async () => {
    // Correct in development and fatal in production, so the severity moves
    // rather than the check.
    const check = (await setup.readSetupChecks()).find((entry) => entry.id === 'appUrl')!;

    expect(check.detail).toContain('localhost');
    expect(check.optional).toBe(true);
    expect(check.ok).toBe(true);
  });
});
