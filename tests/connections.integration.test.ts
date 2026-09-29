import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';
import en from '../messages/en.json';
import fr from '../messages/fr.json';

/**
 * Managing connections: destinations, Instagram accounts, ad accounts, tokens.
 *
 * Two properties are load-bearing and both were broken before this suite
 * existed. Toggling a destination had **no permission check at all**, so any
 * contributor could turn a client's page off for the whole workspace. And
 * disconnecting an account belonging to another workspace answered "ok" — the
 * delete was scoped, so nothing happened, but the caller was told it had.
 *
 * "Not found" and "not allowed" have to stay distinguishable from "done".
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let connections: typeof import('../src/lib/connections');

/** A stub Graph API, so a disconnect can be watched deleting remote posts. */
let server: Server;
/** Every request Graph received: method and path. */
let received: Array<{ method: string; path: string }> = [];
/** Paths the stub refuses, for testing what happens when a delete fails. */
let denied: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    received.push({ method: request.method ?? 'GET', path: url.pathname });

    request.on('data', () => undefined);
    request.on('end', () => {
      if (denied.some((suffix) => url.pathname.endsWith(suffix))) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Cannot delete', code: 10 } }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ success: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');

  setTestEnv({ FACEBOOK_GRAPH_BASE_URL: `http://127.0.0.1:${address.port}` });
  database = setupTestDatabase('connections');

  ({ prisma } = await import('../src/lib/prisma'));
  connections = await import('../src/lib/connections');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database?.drop();
});

