import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

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

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('connections');

  ({ prisma } = await import('../src/lib/prisma'));
  connections = await import('../src/lib/connections');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
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
