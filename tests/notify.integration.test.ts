import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Locale, WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Who gets told when something goes wrong.
 *
 * This is the module that decides whether a failed post is noticed within the
 * hour or when a client asks why their page has gone quiet. Two decisions in it
 * carry that weight: absence of a preference row means opted *in*, and one bad
 * address must not silence everybody else in the workspace.
 *
 * No email provider is configured here, so `sendEmail` records a `skipped` row
 * rather than sending. The EmailLog is therefore a faithful record of who
 * *would* have been written to, which is exactly what these assert on.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let notify: typeof import('../src/lib/email/notify');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('notify');

  ({ prisma } = await import('../src/lib/prisma'));
  notify = await import('../src/lib/email/notify');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.emailLog.deleteMany();
  await prisma.notificationSetting.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seedWorkspace() {
  const workspace = await prisma.workspace.create({
    data: { name: 'Client', slug: `client-${randomBytes(3).toString('hex')}`, timezone: 'UTC' },
  });
  return workspace;
}

async function addMember(
  workspaceId: string,
  role: WorkspaceRole,
  options: { locale?: Locale } = {},
) {
  const user = await prisma.user.create({
    data: {
      email: `${role}-${randomBytes(3).toString('hex')}@example.com`,
      name: `A ${role}`,
      passwordHash: 'x',
      locale: options.locale ?? Locale.en,
      memberships: { create: { workspaceId, role } },
    },
  });
  return user;
}

/** Who an attempt would have written to. */
async function recipients(workspaceId: string) {
  const logs = await prisma.emailLog.findMany({ where: { workspaceId }, select: { to: true } });
  return logs.map((log) => log.to).sort();
}

describe('a post that failed to publish', () => {
  it('tells everybody who has not opted out', async () => {
    const workspace = await seedWorkspace();
    const owner = await addMember(workspace.id, WorkspaceRole.owner);
    const contributor = await addMember(workspace.id, WorkspaceRole.contributor);

    await notify.notifyPublishFailure({
      workspaceId: workspace.id,
      targetName: 'Client Page',
      reason: 'The token expired.',
      scheduledAt: new Date(),
      postId: 'post-1',
    });

    expect(await recipients(workspace.id)).toEqual([owner.email, contributor.email].sort());
  });

  it('treats a member with no preferences as opted in', async () => {
    // A new workspace must warn about failures before anybody has visited the
    // settings screen. Defaulting to silence would mean the first failure of a
    // fresh installation is the one nobody hears about.
    const workspace = await seedWorkspace();
    const owner = await addMember(workspace.id, WorkspaceRole.owner);

    expect(await prisma.notificationSetting.count()).toBe(0);

    await notify.notifyPublishFailure({
      workspaceId: workspace.id,
      targetName: 'Client Page',
      reason: 'The token expired.',
      scheduledAt: null,
      postId: 'post-1',
    });

    expect(await recipients(workspace.id)).toEqual([owner.email]);
  });

  it('respects somebody who turned it off', async () => {
    const workspace = await seedWorkspace();
    const owner = await addMember(workspace.id, WorkspaceRole.owner);
    const quiet = await addMember(workspace.id, WorkspaceRole.editor);

    await prisma.notificationSetting.create({
      data: { userId: quiet.id, workspaceId: workspace.id, onPublishFailure: false },
    });

    await notify.notifyPublishFailure({
      workspaceId: workspace.id,
      targetName: 'Client Page',
      reason: 'The token expired.',
      scheduledAt: null,
      postId: 'post-1',
    });

    expect(await recipients(workspace.id)).toEqual([owner.email]);
  });

  it('keeps one workspace out of another', async () => {
    const mine = await seedWorkspace();
    const theirs = await seedWorkspace();
    const owner = await addMember(mine.id, WorkspaceRole.owner);
    await addMember(theirs.id, WorkspaceRole.owner);

    await notify.notifyPublishFailure({
      workspaceId: mine.id,
      targetName: 'Client Page',
      reason: 'The token expired.',
      scheduledAt: null,
      postId: 'post-1',
    });

    expect(await recipients(mine.id)).toEqual([owner.email]);
    expect(await recipients(theirs.id)).toEqual([]);
  });

  it('writes to each person in their own language', async () => {
    const workspace = await seedWorkspace();
    await addMember(workspace.id, WorkspaceRole.owner, { locale: Locale.en });
    await addMember(workspace.id, WorkspaceRole.editor, { locale: Locale.fr });

    await notify.notifyPublishFailure({
      workspaceId: workspace.id,
      targetName: 'Client Page',
      reason: 'The token expired.',
      scheduledAt: null,
      postId: 'post-1',
    });

    const subjects = (
      await prisma.emailLog.findMany({ where: { workspaceId: workspace.id }, select: { subject: true } })
    ).map((log) => log.subject);

    // One of each, rather than two of whichever language happened to be first.
    expect(new Set(subjects).size).toBe(2);
  });
});

describe('a connection about to expire', () => {
  it('tells only the people who can reconnect it', async () => {
    // A contributor cannot fix this, and telling them turns a warning that
    // matters into one more message to ignore.
    const workspace = await seedWorkspace();
    const owner = await addMember(workspace.id, WorkspaceRole.owner);
    const admin = await addMember(workspace.id, WorkspaceRole.admin);
    await addMember(workspace.id, WorkspaceRole.editor);
    await addMember(workspace.id, WorkspaceRole.contributor);

    await notify.notifyTokenExpiring({
      workspaceId: workspace.id,
      accountName: 'Sam Jones',
      expiresAt: new Date(),
      days: 5,
    });

    expect(await recipients(workspace.id)).toEqual([owner.email, admin.email].sort());
  });
});

describe('a decision on somebody\'s post', () => {
  it('goes to the author, not to the workspace', async () => {
    const workspace = await seedWorkspace();
    const author = await addMember(workspace.id, WorkspaceRole.contributor);
    await addMember(workspace.id, WorkspaceRole.owner);

    await notify.notifyApprovalDecision({
      workspaceId: workspace.id,
      authorId: author.id,
      reviewerName: 'The Owner',
      approved: true,
      scheduledAt: null,
    });

    expect(await recipients(workspace.id)).toEqual([author.email]);
  });

  it('says nothing when the author asked not to hear it', async () => {
    const workspace = await seedWorkspace();
    const author = await addMember(workspace.id, WorkspaceRole.contributor);
    await prisma.notificationSetting.create({
      data: { userId: author.id, workspaceId: workspace.id, onApprovalDecision: false },
    });

    await notify.notifyApprovalDecision({
      workspaceId: workspace.id,
      authorId: author.id,
      reviewerName: 'The Owner',
      approved: false,
      note: 'Please shorten it.',
      scheduledAt: null,
    });

    expect(await recipients(workspace.id)).toEqual([]);
  });
});

describe('when the notification itself goes wrong', () => {
  it('does not throw at the caller', async () => {
    // Every one of these is called from a publish or an approval. An email
    // failure must never become a failed post.
    await expect(
      notify.notifyPublishFailure({
        workspaceId: 'no-such-workspace',
        targetName: 'Client Page',
        reason: 'The token expired.',
        scheduledAt: null,
        postId: 'post-1',
      }),
    ).resolves.toBeUndefined();
  });
});