beforeEach(async () => {
  received = [];
  denied = [];
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.instagramAccount.deleteMany();
  await prisma.adAccount.deleteMany();
  await prisma.target.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed(label = 'client') {
  const { encryptSecret } = await import('../src/lib/crypto');
  const suffix = randomBytes(3).toString('hex');

  const user = await prisma.user.create({
    data: { email: `${label}-${suffix}@example.com`, name: 'Owner', passwordHash: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: label,
      slug: `${label}-${suffix}`,
      timezone: 'UTC',
      memberships: { create: { userId: user.id, role: WorkspaceRole.owner } },
    },
  });
  const account = await prisma.socialAccount.create({
    data: {
      workspaceId: workspace.id,
      providerUserId: suffix,
      name: 'Sam Jones',
      accessToken: encryptSecret('user-token'),
    },
  });
  const page = await prisma.target.create({
    data: {
      workspaceId: workspace.id,
      socialAccountId: account.id,
      type: 'page',
      providerId: `page-${suffix}`,
      name: 'Client Page',
      accessToken: encryptSecret('page-token'),
    },
  });
  const instagram = await prisma.instagramAccount.create({
    data: {
      workspaceId: workspace.id,
      socialAccountId: account.id,
      targetId: page.id,
      igUserId: `ig-${suffix}`,
      username: 'acme',
    },
  });
  const adAccount = await prisma.adAccount.create({
    data: {
      workspaceId: workspace.id,
      socialAccountId: account.id,
      actId: `act_${suffix}`,
      name: 'Acme Ads',
    },
  });

  return { user, workspace, account, page, instagram, adAccount };
}

describe('setTargetEnabled', () => {
  it('turns a destination off and on', async () => {
    const { workspace, page } = await seed();

    expect(
      await connections.setTargetEnabled({
        workspaceId: workspace.id,
        role: WorkspaceRole.admin,
        targetId: page.id,
        enabled: false,
      }),
    ).toEqual({ outcome: 'ok' });

    expect((await prisma.target.findUniqueOrThrow({ where: { id: page.id } })).enabled).toBe(false);
  });

  it('refuses a contributor', async () => {
    // The bug this replaces: the route had no role check, so anyone could turn
    // a client's page off for the entire workspace.
    const { workspace, page } = await seed();

    const result = await connections.setTargetEnabled({
      workspaceId: workspace.id,
      role: WorkspaceRole.contributor,
      targetId: page.id,
      enabled: false,
    });

    expect(result.outcome).toBe('forbidden');
    expect((await prisma.target.findUniqueOrThrow({ where: { id: page.id } })).enabled).toBe(true);
  });

  it('refuses an editor too', async () => {
    const { workspace, page } = await seed();
    const result = await connections.setTargetEnabled({
      workspaceId: workspace.id,
      role: WorkspaceRole.editor,
      targetId: page.id,
      enabled: false,
    });
    expect(result.outcome).toBe('forbidden');
  });

  it('refuses to re-enable a destination Facebook has blocked', async () => {
    // Otherwise the queue fills with posts that are guaranteed to fail.
    const { workspace, page } = await seed();
    await prisma.target.update({
      where: { id: page.id },
      data: { enabled: false, canPublish: false, publishBlocker: 'Missing publish permission.' },
    });

    const result = await connections.setTargetEnabled({
      workspaceId: workspace.id,
      role: WorkspaceRole.owner,
      targetId: page.id,
      enabled: true,
    });

    expect(result.outcome).toBe('blocked');
    expect(result.reason).toMatch(/permission/i);
  });

  it('still allows turning a blocked destination off', async () => {
    const { workspace, page } = await seed();
    await prisma.target.update({
      where: { id: page.id },
      data: { canPublish: false, publishBlocker: 'Missing publish permission.' },
    });

    expect(
      (
        await connections.setTargetEnabled({
          workspaceId: workspace.id,
          role: WorkspaceRole.owner,
          targetId: page.id,
          enabled: false,
        })
      ).outcome,
    ).toBe('ok');
  });

  it('will not touch another workspace’s destination', async () => {
    const mine = await seed('mine');
    const theirs = await seed('theirs');

    const result = await connections.setTargetEnabled({
      workspaceId: mine.workspace.id,
      role: WorkspaceRole.owner,
      targetId: theirs.page.id,
      enabled: false,
    });

    expect(result.outcome).toBe('not_found');
    expect((await prisma.target.findUniqueOrThrow({ where: { id: theirs.page.id } })).enabled).toBe(
      true,
    );
  });
});

describe('setLinkedAccountEnabled', () => {
  it('pauses an Instagram account without deleting what it captured', async () => {
    const { workspace, instagram } = await seed();

    expect(
      (
        await connections.setLinkedAccountEnabled({
          workspaceId: workspace.id,
          role: WorkspaceRole.admin,
          kind: 'instagram',
          id: instagram.id,
          enabled: false,
        })
      ).outcome,
    ).toBe('ok');

    const row = await prisma.instagramAccount.findUniqueOrThrow({ where: { id: instagram.id } });
    expect(row.enabled).toBe(false);
  });

  it('pauses an ad account', async () => {
    const { workspace, adAccount } = await seed();

    await connections.setLinkedAccountEnabled({
      workspaceId: workspace.id,
      role: WorkspaceRole.admin,
      kind: 'ads',
      id: adAccount.id,
      enabled: false,
    });

    expect((await prisma.adAccount.findUniqueOrThrow({ where: { id: adAccount.id } })).enabled).toBe(
      false,
    );
  });

  it('refuses a contributor', async () => {
    const { workspace, instagram } = await seed();
    const result = await connections.setLinkedAccountEnabled({
      workspaceId: workspace.id,
      role: WorkspaceRole.contributor,
      kind: 'instagram',
      id: instagram.id,
      enabled: false,
    });
    expect(result.outcome).toBe('forbidden');
  });

  it('will not touch another workspace’s account', async () => {
    const mine = await seed('mine');
    const theirs = await seed('theirs');

    for (const kind of ['instagram', 'ads'] as const) {
      const id = kind === 'instagram' ? theirs.instagram.id : theirs.adAccount.id;
      const result = await connections.setLinkedAccountEnabled({
        workspaceId: mine.workspace.id,
        role: WorkspaceRole.owner,
        kind,
        id,
        enabled: false,
      });
      expect(result.outcome, kind).toBe('not_found');
    }

    expect((await prisma.instagramAccount.findUniqueOrThrow({ where: { id: theirs.instagram.id } })).enabled).toBe(true);
  });
});

describe('removeLinkedAccount', () => {
  it('deletes the account and its captured rows', async () => {
    const { workspace, instagram } = await seed();
    await prisma.instagramMedia.create({
      data: { accountId: instagram.id, remoteId: 'm1', timestamp: new Date() },
    });

    expect(
      (
        await connections.removeLinkedAccount({
          workspaceId: workspace.id,
          role: WorkspaceRole.owner,
          kind: 'instagram',
          id: instagram.id,
        })
      ).outcome,
    ).toBe('ok');

    expect(await prisma.instagramAccount.count()).toBe(0);
    // Cascades, so a re-discovered account does not inherit stale media.
    expect(await prisma.instagramMedia.count()).toBe(0);
  });

  it('reports not found rather than success for an unknown id', async () => {
    const { workspace } = await seed();
    const result = await connections.removeLinkedAccount({
      workspaceId: workspace.id,
      role: WorkspaceRole.owner,
      kind: 'ads',
      id: 'does-not-exist',
    });
    expect(result.outcome).toBe('not_found');
  });

  it('refuses an editor', async () => {
    const { workspace, adAccount } = await seed();
    const result = await connections.removeLinkedAccount({
      workspaceId: workspace.id,
      role: WorkspaceRole.editor,
      kind: 'ads',
      id: adAccount.id,
    });
    expect(result.outcome).toBe('forbidden');
    expect(await prisma.adAccount.count()).toBe(1);
  });
});

describe('disconnect', () => {
  it('removes the account and disables everything it reached', async () => {
    const { workspace, account, page } = await seed();

    expect(
      (
        await connections.disconnect({
          workspaceId: workspace.id,
          role: WorkspaceRole.owner,
          socialAccountId: account.id,
        })
      ).outcome,
    ).toBe('ok');

    expect(await prisma.socialAccount.count()).toBe(0);

    // The destination survives so published history is not lost, but it stops
    // being publishable and says why.
    const after = await prisma.target.findUniqueOrThrow({ where: { id: page.id } });
    expect(after.enabled).toBe(false);
    expect(after.canPublish).toBe(false);
    expect(after.accessToken).toBeNull();
    expect(after.publishBlocker).toMatch(/disconnected/i);
  });

  it('cancels work that was queued against it', async () => {
    const { workspace, account, page, user } = await seed();
    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        message: 'Scheduled',
        status: 'scheduled',
        targets: { create: { targetId: page.id, status: 'pending' } },
      },
      include: { targets: true },
    });

    await connections.disconnect({
      workspaceId: workspace.id,
      role: WorkspaceRole.owner,
      socialAccountId: account.id,
    });

    const target = await prisma.postTarget.findUniqueOrThrow({ where: { id: post.targets[0]!.id } });
    expect(target.status).toBe('cancelled');
    expect(target.errorMessage).toMatch(/disconnected/i);
  });

  it('reports not found for another workspace’s account rather than claiming success', async () => {
    // The bug this replaces: the delete was correctly scoped, so nothing
    // happened — but the caller was told the disconnection had worked.
    const mine = await seed('mine');
    const theirs = await seed('theirs');

    const result = await connections.disconnect({
      workspaceId: mine.workspace.id,
      role: WorkspaceRole.owner,
      socialAccountId: theirs.account.id,
    });

    expect(result.outcome).toBe('not_found');
    expect(await prisma.socialAccount.count({ where: { id: theirs.account.id } })).toBe(1);
  });

  it('refuses an editor', async () => {
    const { workspace, account } = await seed();
    const result = await connections.disconnect({
      workspaceId: workspace.id,
      role: WorkspaceRole.editor,
      socialAccountId: account.id,
    });
    expect(result.outcome).toBe('forbidden');
    expect(await prisma.socialAccount.count()).toBe(1);
  });
});

