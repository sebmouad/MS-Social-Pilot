import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { ApprovalStatus, PostStatus, WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * The approval workflow, and the isolation between clients.
 *
 * These two are tested together because they are the features where a bug is
 * not a cosmetic problem: an unapproved post reaching a client's Facebook Page,
 * or one agency client seeing another's content, are both the kind of failure
 * that loses the customer.
 */

let server: Server;
let database: TestDatabase;
let published: string[] = [];

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let runner: typeof import('../src/lib/scheduler/runner');
let approvals: typeof import('../src/lib/approvals');
let posts: typeof import('../src/lib/posts');
let team: typeof import('../src/lib/team');

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      published.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: '1000_5000' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');

  setTestEnv({ FACEBOOK_GRAPH_BASE_URL: `http://127.0.0.1:${address.port}` });
  database = setupTestDatabase('approvals');

  ({ prisma } = await import('../src/lib/prisma'));
  runner = await import('../src/lib/scheduler/runner');
  approvals = await import('../src/lib/approvals');
  posts = await import('../src/lib/posts');
  team = await import('../src/lib/team');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database?.drop();
});

beforeEach(async () => {
  published = [];
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.target.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.notificationSetting.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function makeUser(name: string) {
  return prisma.user.create({
    data: {
      email: `${name}-${randomBytes(3).toString('hex')}@example.com`,
      name,
      passwordHash: 'x',
    },
  });
}

async function makeWorkspace(options: {
  name: string;
  ownerId: string;
  requiresApproval?: boolean;
}) {
  const { encryptSecret } = await import('../src/lib/crypto');

  const workspace = await prisma.workspace.create({
    data: {
      name: options.name,
      slug: `${options.name.toLowerCase()}-${randomBytes(3).toString('hex')}`,
      timezone: 'UTC',
      requiresApproval: options.requiresApproval ?? false,
      memberships: { create: { userId: options.ownerId, role: WorkspaceRole.owner } },
    },
  });

  const account = await prisma.socialAccount.create({
    data: {
      workspaceId: workspace.id,
      providerUserId: randomBytes(4).toString('hex'),
      name: `${options.name} FB`,
      accessToken: encryptSecret('user-token'),
    },
  });

  const target = await prisma.target.create({
    data: {
      workspaceId: workspace.id,
      socialAccountId: account.id,
      type: 'page',
      providerId: '1000',
      name: `${options.name} Page`,
      accessToken: encryptSecret('page-token'),
    },
  });

  return { workspace, target };
}

/**
 * A wall-clock time comfortably in the future, worked out when the test runs.
 *
 * `createPost` refuses a scheduled time that has passed, and it uses the real
 * clock. A literal date is a test that passes until it does not: the suite goes
 * red one morning for no reason anyone changed.
 */
function futureLocalInput(daysAhead = 30): string {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T09:00`;
}

describe('approval gating in the scheduler', () => {
  it('does not publish a post awaiting approval, even once it is due', async () => {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval: true,
    });

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        message: 'Not approved yet',
        // Due five minutes ago: only the approval state should hold it back.
        status: PostStatus.pending_approval,
        approvalStatus: ApprovalStatus.pending,
        scheduledAt: new Date(Date.now() - 5 * 60 * 1000),
        targets: { create: { targetId: target.id } },
      },
    });

    const result = await runner.runSchedulerTick();

    expect(result.claimed).toBe(0);
    expect(published).toHaveLength(0);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.pending_approval);
  });

  it('publishes it once approved', async () => {
    const owner = await makeUser('Owner');
    const contributor = await makeUser('Contributor');
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval: true,
    });
    await prisma.membership.create({
      data: { userId: contributor.id, workspaceId: workspace.id, role: WorkspaceRole.contributor },
    });

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: contributor.id,
        submittedById: contributor.id,
        submittedAt: new Date(),
        message: 'Please review',
        status: PostStatus.pending_approval,
        approvalStatus: ApprovalStatus.pending,
        scheduledAt: new Date(Date.now() - 5 * 60 * 1000),
        targets: { create: { targetId: target.id } },
      },
    });

    await approvals.approvePost({
      workspaceId: workspace.id,
      postId: post.id,
      reviewerId: owner.id,
      reviewerRole: WorkspaceRole.owner,
    });

    const result = await runner.runSchedulerTick();
    expect(result.published).toBe(1);
    expect(published).toHaveLength(1);
  });

  it('never publishes a rejected post', async () => {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval: true,
    });

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        submittedById: owner.id,
        message: 'Needs work',
        status: PostStatus.pending_approval,
        approvalStatus: ApprovalStatus.pending,
        scheduledAt: new Date(Date.now() - 60 * 1000),
        targets: { create: { targetId: target.id } },
      },
    });

    await approvals.rejectPost({
      workspaceId: workspace.id,
      postId: post.id,
      reviewerId: owner.id,
      reviewerRole: WorkspaceRole.owner,
      note: 'Please shorten it.',
    });

    const result = await runner.runSchedulerTick();
    expect(result.claimed).toBe(0);
    expect(published).toHaveLength(0);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.approvalStatus).toBe(ApprovalStatus.rejected);
    expect(after.reviewNote).toBe('Please shorten it.');
  });

  /**
   * "Post now" is the one path that publishes without going through the
   * scheduler's due-work query, so the gate tested above does not cover it. A
   * held post that its author can push live on demand is not a review workflow.
   */
  async function seedHeldPost(state: ApprovalStatus) {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval: true,
    });

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        submittedById: owner.id,
        message: 'Held for review',
        status: state === ApprovalStatus.rejected ? PostStatus.rejected : PostStatus.pending_approval,
        approvalStatus: state,
        scheduledAt: new Date(Date.now() - 5 * 60 * 1000),
        targets: { create: { targetId: target.id } },
      },
    });

    return { post, workspace, owner };
  }

  it('refuses to publish a post awaiting approval on demand', async () => {
    const { post } = await seedHeldPost(ApprovalStatus.pending);

    await expect(runner.publishNow(post.id)).rejects.toThrow(/waiting for approval/i);
    expect(published).toHaveLength(0);

    // And it is left exactly as it was, not stranded in `publishing`.
    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.pending_approval);
    expect(after.approvalStatus).toBe(ApprovalStatus.pending);
  });

  it('refuses to publish a rejected post on demand', async () => {
    const { post } = await seedHeldPost(ApprovalStatus.rejected);

    await expect(runner.publishNow(post.id)).rejects.toThrow(/waiting for approval/i);
    expect(published).toHaveLength(0);
  });

  it('publishes on demand once a reviewer has approved it', async () => {
    const { post, workspace, owner } = await seedHeldPost(ApprovalStatus.pending);

    await approvals.approvePost({
      workspaceId: workspace.id,
      postId: post.id,
      reviewerId: owner.id,
      reviewerRole: WorkspaceRole.owner,
    });

    const result = await runner.publishNow(post.id);
    expect(result.published).toBe(1);
    expect(published).toHaveLength(1);
  });
});

/**
 * The workflow is a per-workspace switch, so it can be turned off while posts
 * are still queued behind it.
 */
describe('turning the workflow off', () => {
  async function seedPending(options: { scheduled: boolean }) {
    const owner = await makeUser('Owner');
    const contributor = await makeUser('Contributor');
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval: true,
    });
    await prisma.membership.create({
      data: { userId: contributor.id, workspaceId: workspace.id, role: WorkspaceRole.contributor },
    });

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: contributor.id,
        submittedById: contributor.id,
        submittedAt: new Date(),
        message: 'Queued behind review',
        status: PostStatus.pending_approval,
        approvalStatus: ApprovalStatus.pending,
        scheduledAt: options.scheduled ? new Date(Date.now() - 5 * 60 * 1000) : null,
        targets: { create: { targetId: target.id } },
      },
    });

    return { workspace, owner, post };
  }

  it('releases a post that was waiting, and lets it publish', async () => {
    const { workspace, owner, post } = await seedPending({ scheduled: true });

    const released = await approvals.releaseHeldPosts({
      workspaceId: workspace.id,
      userId: owner.id,
    });
    expect(released).toBe(1);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.approvalStatus).toBe(ApprovalStatus.not_required);
    expect(after.status).toBe(PostStatus.scheduled);

    // The point of releasing it: it is no longer stuck.
    const result = await runner.runSchedulerTick();
    expect(result.published).toBe(1);
  });

  it('returns one with no scheduled time to draft rather than to a time it cannot honour', async () => {
    const { workspace, owner, post } = await seedPending({ scheduled: false });

    await approvals.releaseHeldPosts({ workspaceId: workspace.id, userId: owner.id });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.draft);
    expect(after.approvalStatus).toBe(ApprovalStatus.not_required);
  });

  it('does not overturn a reviewer who said no', async () => {
    const { workspace, owner, post } = await seedPending({ scheduled: true });
    await approvals.rejectPost({
      workspaceId: workspace.id,
      postId: post.id,
      reviewerId: owner.id,
      reviewerRole: WorkspaceRole.owner,
      note: 'Off-brand.',
    });

    expect(await approvals.releaseHeldPosts({ workspaceId: workspace.id, userId: owner.id })).toBe(0);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.approvalStatus).toBe(ApprovalStatus.rejected);

    const result = await runner.runSchedulerTick();
    expect(result.claimed).toBe(0);
  });

  it('records why the posts moved', async () => {
    const { workspace, owner } = await seedPending({ scheduled: true });
    await approvals.releaseHeldPosts({ workspaceId: workspace.id, userId: owner.id });

    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { workspaceId: workspace.id, action: 'approvals.disabled' },
    });
    expect(entry.actorId).toBe(owner.id);
  });

  it('leaves another workspace alone', async () => {
    const first = await seedPending({ scheduled: true });
    const second = await seedPending({ scheduled: true });

    await approvals.releaseHeldPosts({ workspaceId: first.workspace.id, userId: first.owner.id });

    const untouched = await prisma.post.findUniqueOrThrow({ where: { id: second.post.id } });
    expect(untouched.approvalStatus).toBe(ApprovalStatus.pending);
  });
});

/**
 * Approval is granted to content, not to a row. A contributor can keep editing
 * an approved post right up until it publishes, so the reviewer's decision has
 * to stop covering it once the content moves.
 */
describe('editing after approval', () => {
  async function seedApproved(options: { requiresApproval?: boolean } = {}) {
    const owner = await makeUser('Owner');
    const contributor = await makeUser('Contributor');
    const requiresApproval = options.requiresApproval ?? true;
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval,
    });
    await prisma.membership.create({
      data: { userId: contributor.id, workspaceId: workspace.id, role: WorkspaceRole.contributor },
    });

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: contributor.id,
        submittedById: contributor.id,
        submittedAt: new Date(),
        reviewedById: owner.id,
        reviewedAt: new Date(),
        message: 'The approved wording',
        status: PostStatus.scheduled,
        approvalStatus: requiresApproval
          ? ApprovalStatus.approved
          : ApprovalStatus.not_required,
        scheduledAt: new Date(Date.now() - 5 * 60 * 1000),
        targets: { create: { targetId: target.id } },
      },
    });

    return { workspace, owner, contributor, post, target, requiresApproval };
  }

  function asContributor(seed: Awaited<ReturnType<typeof seedApproved>>) {
    return {
      workspaceId: seed.workspace.id,
      userId: seed.contributor.id,
      role: WorkspaceRole.contributor,
      requiresApproval: seed.requiresApproval,
    };
  }

  it('sends a reworded post back to the queue', async () => {
    const seed = await seedApproved();

    await posts.updatePost(asContributor(seed), seed.post.id, {
      message: 'Something the reviewer never saw',
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: seed.post.id } });
    expect(after.approvalStatus).toBe(ApprovalStatus.pending);
    expect(after.status).toBe(PostStatus.pending_approval);
    // The previous decision is cleared, so the queue shows a clean submission.
    expect(after.reviewedById).toBeNull();
    expect(after.reviewedAt).toBeNull();

    // And it is due, so only the approval state is holding it back.
    const result = await runner.runSchedulerTick();
    expect(result.claimed).toBe(0);
    expect(published).toHaveLength(0);
  });

  it('sends it back when the destinations change', async () => {
    const seed = await seedApproved();
    const other = await prisma.target.create({
      data: {
        workspaceId: seed.workspace.id,
        type: 'page',
        providerId: '2000',
        name: 'Another Page',
      },
    });

    await posts.updatePost(asContributor(seed), seed.post.id, { targetIds: [other.id] });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: seed.post.id } });
    expect(after.approvalStatus).toBe(ApprovalStatus.pending);
  });

  it('leaves it approved when the save changes nothing', async () => {
    const seed = await seedApproved();

    // The composer PATCHes the whole form, so opening and saving a post must
    // not cost it its approval.
    await posts.updatePost(asContributor(seed), seed.post.id, {
      message: 'The approved wording',
      targetIds: [seed.target.id],
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: seed.post.id } });
    expect(after.approvalStatus).toBe(ApprovalStatus.approved);
    expect(after.status).toBe(PostStatus.scheduled);
  });

  it('does not queue an editor, who never needed approval', async () => {
    const seed = await seedApproved();
    const editor = await makeUser('Editor');
    await prisma.membership.create({
      data: { userId: editor.id, workspaceId: seed.workspace.id, role: WorkspaceRole.editor },
    });

    await posts.updatePost(
      {
        workspaceId: seed.workspace.id,
        userId: editor.id,
        role: WorkspaceRole.editor,
        requiresApproval: true,
      },
      seed.post.id,
      { message: 'Rewritten by someone who can publish directly' },
    );

    const after = await prisma.post.findUniqueOrThrow({ where: { id: seed.post.id } });
    expect(after.approvalStatus).toBe(ApprovalStatus.approved);
  });

  it('does not queue anyone when the workspace does not require review', async () => {
    const seed = await seedApproved({ requiresApproval: false });

    await posts.updatePost(asContributor(seed), seed.post.id, { message: 'Edited freely' });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: seed.post.id } });
    expect(after.approvalStatus).toBe(ApprovalStatus.not_required);
    expect(after.status).toBe(PostStatus.scheduled);
  });
});

describe('retrying a post that is back in the queue', () => {
  it('does not label a held post as scheduled', async () => {
    const owner = await makeUser('Owner');
    const contributor = await makeUser('Contributor');
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval: true,
    });

    // An approved post that lost a destination, then went back for review when
    // its author reworded it.
    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: contributor.id,
        submittedById: contributor.id,
        message: 'Reworded after one Page failed',
        status: PostStatus.pending_approval,
        approvalStatus: ApprovalStatus.pending,
        scheduledAt: new Date(Date.now() - 5 * 60 * 1000),
        targets: {
          create: { targetId: target.id, status: 'failed', errorMessage: 'Token expired' },
        },
      },
    });

    const retried = await posts.retryPost(
      { workspaceId: workspace.id, userId: contributor.id, role: WorkspaceRole.contributor },
      post.id,
    );
    expect(retried).toBe(1);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.pending_approval);

    // And the promise the old status made is one the scheduler would not keep.
    const result = await runner.runSchedulerTick();
    expect(result.claimed).toBe(0);
  });

  it('still schedules one that is cleared to publish', async () => {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({ name: 'Client', ownerId: owner.id });

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        message: 'Try again',
        status: PostStatus.failed,
        approvalStatus: ApprovalStatus.not_required,
        scheduledAt: new Date(Date.now() - 5 * 60 * 1000),
        targets: { create: { targetId: target.id, status: 'failed', errorMessage: 'Timed out' } },
      },
    });

    await posts.retryPost(
      { workspaceId: workspace.id, userId: owner.id, role: WorkspaceRole.owner },
      post.id,
    );

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.scheduled);

    const result = await runner.runSchedulerTick();
    expect(result.published).toBe(1);
  });
});

describe('cancelling something that is waiting for review', () => {
  async function seedPendingThenCancel() {
    const owner = await makeUser('Owner');
    const contributor = await makeUser('Contributor');
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval: true,
    });
    await prisma.membership.create({
      data: { userId: contributor.id, workspaceId: workspace.id, role: WorkspaceRole.contributor },
    });

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: contributor.id,
        submittedById: contributor.id,
        submittedAt: new Date(),
        message: 'Never mind',
        status: PostStatus.pending_approval,
        approvalStatus: ApprovalStatus.pending,
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
        targets: { create: { targetId: target.id } },
      },
    });

    await posts.cancelPost(
      { workspaceId: workspace.id, userId: contributor.id, role: WorkspaceRole.contributor },
      post.id,
    );
    return { workspace, owner, post };
  }

  it('takes it out of the reviewer queue', async () => {
    const { workspace } = await seedPendingThenCancel();

    // The approval state is kept as a record of what was asked for; the queue
    // is what must not show work nobody can act on.
    expect(await approvals.pendingApprovalCount(workspace.id)).toBe(0);
  });

  it('refuses to approve it back into existence', async () => {
    const { workspace, owner, post } = await seedPendingThenCancel();

    await expect(
      approvals.approvePost({
        workspaceId: workspace.id,
        postId: post.id,
        reviewerId: owner.id,
        reviewerRole: WorkspaceRole.owner,
      }),
    ).rejects.toThrow(/not awaiting approval/i);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.cancelled);
  });

  it('refuses to reject it either', async () => {
    const { workspace, owner, post } = await seedPendingThenCancel();

    await expect(
      approvals.rejectPost({
        workspaceId: workspace.id,
        postId: post.id,
        reviewerId: owner.id,
        reviewerRole: WorkspaceRole.owner,
        note: 'Too late.',
      }),
    ).rejects.toThrow(/not awaiting approval/i);
  });

  it('does not revive it when review is switched off', async () => {
    const { workspace, owner, post } = await seedPendingThenCancel();

    await approvals.releaseHeldPosts({ workspaceId: workspace.id, userId: owner.id });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.cancelled);
  });

  it('still counts one that is genuinely waiting', async () => {
    const { workspace } = await seedPendingThenCancel();
    const other = await makeUser('Someone');
    await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: other.id,
        submittedById: other.id,
        message: 'Please review',
        status: PostStatus.pending_approval,
        approvalStatus: ApprovalStatus.pending,
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    expect(await approvals.pendingApprovalCount(workspace.id)).toBe(1);
  });
});

/**
 * Contributors are held to their own work. Someone whose own words cannot go
 * out unread has no business cancelling a colleague's scheduled campaign.
 */
describe('acting on someone else\'s post', () => {
  async function seedOthersPost() {
    const owner = await makeUser('Owner');
    const contributor = await makeUser('Contributor');
    const { workspace, target } = await makeWorkspace({ name: 'Client', ownerId: owner.id });
    await prisma.membership.create({
      data: { userId: contributor.id, workspaceId: workspace.id, role: WorkspaceRole.contributor },
    });

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        message: "The owner's campaign",
        status: PostStatus.scheduled,
        approvalStatus: ApprovalStatus.not_required,
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
        targets: { create: { targetId: target.id, status: 'failed', errorMessage: 'Timed out' } },
      },
    });

    return { workspace, owner, contributor, post };
  }

  const asContributor = (seed: Awaited<ReturnType<typeof seedOthersPost>>) => ({
    workspaceId: seed.workspace.id,
    userId: seed.contributor.id,
    role: WorkspaceRole.contributor,
  });

  it('will not let a contributor cancel it', async () => {
    const seed = await seedOthersPost();

    await expect(posts.cancelPost(asContributor(seed), seed.post.id)).rejects.toThrow(/permission/i);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: seed.post.id } });
    expect(after.status).toBe(PostStatus.scheduled);
  });

  it('will not let a contributor rewrite it', async () => {
    const seed = await seedOthersPost();

    await expect(
      posts.updatePost(
        { ...asContributor(seed), requiresApproval: false },
        seed.post.id,
        { message: 'Something else entirely' },
      ),
    ).rejects.toThrow(/permission/i);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: seed.post.id } });
    expect(after.message).toBe("The owner's campaign");
  });

  it('will not let a contributor retry it', async () => {
    const seed = await seedOthersPost();

    await expect(posts.retryPost(asContributor(seed), seed.post.id)).rejects.toThrow(/permission/i);
  });

  it('lets an editor act on it, which is what the role is for', async () => {
    const seed = await seedOthersPost();
    const editor = await makeUser('Editor');
    await prisma.membership.create({
      data: { userId: editor.id, workspaceId: seed.workspace.id, role: WorkspaceRole.editor },
    });

    const retried = await posts.retryPost(
      { workspaceId: seed.workspace.id, userId: editor.id, role: WorkspaceRole.editor },
      seed.post.id,
    );
    expect(retried).toBe(1);
  });

  it('leaves a contributor free to manage their own', async () => {
    const seed = await seedOthersPost();
    const own = await prisma.post.create({
      data: {
        workspaceId: seed.workspace.id,
        authorId: seed.contributor.id,
        message: 'Mine',
        status: PostStatus.draft,
        approvalStatus: ApprovalStatus.not_required,
      },
    });

    await posts.updatePost(
      { ...asContributor(seed), requiresApproval: false },
      own.id,
      { message: 'Mine, edited' },
    );

    const after = await prisma.post.findUniqueOrThrow({ where: { id: own.id } });
    expect(after.message).toBe('Mine, edited');
  });
});

/**
 * The queue exists to space publications out. A slot that is still intended to
 * be used has to count as occupied, whatever the post is waiting on.
 */
describe('queue slots and posts awaiting review', () => {
  async function seedQueued() {
    const owner = await makeUser('Owner');
    const contributor = await makeUser('Contributor');
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval: true,
    });
    await prisma.membership.create({
      data: { userId: contributor.id, workspaceId: workspace.id, role: WorkspaceRole.contributor },
    });
    await prisma.queueSlot.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        workspaceId: workspace.id,
        dayOfWeek,
        hour: 9,
        minute: 0,
      })),
    });

    return { workspace, owner, contributor, target };
  }

  function queued(seed: Awaited<ReturnType<typeof seedQueued>>, userId: string, role: WorkspaceRole) {
    return posts.createPost(
      {
        workspaceId: seed.workspace.id,
        userId,
        role,
        requiresApproval: true,
      },
      {
        message: `Queued by ${role}`,
        media: [],
        targetIds: [seed.target.id],
        publishMode: 'worker',
        timezone: 'UTC',
        useQueue: true,
        saveAsDraft: false,
      },
    );
  }

  it('does not hand the same slot to two people', async () => {
    const seed = await seedQueued();

    // The contributor's post is held for review, but it still intends to go out
    // at that time, so the slot is spoken for.
    const held = await queued(seed, seed.contributor.id, WorkspaceRole.contributor);
    const next = await queued(seed, seed.owner.id, WorkspaceRole.owner);

    const first = await prisma.post.findUniqueOrThrow({ where: { id: held.postId } });
    const second = await prisma.post.findUniqueOrThrow({ where: { id: next.postId } });

    expect(first.status).toBe(PostStatus.pending_approval);
    expect(first.scheduledAt).not.toBeNull();
    expect(second.scheduledAt?.getTime()).not.toBe(first.scheduledAt?.getTime());
  });

  it('does not hand the same slot to two requests arriving together', async () => {
    const seed = await seedQueued();

    // The real window is wider than this: composing a post with a link puts an
    // Open Graph scrape between reading the free slots and writing the row.
    const [first, second] = await Promise.all([
      queued(seed, seed.owner.id, WorkspaceRole.owner),
      queued(seed, seed.contributor.id, WorkspaceRole.contributor),
    ]);

    const one = await prisma.post.findUniqueOrThrow({ where: { id: first.postId } });
    const two = await prisma.post.findUniqueOrThrow({ where: { id: second.postId } });

    expect(one.scheduledAt).not.toBeNull();
    expect(two.scheduledAt).not.toBeNull();
    expect(one.scheduledAt?.getTime()).not.toBe(two.scheduledAt?.getTime());
  });

  it('frees the slot again when the post is rejected', async () => {
    const seed = await seedQueued();
    const held = await queued(seed, seed.contributor.id, WorkspaceRole.contributor);
    const taken = await prisma.post.findUniqueOrThrow({ where: { id: held.postId } });

    await approvals.rejectPost({
      workspaceId: seed.workspace.id,
      postId: held.postId,
      reviewerId: seed.owner.id,
      reviewerRole: WorkspaceRole.owner,
      note: 'No thanks.',
    });

    // It is not going out, so holding the slot would waste it.
    const next = await queued(seed, seed.owner.id, WorkspaceRole.owner);
    const reused = await prisma.post.findUniqueOrThrow({ where: { id: next.postId } });
    expect(reused.scheduledAt?.getTime()).toBe(taken.scheduledAt?.getTime());
  });
});

describe('who needs approval', () => {
  it('holds a contributor post when the workspace requires approval', async () => {
    const owner = await makeUser('Owner');
    const contributor = await makeUser('Contributor');
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval: true,
    });
    await prisma.membership.create({
      data: { userId: contributor.id, workspaceId: workspace.id, role: WorkspaceRole.contributor },
    });

    const created = await posts.createPost(
      {
        workspaceId: workspace.id,
        userId: contributor.id,
        role: WorkspaceRole.contributor,
        requiresApproval: true,
      },
      {
        message: 'From a contributor',
        media: [],
        targetIds: [target.id],
        publishMode: 'worker',
        scheduledAtLocal: futureLocalInput(),
        timezone: 'UTC',
        useQueue: false,
        saveAsDraft: false,
      },
    );

    const post = await prisma.post.findUniqueOrThrow({ where: { id: created.postId } });
    expect(post.approvalStatus).toBe(ApprovalStatus.pending);
    expect(post.status).toBe(PostStatus.pending_approval);
  });

  it('lets an editor schedule directly in the same workspace', async () => {
    const owner = await makeUser('Owner');
    const editor = await makeUser('Editor');
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval: true,
    });
    await prisma.membership.create({
      data: { userId: editor.id, workspaceId: workspace.id, role: WorkspaceRole.editor },
    });

    const created = await posts.createPost(
      {
        workspaceId: workspace.id,
        userId: editor.id,
        role: WorkspaceRole.editor,
        requiresApproval: true,
      },
      {
        message: 'From an editor',
        media: [],
        targetIds: [target.id],
        publishMode: 'worker',
        scheduledAtLocal: futureLocalInput(),
        timezone: 'UTC',
        useQueue: false,
        saveAsDraft: false,
      },
    );

    const post = await prisma.post.findUniqueOrThrow({ where: { id: created.postId } });
    expect(post.approvalStatus).toBe(ApprovalStatus.approved);
    expect(post.status).toBe(PostStatus.scheduled);
  });

  it('does not involve approval at all when the workspace has it off', async () => {
    const owner = await makeUser('Owner');
    const contributor = await makeUser('Contributor');
    const { workspace, target } = await makeWorkspace({ name: 'Client', ownerId: owner.id });
    await prisma.membership.create({
      data: { userId: contributor.id, workspaceId: workspace.id, role: WorkspaceRole.contributor },
    });

    const created = await posts.createPost(
      {
        workspaceId: workspace.id,
        userId: contributor.id,
        role: WorkspaceRole.contributor,
        requiresApproval: false,
      },
      {
        message: 'No review needed',
        media: [],
        targetIds: [target.id],
        publishMode: 'worker',
        scheduledAtLocal: futureLocalInput(),
        timezone: 'UTC',
        useQueue: false,
        saveAsDraft: false,
      },
    );

    const post = await prisma.post.findUniqueOrThrow({ where: { id: created.postId } });
    expect(post.approvalStatus).toBe(ApprovalStatus.not_required);
    expect(post.status).toBe(PostStatus.scheduled);
  });

  it('refuses to publish immediately when approval is pending', async () => {
    const owner = await makeUser('Owner');
    const contributor = await makeUser('Contributor');
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval: true,
    });
    await prisma.membership.create({
      data: { userId: contributor.id, workspaceId: workspace.id, role: WorkspaceRole.contributor },
    });

    // "Publish now" must not be a way around review.
    await posts.createPost(
      {
        workspaceId: workspace.id,
        userId: contributor.id,
        role: WorkspaceRole.contributor,
        requiresApproval: true,
      },
      {
        message: 'Trying to skip review',
        media: [],
        targetIds: [target.id],
        publishMode: 'immediate',
        scheduledAtLocal: null,
        timezone: 'UTC',
        useQueue: false,
        saveAsDraft: false,
      },
    );

    expect(published).toHaveLength(0);
  });
});

describe('cross-tenant isolation', () => {
  it('refuses to post to another workspace destination', async () => {
    const alice = await makeUser('Alice');
    const bob = await makeUser('Bob');
    const clientA = await makeWorkspace({ name: 'ClientA', ownerId: alice.id });
    const clientB = await makeWorkspace({ name: 'ClientB', ownerId: bob.id });

    // Alice tries to publish to Bob's Page by naming its id directly.
    await expect(
      posts.createPost(
        {
          workspaceId: clientA.workspace.id,
          userId: alice.id,
          role: WorkspaceRole.owner,
          requiresApproval: false,
        },
        {
          message: 'Should never appear on ClientB',
          media: [],
          targetIds: [clientB.target.id],
          publishMode: 'worker',
          scheduledAtLocal: futureLocalInput(),
          timezone: 'UTC',
          useQueue: false,
          saveAsDraft: false,
        },
      ),
    ).rejects.toThrow(/no longer available/i);

    expect(await prisma.post.count()).toBe(0);
  });

  it('cannot approve a post belonging to another workspace', async () => {
    const alice = await makeUser('Alice');
    const bob = await makeUser('Bob');
    const clientA = await makeWorkspace({ name: 'ClientA', ownerId: alice.id, requiresApproval: true });
    const clientB = await makeWorkspace({ name: 'ClientB', ownerId: bob.id, requiresApproval: true });

    const bobsPost = await prisma.post.create({
      data: {
        workspaceId: clientB.workspace.id,
        authorId: bob.id,
        submittedById: bob.id,
        message: "Bob's post",
        status: PostStatus.pending_approval,
        approvalStatus: ApprovalStatus.pending,
        targets: { create: { targetId: clientB.target.id } },
      },
    });

    // Alice is an owner — but of a different workspace.
    await expect(
      approvals.approvePost({
        workspaceId: clientA.workspace.id,
        postId: bobsPost.id,
        reviewerId: alice.id,
        reviewerRole: WorkspaceRole.owner,
      }),
    ).rejects.toThrow(/not found/i);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: bobsPost.id } });
    expect(after.approvalStatus).toBe(ApprovalStatus.pending);
  });

  it('scopes the pending count to one workspace', async () => {
    const alice = await makeUser('Alice');
    const bob = await makeUser('Bob');
    const clientA = await makeWorkspace({ name: 'ClientA', ownerId: alice.id, requiresApproval: true });
    const clientB = await makeWorkspace({ name: 'ClientB', ownerId: bob.id, requiresApproval: true });

    for (const [workspace, author, count] of [
      [clientA.workspace, alice, 1],
      [clientB.workspace, bob, 3],
    ] as const) {
      for (let index = 0; index < count; index += 1) {
        await prisma.post.create({
          data: {
            workspaceId: workspace.id,
            authorId: author.id,
            message: `post ${index}`,
            status: PostStatus.pending_approval,
            approvalStatus: ApprovalStatus.pending,
          },
        });
      }
    }

    expect(await approvals.pendingApprovalCount(clientA.workspace.id)).toBe(1);
    expect(await approvals.pendingApprovalCount(clientB.workspace.id)).toBe(3);
  });
});

describe('invitations', () => {
  it('accepts an invitation and grants the stated role', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });
    const invitee = await makeUser('Invitee');

    const invitation = await team.inviteMember({
      workspaceId: workspace.id,
      invitedById: owner.id,
      email: invitee.email,
      role: WorkspaceRole.editor,
    });

    const token = invitation.acceptUrl.split('/').pop()!;
    await team.acceptInvitation(token, invitee.id);

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: invitee.id, workspaceId: workspace.id } },
    });
    expect(membership.role).toBe(WorkspaceRole.editor);
  });

  it('refuses an invitation offered to a different address', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });
    const intended = await makeUser('Intended');
    const someoneElse = await makeUser('Interloper');

    const invitation = await team.inviteMember({
      workspaceId: workspace.id,
      invitedById: owner.id,
      email: intended.email,
      role: WorkspaceRole.admin,
    });
    const token = invitation.acceptUrl.split('/').pop()!;

    // A forwarded link must not admit whoever happens to open it.
    await expect(team.acceptInvitation(token, someoneElse.id)).rejects.toThrow(/sent to/i);

    expect(
      await prisma.membership.findUnique({
        where: { userId_workspaceId: { userId: someoneElse.id, workspaceId: workspace.id } },
      }),
    ).toBeNull();
  });

  it('cannot be accepted twice', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });
    const invitee = await makeUser('Invitee');

    const invitation = await team.inviteMember({
      workspaceId: workspace.id,
      invitedById: owner.id,
      email: invitee.email,
      role: WorkspaceRole.contributor,
    });
    const token = invitation.acceptUrl.split('/').pop()!;

    await team.acceptInvitation(token, invitee.id);
    await expect(team.acceptInvitation(token, invitee.id)).rejects.toThrow(/not valid/i);
  });

  it('rejects an expired invitation', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });
    const invitee = await makeUser('Invitee');

    const invitation = await team.inviteMember({
      workspaceId: workspace.id,
      invitedById: owner.id,
      email: invitee.email,
      role: WorkspaceRole.contributor,
    });
    const token = invitation.acceptUrl.split('/').pop()!;

    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(team.acceptInvitation(token, invitee.id)).rejects.toThrow(/expired/i);
  });

  it('re-inviting replaces the pending invitation rather than duplicating it', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });

    const first = await team.inviteMember({
      workspaceId: workspace.id,
      invitedById: owner.id,
      email: 'new@example.com',
      role: WorkspaceRole.contributor,
    });
    const second = await team.inviteMember({
      workspaceId: workspace.id,
      invitedById: owner.id,
      email: 'new@example.com',
      role: WorkspaceRole.editor,
    });

    expect(await prisma.invitation.count({ where: { workspaceId: workspace.id } })).toBe(1);
    // The newest link wins; the old token is dead.
    expect(second.acceptUrl).not.toBe(first.acceptUrl);

    const staleToken = first.acceptUrl.split('/').pop()!;
    expect(await team.findInvitation(staleToken)).toBeNull();
  });

  it('will not remove the last owner', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });

    // Otherwise the workspace becomes unadministrable.
    await expect(team.removeMember(workspace.id, owner.id)).rejects.toThrow(/at least one owner/i);
  });

  it('will not demote the last owner', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });

    await expect(
      team.changeRole(workspace.id, owner.id, WorkspaceRole.admin),
    ).rejects.toThrow(/at least one owner/i);
  });
});

/**
 * The morning the clocks go forward.
 *
 * A scheduler is the product where this matters, and it is the case nobody
 * writes by hand because it happens on one morning a year. Left alone, the
 * conversion returns an instant an hour before the one that was asked for and
 * says nothing: the post goes out early, and the calendar afterwards agrees
 * with itself, showing the time it moved to rather than the time that was set.
 */
describe('scheduling into an hour that does not exist', () => {
  /**
   * The next wall-clock time in this zone that no clock will ever read.
   *
   * Found rather than written down, for the reason `futureLocalInput` gives:
   * a literal date is a test that passes until one morning it does not. This
   * one would also have to be rewritten every year.
   */
  async function nextMissingHour(timeZone: string): Promise<string> {
    const { wallClockExists } = await import('../src/lib/time');
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);

    for (let day = 0; day < 400; day += 1) {
      const date = new Date(start.getTime() + day * 24 * 60 * 60 * 1000);
      const stamp = date.toISOString().slice(0, 10);

      for (const time of ['00:30', '01:00', '01:30', '02:00', '02:30', '03:00']) {
        const local = `${stamp}T${time}`;
        if (!wallClockExists(local, timeZone)) return local;
      }
    }

    throw new Error(`no clock change found in ${timeZone} within a year`);
  }

  it('is refused rather than quietly moved', async () => {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({ name: 'Clocks', ownerId: owner.id });
    const missing = await nextMissingHour('Europe/London');

    await expect(
      posts.createPost(
        {
          workspaceId: workspace.id,
          userId: owner.id,
          role: WorkspaceRole.owner,
          requiresApproval: false,
        },
        {
          message: 'On the morning that hour does not exist',
          targetIds: [target.id],
          publishMode: 'worker',
          scheduledAtLocal: missing,
          timezone: 'Europe/London',
          media: [],
          link: null,
          useQueue: false,
          saveAsDraft: false,
        } as never,
      ),
    ).rejects.toThrow(/does not happen/i);
  });

  it('accepts the same wall clock in a zone whose clocks move on another date', async () => {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({ name: 'Elsewhere', ownerId: owner.id });
    const missing = await nextMissingHour('Europe/London');

    // The rule belongs to the zone, not to the calendar: the same wall clock
    // is perfectly ordinary somewhere whose clocks moved on a different date.
    const created = await posts.createPost(
      {
        workspaceId: workspace.id,
        userId: owner.id,
        role: WorkspaceRole.owner,
        requiresApproval: false,
      },
      {
        message: 'Ordinary elsewhere',
        targetIds: [target.id],
        publishMode: 'worker',
        scheduledAtLocal: missing,
        timezone: 'Asia/Dubai',
        media: [],
        link: null,
        useQueue: false,
        saveAsDraft: false,
      } as never,
    );

    expect(created.postId).toBeTruthy();
  });
})
