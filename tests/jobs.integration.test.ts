import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { PostStatus, WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * The worker's background jobs.
 *
 * These are the ones nobody watches, so a regression here is invisible until a
 * customer notices: a token expiring with no warning, or an evergreen post
 * quietly repeating itself forever.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let jobs: typeof import('../src/lib/scheduler/jobs');
let evergreen: typeof import('../src/lib/evergreen');

const logger = () => undefined;

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('jobs');

  ({ prisma } = await import('../src/lib/prisma'));
  jobs = await import('../src/lib/scheduler/jobs');
  evergreen = await import('../src/lib/evergreen');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.target.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.notificationSetting.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seedWorkspace() {
  const { encryptSecret } = await import('../src/lib/crypto');

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
  const account = await prisma.socialAccount.create({
    data: {
      workspaceId: workspace.id,
      providerUserId: randomBytes(4).toString('hex'),
      name: 'Sam Jones',
      accessToken: encryptSecret('user-token'),
    },
  });
  const target = await prisma.target.create({
    data: {
      workspaceId: workspace.id,
      socialAccountId: account.id,
      type: 'page',
      providerId: '1000',
      name: 'Client Page',
      accessToken: encryptSecret('page-token'),
    },
  });

  return { user, workspace, account, target };
}

describe('token expiry warnings', () => {
  const now = new Date('2026-09-01T10:00:00Z');

  it('warns about a token expiring within a week', async () => {
    const { account } = await seedWorkspace();
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-09-05T10:00:00Z') },
    });

    const summary = await jobs.runTokenExpiryCheck({ now, logger });
    expect(summary).toMatch(/1 expiring token/);

    const after = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(after.expiryWarningSentAt).not.toBeNull();

    const email = await prisma.emailLog.findFirst({ where: { template: 'tokenExpiring' } });
    expect(email?.subject).toContain('Sam Jones');
  });

  it('warns only once per token', async () => {
    const { account } = await seedWorkspace();
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-09-05T10:00:00Z') },
    });

    await jobs.runTokenExpiryCheck({ now, logger });
    // A daily job must not email daily about the same token.
    const second = await jobs.runTokenExpiryCheck({ now, logger });

    expect(second).toBeNull();
    expect(await prisma.emailLog.count({ where: { template: 'tokenExpiring' } })).toBe(1);
  });

  it('ignores a token that is not near expiry', async () => {
    const { account } = await seedWorkspace();
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-11-01T10:00:00Z') },
    });

    expect(await jobs.runTokenExpiryCheck({ now, logger })).toBeNull();
  });

  it('ignores an already-expired token', async () => {
    // Nothing to warn about: it has already failed, and the failure path
    // handles telling people.
    const { account } = await seedWorkspace();
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-08-01T10:00:00Z') },
    });

    expect(await jobs.runTokenExpiryCheck({ now, logger })).toBeNull();
  });

  it('ignores a connection already flagged invalid', async () => {
    const { account } = await seedWorkspace();
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-09-05T10:00:00Z'), invalidatedAt: now },
    });

    expect(await jobs.runTokenExpiryCheck({ now, logger })).toBeNull();
  });

  it('respects an opt-out', async () => {
    const { account, user, workspace } = await seedWorkspace();
    await prisma.notificationSetting.create({
      data: { userId: user.id, workspaceId: workspace.id, onTokenExpiry: false },
    });
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { tokenExpiresAt: new Date('2026-09-05T10:00:00Z') },
    });

    await jobs.runTokenExpiryCheck({ now, logger });
    expect(await prisma.emailLog.count({ where: { template: 'tokenExpiring' } })).toBe(0);
  });
});

describe('evergreen recycling', () => {
  const now = new Date('2026-09-01T10:00:00Z');

  async function seedEvergreen(overrides: { variants?: string[]; limit?: number | null } = {}) {
    const { user, workspace, target } = await seedWorkspace();
    const { toJson } = await import('../src/lib/json');

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        message: 'Original wording',
        status: PostStatus.published,
        publishedAt: new Date('2026-08-01T10:00:00Z'),
        scheduledAt: new Date('2026-08-01T10:00:00Z'),
        recycleEnabled: true,
        recycleEveryDays: 30,
        recycleLimit: overrides.limit === undefined ? 2 : overrides.limit,
        recycleNextAt: new Date('2026-08-31T10:00:00Z'),
        variants: toJson(overrides.variants ?? ['Second wording']),
        targets: { create: { targetId: target.id, status: 'published' } },
      },
    });

    return { post, workspace, target };
  }

  it('creates a copy rather than republishing the original row', async () => {
    const { post } = await seedEvergreen();

    const result = await evergreen.runEvergreenCycle({ now, logger });
    expect(result.created).toBe(1);

    const copy = await prisma.post.findFirstOrThrow({ where: { originPostId: post.id } });
    expect(copy.id).not.toBe(post.id);
    expect(copy.status).toBe(PostStatus.scheduled);

    // The original keeps its own published history intact.
    const original = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(original.status).toBe(PostStatus.published);
    expect(original.recycleCount).toBe(1);
  });

  it('uses the next variant, so Facebook does not reject it as a duplicate', async () => {
    const { post } = await seedEvergreen();

    await evergreen.runEvergreenCycle({ now, logger });

    const copy = await prisma.post.findFirstOrThrow({ where: { originPostId: post.id } });
    expect(copy.message).toBe('Second wording');
  });

  it('copies the destinations', async () => {
    const { post, target } = await seedEvergreen();

    await evergreen.runEvergreenCycle({ now, logger });

    const copy = await prisma.post.findFirstOrThrow({
      where: { originPostId: post.id },
      include: { targets: true },
    });
    expect(copy.targets.map((entry) => entry.targetId)).toEqual([target.id]);
    expect(copy.targets[0]!.status).toBe('pending');
  });

  it('stops once the repeat limit is reached', async () => {
    const { post } = await seedEvergreen({ limit: 1 });

    await evergreen.runEvergreenCycle({ now, logger });

    const original = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(original.recycleEnabled).toBe(false);
    expect(original.recycleNextAt).toBeNull();
  });

  it('schedules the following repeat when below the limit', async () => {
    const { post } = await seedEvergreen({ limit: 5 });

    await evergreen.runEvergreenCycle({ now, logger });

    const original = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(original.recycleEnabled).toBe(true);
    expect(original.recycleNextAt?.toISOString()).toBe('2026-09-30T10:00:00.000Z');
  });

  it('leaves a post that is not due yet alone', async () => {
    const { post } = await seedEvergreen();
    await prisma.post.update({
      where: { id: post.id },
      data: { recycleNextAt: new Date('2026-12-01T10:00:00Z') },
    });

    expect((await evergreen.runEvergreenCycle({ now, logger })).created).toBe(0);
  });

  it('gives up on a post whose destinations have all gone', async () => {
    const { post } = await seedEvergreen();
    await prisma.postTarget.deleteMany({ where: { postId: post.id } });

    const result = await evergreen.runEvergreenCycle({ now, logger });
    expect(result.created).toBe(0);
    expect(result.finished).toBe(1);

    const original = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(original.recycleEnabled).toBe(false);
  });

  it('does not recycle a post that never published', async () => {
    const { post } = await seedEvergreen();
    await prisma.post.update({ where: { id: post.id }, data: { status: PostStatus.failed } });

    expect((await evergreen.runEvergreenCycle({ now, logger })).created).toBe(0);
  });
});