describe('checkAccountHealth', () => {
  it('will not read another workspace’s token', async () => {
    // It reads a token and can mark an account dead. Being safe only because
    // every caller remembered to check ownership first is the same assumption
    // that let disconnect report success for another tenant.
    const accounts = await import('../src/lib/accounts');
    const mine = await seed('mine');
    const theirs = await seed('theirs');

    expect(await accounts.checkAccountHealth(theirs.account.id, mine.workspace.id)).toBeNull();
  });

  it('returns null for an id that does not exist at all', async () => {
    const accounts = await import('../src/lib/accounts');
    const { workspace } = await seed();

    expect(await accounts.checkAccountHealth('nope', workspace.id)).toBeNull();
  });
});

/**
 * The capability table itself.
 *
 * Every hole fixed in this area was a route that forgot to ask. Asserting the
 * matrix keeps the answers in one place and makes a widened permission a
 * deliberate, visible change rather than a one-line edit nobody reviews.
 */
describe('capabilities', () => {
  const ROLES = [
    WorkspaceRole.owner,
    WorkspaceRole.admin,
    WorkspaceRole.editor,
    WorkspaceRole.contributor,
  ] as const;

  it('matches the intended matrix', async () => {
    const c = await import('../src/lib/constants');

    // canManageInstance is not on this list on purpose: it answers from the
    // installation-owner flag, never from a workspace role. See below.
    const expected: Record<string, WorkspaceRole[]> = {
      canManageAccounts: [WorkspaceRole.owner, WorkspaceRole.admin],
      canManageTeam: [WorkspaceRole.owner, WorkspaceRole.admin],
      canManageSettings: [WorkspaceRole.owner, WorkspaceRole.admin],
      canApprove: [WorkspaceRole.owner, WorkspaceRole.admin],
      canDeleteComments: [WorkspaceRole.owner, WorkspaceRole.admin],
      canModerateComments: [WorkspaceRole.owner, WorkspaceRole.admin, WorkspaceRole.editor],
    };

    for (const [name, allowed] of Object.entries(expected)) {
      const check = (c as unknown as Record<string, (role: WorkspaceRole) => boolean>)[name]!;
      for (const role of ROLES) {
        expect(check(role), `${name}(${role})`).toBe(allowed.includes(role));
      }
    }
  });

  it('never grants a lower role something a higher one lacks', async () => {
    const c = await import('../src/lib/constants');
    const checks = Object.entries(c).filter(
      ([name, value]) => name.startsWith('can') && typeof value === 'function',
    ) as Array<[string, (role: WorkspaceRole) => boolean]>;

    for (const [name, check] of checks) {
      // canCompose takes no role; skip anything that ignores its argument.
      if (check.length === 0) continue;
      // Takes the auth context, not a role; it has its own test below.
      if (name === 'canManageInstance') continue;
      for (let index = 1; index < ROLES.length; index += 1) {
        const higher = check(ROLES[index - 1]!);
        const lower = check(ROLES[index]!);
        expect(!lower || higher, `${name}: ${ROLES[index]} without ${ROLES[index - 1]}`).toBe(true);
      }
    }
  });

  it('keeps instance settings for the installation owner, whatever the workspace role', async () => {
    // Everybody who registers owns a workspace of their own, so "owner" of the
    // active workspace admitted anybody an admin had ever invited.
    const c = await import('../src/lib/constants');

    for (const role of ROLES) {
      const installer = { role, isInstanceOwner: true };
      const everyoneElse = { role, isInstanceOwner: false };
      expect(c.canManageInstance(installer), role).toBe(true);
      expect(c.canManageInstance(everyoneElse), role).toBe(false);
    }
  });
});

