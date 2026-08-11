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

    await settings.writeSetting('facebook.appId', '123', null);
    await settings.ensureSettings();
    expect((await step(workspace.id, 'facebookApp'))?.done).toBe(false);

    await settings.writeSetting('facebook.appSecret', 'shh', null);
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
    await settings.writeSetting('facebook.appId', '123', null);
    await settings.writeSetting('facebook.appSecret', 'shh', null);
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

  it('is owner-only once it is shut', () => {
    expect(setup.maySetUp({ role: WorkspaceRole.owner }, false)).toBe(true);
    expect(setup.maySetUp({ role: WorkspaceRole.admin }, false)).toBe(false);
    expect(setup.maySetUp({ role: WorkspaceRole.editor }, false)).toBe(false);
    expect(setup.maySetUp({ role: WorkspaceRole.contributor }, false)).toBe(false);
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
