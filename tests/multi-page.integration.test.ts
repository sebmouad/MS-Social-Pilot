import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * The multi-Page features against a real database: the queue's per-Page
 * timetables, groups and labels, and limiting a member to some Pages.
 */

let database: TestDatabase;
type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let posts: typeof import('../src/lib/posts');
let groups: typeof import('../src/lib/page-groups');
let team: typeof import('../src/lib/team');
let comments: typeof import('../src/lib/first-comment');

/** A Thursday morning; the queue slots below are on Fridays. */
const now = new Date('2026-10-01T06:00:00Z');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('multipage');
  ({ prisma } = await import('../src/lib/prisma'));
  posts = await import('../src/lib/posts');
  groups = await import('../src/lib/page-groups');
  team = await import('../src/lib/team');
  comments = await import('../src/lib/first-comment');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.postLabel.deleteMany();
  await prisma.label.deleteMany();
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.queueSlot.deleteMany();
  await prisma.pageGroup.deleteMany();
  await prisma.memberPageAccess.deleteMany();
  await prisma.target.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed() {
  const owner = await prisma.user.create({ data: { email: 'owner@example.test', name: 'Owner', passwordHash: 'x' } });
  const editor = await prisma.user.create({ data: { email: 'editor@example.test', name: 'Editor', passwordHash: 'x' } });
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Agency',
      slug: 'agency',
      timezone: 'UTC',
      memberships: {
        create: [
          { userId: owner.id, role: WorkspaceRole.owner },
          { userId: editor.id, role: WorkspaceRole.editor },
        ],
      },
    },
  });
  const page = (name: string) =>
    prisma.target.create({ data: { workspaceId: workspace.id, type: 'page', providerId: name, name, accessToken: null } });
  const [bakery, garage] = await Promise.all([page('Bakery'), page('Garage')]);
  return { owner, editor, workspace, bakery, garage };
}

const context = (workspaceId: string, userId: string) => ({
  workspaceId,
  userId,
  role: WorkspaceRole.owner,
  requiresApproval: false,
});

const queued = (targetIds: string[]) => ({
  message: 'Fresh bread',
  media: [],
  targetIds,
  publishMode: 'worker' as const,
  timezone: 'UTC',
  useQueue: true,
  saveAsDraft: false,
});

describe('the queue, per Page', () => {
  it('puts a post in its own Page’s time, and two Pages’ posts can share a shared time', async () => {
    const { owner, workspace, bakery, garage } = await seed();
    await prisma.queueSlot.createMany({
      data: [
        { workspaceId: workspace.id, dayOfWeek: 5, hour: 9, minute: 0, targetId: null },
        { workspaceId: workspace.id, dayOfWeek: 5, hour: 7, minute: 0, targetId: bakery.id },
      ],
    });

    const first = await posts.createPost(context(workspace.id, owner.id), queued([bakery.id]), now);
    expect(first.scheduledAt?.toISOString()).toBe('2026-10-02T07:00:00.000Z');

    const second = await posts.createPost(context(workspace.id, owner.id), queued([bakery.id]), now);
    expect(second.scheduledAt?.toISOString()).toBe('2026-10-02T09:00:00.000Z');

    // The garage's own feed is empty at nine: a bakery post there does not fill it.
    const garagePost = await posts.createPost(context(workspace.id, owner.id), queued([garage.id]), now);
    expect(garagePost.scheduledAt?.toISOString()).toBe('2026-10-02T09:00:00.000Z');
  });
});

describe('labels', () => {
  it('saves a post’s labels, ignoring ids from elsewhere', async () => {
    const { owner, workspace, bakery } = await seed();
    const label = await groups.createLabel(workspace.id, { name: 'Summer', color: 'amber' });
    const created = await posts.createPost(
      context(workspace.id, owner.id),
      { ...queued([bakery.id]), useQueue: false, saveAsDraft: true, labelIds: [label.id, 'not-ours'] },
      now,
    );
    const rows = await prisma.postLabel.findMany({ where: { postId: created.postId } });
    expect(rows.map((row) => row.labelId)).toEqual([label.id]);
  });

  it('refuses a second label with the same name', async () => {
    const { workspace } = await seed();
    await groups.createLabel(workspace.id, { name: 'Summer', color: 'amber' });
    await expect(groups.createLabel(workspace.id, { name: 'Summer', color: 'blue' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('page groups', () => {
  it('lists only the Pages a limited member may see', async () => {
    const { workspace, bakery, garage } = await seed();
    await groups.createPageGroup(workspace.id, { name: 'All shops', color: 'blue', targetIds: [bakery.id, garage.id] });
    const seen = await groups.listPageGroups(workspace.id, { all: false, ids: [bakery.id] });
    expect(seen[0]?.targetIds).toEqual([bakery.id]);
  });
});

describe('limiting a member to some Pages', () => {
  it('stores the limit, and lifts it again', async () => {
    const { editor, workspace, bakery } = await seed();
    await team.setPageAccess(workspace.id, editor.id, { all: false, targetIds: [bakery.id, 'not-ours'] }, WorkspaceRole.owner);

    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: editor.id, workspaceId: workspace.id },
      include: { pages: true },
    });
    expect(membership.allPages).toBe(false);
    expect(membership.pages.map((row) => row.targetId)).toEqual([bakery.id]);

    await team.setPageAccess(workspace.id, editor.id, { all: true, targetIds: [] }, WorkspaceRole.owner);
    const lifted = await prisma.membership.findFirstOrThrow({
      where: { userId: editor.id, workspaceId: workspace.id },
      include: { pages: true },
    });
    expect(lifted.allPages).toBe(true);
    expect(lifted.pages).toEqual([]);
  });

  it('will not limit an admin, whose access the limit could not hold', async () => {
    const { owner, workspace, bakery } = await seed();
    await expect(
      team.setPageAccess(workspace.id, owner.id, { all: false, targetIds: [bakery.id] }, WorkspaceRole.owner),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('delayed first comments', () => {
  it('leaves a comment that is not due yet alone', async () => {
    const { owner, workspace, bakery } = await seed();
    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        message: 'Out now',
        firstComment: '#bread',
        firstCommentDelayMinutes: 30,
        status: 'published',
        targets: {
          create: [{ targetId: bakery.id, status: 'published', remotePostId: 'p_1', publishedAt: new Date('2026-10-01T05:50:00Z') }],
        },
      },
      include: { targets: true },
    });

    expect(await comments.postFirstComment(post.targets[0]!.id, now)).toBe('waiting');
    // Nothing claimed: the sweep can still come back for it.
    const row = await prisma.postTarget.findUniqueOrThrow({ where: { id: post.targets[0]!.id } });
    expect(row.firstCommentAt).toBeNull();
    expect(await comments.postDueFirstComments(now)).toEqual({ posted: 0, failed: 0 });
  });
});