describe('summariseConnections', () => {
  const now = new Date('2026-09-01T10:00:00Z');

  it('counts what is connected', async () => {
    const { workspace } = await seed();
    const summary = await connections.summariseConnections(workspace.id, { now });

    expect(summary).toMatchObject({
      accounts: 1,
      pages: 1,
      groups: 0,
      instagram: 1,
      adAccounts: 1,
      broken: 0,
      expiring: 0,
    });
  });

  it('separates a dead token from one that is merely close to expiry', async () => {
    const { workspace, account } = await seed();
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-09-04T10:00:00Z') },
    });

    expect((await connections.summariseConnections(workspace.id, { now })).expiring).toBe(1);

    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { invalidatedAt: now, invalidReason: 'Token expired.' },
    });

    const after = await connections.summariseConnections(workspace.id, { now });
    expect(after.broken).toBe(1);
    // Already broken is not also "expiring soon" — it has already happened.
    expect(after.expiring).toBe(0);
  });

  it('ignores a token that expires beyond the warning window', async () => {
    const { workspace, account } = await seed();
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-10-30T10:00:00Z') },
    });

    expect((await connections.summariseConnections(workspace.id, { now })).expiring).toBe(0);
  });

  it('counts only this workspace', async () => {
    const mine = await seed('mine');
    await seed('theirs');

    const summary = await connections.summariseConnections(mine.workspace.id, { now });
    expect(summary.accounts).toBe(1);
    expect(summary.instagram).toBe(1);
  });
});

/**
 * Disconnecting an account that Facebook is still holding posts for.
 *
 * Disconnecting is the strongest "stop everything" gesture the product has,
 * and natively scheduled posts are the one thing it cannot stop by forgetting
 * about them: they live on Facebook and publish on their own. Worse, the
 * tokens that could delete them are wiped by the disconnect itself, so once it
 * has run there is no way back — the posts keep arriving on a client's Page
 * for an account the customer believes they removed.
 */
describe('disconnecting while Facebook holds scheduled posts', () => {
  async function seedHandedOff() {
    const seeded = await seed();
    const post = await prisma.post.create({
      data: {
        workspaceId: seeded.workspace.id,
        authorId: seeded.user.id,
        message: 'Facebook has this one',
        status: 'scheduled',
        publishMode: 'native',
        scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        targets: {
          create: {
            targetId: seeded.page.id,
            status: 'scheduled_remote',
            remotePostId: '1000_4242',
            nativeScheduledFor: new Date(Date.now() + 3 * 60 * 60 * 1000),
          },
        },
      },
      include: { targets: true },
    });
    return { ...seeded, postTarget: post.targets[0]! };
  }

  it('deletes them on Facebook while it still can', async () => {
    const seeded = await seedHandedOff();

    const result = await connections.disconnect({
      workspaceId: seeded.workspace.id,
      role: WorkspaceRole.owner,
      socialAccountId: seeded.account.id,
    });
    expect(result.outcome).toBe('ok');

    // The delete has to happen before the tokens are wiped; afterwards there
    // is nothing left to authenticate with.
    expect(received.some((call) => call.method === 'DELETE' && call.path.includes('1000_4242'))).toBe(
      true,
    );

    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: seeded.postTarget.id } });
    expect(after.status).toBe('cancelled');
  });

  it('says which ones it could not stop', async () => {
    const seeded = await seedHandedOff();
    denied = ['1000_4242'];

    const result = await connections.disconnect({
      workspaceId: seeded.workspace.id,
      role: WorkspaceRole.owner,
      socialAccountId: seeded.account.id,
    });

    // The account still goes: the customer asked for it, and refusing would
    // leave them unable to disconnect at all. But a post that is still going
    // to publish must not be recorded as cancelled, and the caller has to be
    // told, because this is the last moment anyone could have acted on it.
    expect(result.outcome).toBe('ok');
    expect(result.stillScheduledOnFacebook).toBe(1);

    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: seeded.postTarget.id } });
    expect(after.status).toBe('scheduled_remote');
    expect(await prisma.socialAccount.count()).toBe(0);
  });

  it('leaves ordinary queued work cancelled as before', async () => {
    const seeded = await seedHandedOff();
    await prisma.postTarget.update({
      where: { id: seeded.postTarget.id },
      data: { status: 'pending', remotePostId: null },
    });

    await connections.disconnect({
      workspaceId: seeded.workspace.id,
      role: WorkspaceRole.owner,
      socialAccountId: seeded.account.id,
    });

    // Nothing was handed to Facebook, so nothing should have been asked of it.
    expect(received.some((call) => call.method === 'DELETE')).toBe(false);
    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: seeded.postTarget.id } });
    expect(after.status).toBe('cancelled');
  });
});

/**
 * Turning off a destination Facebook is holding posts for.
 *
 * Unlike disconnecting, this is a reversible switch and the tokens survive, so
 * deleting the posts on Facebook would be a surprising thing for a toggle to
 * do — and turning it back on could not undo it. Leaving them to publish is
 * right. Saying nothing about it is not: a queued post appears on a Page the
 * owner has just turned off, and nothing on the screen suggested that could
 * happen.
 */
describe('turning off a destination with posts inside Facebook', () => {
  async function seedHandedOff() {
    const seeded = await seed();
    await prisma.post.create({
      data: {
        workspaceId: seeded.workspace.id,
        authorId: seeded.user.id,
        message: 'Facebook has this one',
        status: 'scheduled',
        publishMode: 'native',
        scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        targets: {
          create: {
            targetId: seeded.page.id,
            status: 'scheduled_remote',
            remotePostId: '1000_4242',
            nativeScheduledFor: new Date(Date.now() + 3 * 60 * 60 * 1000),
          },
        },
      },
    });
    return seeded;
  }

  it('says how many will still publish', async () => {
    const seeded = await seedHandedOff();

    const result = await connections.setTargetEnabled({
      workspaceId: seeded.workspace.id,
      role: WorkspaceRole.owner,
      targetId: seeded.page.id,
      enabled: false,
    });

    expect(result.outcome).toBe('ok');
    expect(result.stillScheduledOnFacebook).toBe(1);
  });

  it('leaves them alone, because the switch can be flipped back', async () => {
    const seeded = await seedHandedOff();

    await connections.setTargetEnabled({
      workspaceId: seeded.workspace.id,
      role: WorkspaceRole.owner,
      targetId: seeded.page.id,
      enabled: false,
    });

    // Nothing asked of Facebook: deleting a scheduled post is not something a
    // reversible toggle should do, and the post is still cancellable on its
    // own while the account is connected.
    expect(received.some((call) => call.method === 'DELETE')).toBe(false);
    const row = await prisma.postTarget.findFirstOrThrow({ where: { targetId: seeded.page.id } });
    expect(row.status).toBe('scheduled_remote');
  });

  it('counts only what is still waiting, not the whole history', async () => {
    const seeded = await seedHandedOff();

    // A published post and a cancelled one on the same destination. Counting
    // rows rather than queued ones would report a Page's whole history as
    // about to publish.
    const second = await prisma.post.create({
      data: {
        workspaceId: seeded.workspace.id,
        authorId: seeded.user.id,
        message: 'Already out',
        status: 'published',
        targets: { create: { targetId: seeded.page.id, status: 'published' } },
      },
    });
    await prisma.post.create({
      data: {
        workspaceId: seeded.workspace.id,
        authorId: seeded.user.id,
        message: 'Called off',
        status: 'cancelled',
        targets: { create: { targetId: seeded.page.id, status: 'cancelled' } },
      },
    });
    expect(second.id).toBeTruthy();

    const result = await connections.setTargetEnabled({
      workspaceId: seeded.workspace.id,
      role: WorkspaceRole.owner,
      targetId: seeded.page.id,
      enabled: false,
    });

    expect(result.stillScheduledOnFacebook).toBe(1);
  });

  it('says nothing when there is nothing waiting', async () => {
    const seeded = await seed();

    const result = await connections.setTargetEnabled({
      workspaceId: seeded.workspace.id,
      role: WorkspaceRole.owner,
      targetId: seeded.page.id,
      enabled: false,
    });

    expect(result.stillScheduledOnFacebook).toBeUndefined();
  });

  it('does not warn when turning one back on', async () => {
    const seeded = await seedHandedOff();
    await prisma.target.update({ where: { id: seeded.page.id }, data: { enabled: false } });

    const result = await connections.setTargetEnabled({
      workspaceId: seeded.workspace.id,
      role: WorkspaceRole.owner,
      targetId: seeded.page.id,
      enabled: true,
    });

    // Switching it on is not a moment anyone needs warning about.
    expect(result.stillScheduledOnFacebook).toBeUndefined();
  });
});

/**
 * The counts have to survive the trip to the screen.
 *
 * `disconnect` and `setTargetEnabled` both work out how many posts Facebook
 * will publish regardless, and both were returning it into a route that threw
 * it away. A warning nobody renders is the same silence one layer further out.
 */
describe('reporting what Facebook will still publish', () => {
  const targetRoute = readFileSync('src/app/api/targets/[id]/route.ts', 'utf8');
  const accountRoute = readFileSync('src/app/api/accounts/[id]/route.ts', 'utf8');
  const client = readFileSync('src/components/ConnectionsClient.tsx', 'utf8');

  it('is passed on by the route that turns a destination off', () => {
    expect(targetRoute).toContain('stillScheduledOnFacebook: result.stillScheduledOnFacebook');
  });

  it('is passed on by the route that disconnects an account', () => {
    expect(accountRoute).toContain('stillScheduledOnFacebook: result.stillScheduledOnFacebook');
  });

  it('is shown to whoever pressed the button', () => {
    expect(client).toContain("t('stillScheduledOff'");
    expect(client).toContain("t('stillScheduledGone'");
  });

  it('goes through the toggle helper on every destination list', () => {
    // Pages, Groups and Instagram each render their own list, and one wired
    // straight to `call` would silently drop the warning for that kind.
    expect(client.match(/onToggle=\{\(id, enabled\) => toggleTarget\(id, enabled\)\}/g)).toHaveLength(3);
    const lists = client.slice(client.indexOf('<TargetList'));
    expect(lists).not.toMatch(/onToggle=\{\(id, enabled\) =>\s*call\(/);
  });

  it('says it in both languages, counting properly', () => {
    for (const [language, messages] of [['en', en], ['fr', fr]] as const) {
      const connections = messages.connections as unknown as Record<string, string>;
      for (const key of ['stillScheduledOff', 'stillScheduledGone']) {
        expect(connections[key], `${language} ${key}`).toContain('{count, plural,');
      }
    }
  });
});
