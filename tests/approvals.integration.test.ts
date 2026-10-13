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
/**
 * Runs before the fake Graph server answers, so a test can make something
 * happen while the code under test is waiting on a network call.
 */
let duringGraphRequest: (() => Promise<void>) | null = null;
/** Lets a test make the fake Graph server refuse the next call. */
let graphStatus = 200;
let graphBody: unknown = { id: '1000_5000' };

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
      const hook = duringGraphRequest;
      duringGraphRequest = null;
      void Promise.resolve(hook?.()).then(() => {
        response.writeHead(graphStatus, { 'content-type': 'application/json' });
        response.end(JSON.stringify(graphBody));
      });
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
  duringGraphRequest = null;
  graphStatus = 200;
  graphBody = { id: '1000_5000' };
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

/** The client step: the team clears a post first, then the client's answer clears it. */
describe('the client step after the team', () => {
  async function seedHeldPost(state: ApprovalStatus) {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({ name: 'Client', ownerId: owner.id, requiresApproval: true });
    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        submittedById: owner.id,
        message: 'Held for review',
        status: PostStatus.pending_approval,
        approvalStatus: state,
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
        targets: { create: { targetId: target.id } },
      },
    });
    return { post, workspace, owner };
  }

  it('records the team approval and keeps the post in review until the client approves', async () => {
    const { post, workspace, owner } = await seedHeldPost(ApprovalStatus.pending);
    await prisma.workspace.update({ where: { id: workspace.id }, data: { clientApprovalAfterTeam: true } });

    const team = await approvals.approvePost({ workspaceId: workspace.id, postId: post.id, reviewerId: owner.id, reviewerRole: WorkspaceRole.owner });
    expect(team.awaitingClient).toBe(true);
    const waiting = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect([waiting.approvalStatus, waiting.status, waiting.teamApprovedById]).toEqual([ApprovalStatus.pending, PostStatus.pending_approval, owner.id]);
    expect(waiting.teamApprovedAt).not.toBeNull();

    // The client's review link finishes it.
    await approvals.approvePost({
      workspaceId: workspace.id,
      postId: post.id,
      reviewerId: owner.id,
      reviewerRole: WorkspaceRole.owner,
      viaLink: { title: 'Client link', authorName: 'The client' },
    });
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).approvalStatus).toBe(ApprovalStatus.approved);
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
    expect(released.released).toBe(1);

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

    expect(
      (await approvals.releaseHeldPosts({ workspaceId: workspace.id, userId: owner.id })).released,
    ).toBe(0);

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
    expect(await approvals.pendingApprovalCount(workspace.id, { all: true })).toBe(0);
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

    expect(await approvals.pendingApprovalCount(workspace.id, { all: true })).toBe(1);
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

  it('tells the caller which slot it picked', async () => {
    const seed = await seedQueued();
    const created = await queued(seed, seed.owner.id, WorkspaceRole.owner);

    // The queue chooses the time on the server, so this value is the only way
    // the author learns when their post goes out — the composer has nothing
    // else to show them, and "Scheduled" on its own leaves them to go looking.
    expect(created.scheduledAt).not.toBeNull();

    const stored = await prisma.post.findUniqueOrThrow({ where: { id: created.postId } });
    expect(created.scheduledAt?.getTime()).toBe(stored.scheduledAt?.getTime());

    // And it is a slot the workspace actually configured, not just any future
    // moment: minutes and hour have to match one of them.
    const slots = await prisma.queueSlot.findMany({ where: { workspaceId: seed.workspace.id } });
    const picked = created.scheduledAt!;
    expect(
      slots.some(
        (slot) =>
          slot.dayOfWeek === picked.getUTCDay() &&
          slot.hour === picked.getUTCHours() &&
          slot.minute === picked.getUTCMinutes(),
      ),
      `${picked.toISOString()} is not one of the configured slots`,
    ).toBe(true);
  });

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

    expect(await approvals.pendingApprovalCount(clientA.workspace.id, { all: true })).toBe(1);
    expect(await approvals.pendingApprovalCount(clientB.workspace.id, { all: true })).toBe(3);
    // A member limited to other Pages does not count them.
    expect(await approvals.pendingApprovalCount(clientB.workspace.id, { all: false, ids: ['elsewhere'] })).toBe(0);
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
      actorRole: WorkspaceRole.owner,
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
      actorRole: WorkspaceRole.owner,
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
      actorRole: WorkspaceRole.owner,
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
      actorRole: WorkspaceRole.owner,
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
      actorRole: WorkspaceRole.owner,
      email: 'new@example.com',
      role: WorkspaceRole.contributor,
    });
    const second = await team.inviteMember({
      workspaceId: workspace.id,
      invitedById: owner.id,
      actorRole: WorkspaceRole.owner,
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
    await expect(team.removeMember(workspace.id, owner.id, WorkspaceRole.owner)).rejects.toThrow(
      /at least one owner/i,
    );
  });

  it('will not demote the last owner', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });

    await expect(
      team.changeRole(workspace.id, owner.id, WorkspaceRole.admin, WorkspaceRole.owner),
    ).rejects.toThrow(/at least one owner/i);
  });

  /**
   * The escalation this whole file exists to prevent, in its shortest form.
   *
   * Owner is not simply a bigger admin. `canManageInstance` is owner-only and
   * is not scoped to a workspace: it gates the Graph credentials, the API
   * version and the feature switches for every client on the installation. An
   * agency admin who can hand themselves that role has taken over the box, not
   * their own workspace.
   */
  it('does not let an admin make themselves an owner', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });
    const admin = await makeUser('Admin');
    await prisma.membership.create({
      data: { userId: admin.id, workspaceId: workspace.id, role: WorkspaceRole.admin },
    });

    await expect(
      team.changeRole(workspace.id, admin.id, WorkspaceRole.owner, WorkspaceRole.admin),
    ).rejects.toThrow(/permission/i);

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: admin.id, workspaceId: workspace.id } },
    });
    expect(membership.role).toBe(WorkspaceRole.admin);
  });

  it('does not let an admin promote somebody else to owner', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });
    const editor = await makeUser('Editor');
    await prisma.membership.create({
      data: { userId: editor.id, workspaceId: workspace.id, role: WorkspaceRole.editor },
    });

    // The long way round to the same place: promote a friend, be promoted back.
    await expect(
      team.changeRole(workspace.id, editor.id, WorkspaceRole.owner, WorkspaceRole.admin),
    ).rejects.toThrow(/permission/i);
  });

  /**
   * Escalation by subtraction. A second owner exists, so the last-owner guard
   * does not fire, and an admin could otherwise demote or delete the person
   * standing above them.
   */
  it('does not let an admin demote an owner', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });
    const second = await makeUser('Second owner');
    const admin = await makeUser('Admin');
    await prisma.membership.createMany({
      data: [
        { userId: second.id, workspaceId: workspace.id, role: WorkspaceRole.owner },
        { userId: admin.id, workspaceId: workspace.id, role: WorkspaceRole.admin },
      ],
    });

    await expect(
      team.changeRole(workspace.id, owner.id, WorkspaceRole.editor, WorkspaceRole.admin),
    ).rejects.toThrow(/permission/i);

    await expect(
      team.removeMember(workspace.id, owner.id, WorkspaceRole.admin),
    ).rejects.toThrow(/permission/i);

    expect(
      await prisma.membership.count({ where: { workspaceId: workspace.id, role: WorkspaceRole.owner } }),
    ).toBe(2);
  });

  it('keeps a client a client, and never makes a team member one', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });
    const customer = await makeUser('Customer');
    const editor = await makeUser('Editor');
    await prisma.membership.createMany({
      data: [
        { userId: customer.id, workspaceId: workspace.id, role: WorkspaceRole.client },
        { userId: editor.id, workspaceId: workspace.id, role: WorkspaceRole.editor },
      ],
    });

    await expect(team.changeRole(workspace.id, customer.id, WorkspaceRole.editor, WorkspaceRole.owner)).rejects.toMatchObject({ key: 'errors.clientRoleFixed' });
    await expect(team.changeRole(workspace.id, editor.id, WorkspaceRole.client, WorkspaceRole.owner)).rejects.toMatchObject({ key: 'errors.clientRoleFixed' });
    expect((await prisma.membership.findMany({ where: { workspaceId: workspace.id } })).map((row) => row.role).sort()).toEqual(['client', 'editor', 'owner']);
  });

  it('lets an owner hand ownership over and step down', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });
    const successor = await makeUser('Successor');
    await prisma.membership.create({
      data: { userId: successor.id, workspaceId: workspace.id, role: WorkspaceRole.admin },
    });

    await team.changeRole(workspace.id, successor.id, WorkspaceRole.owner, WorkspaceRole.owner);
    await team.changeRole(workspace.id, owner.id, WorkspaceRole.admin, WorkspaceRole.owner);

    const memberships = await prisma.membership.findMany({ where: { workspaceId: workspace.id } });
    expect(memberships.find((row) => row.userId === successor.id)?.role).toBe(WorkspaceRole.owner);
    expect(memberships.find((row) => row.userId === owner.id)?.role).toBe(WorkspaceRole.admin);
  });

  it('lets an admin manage the roles below their own', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });
    const contributor = await makeUser('Contributor');
    await prisma.membership.create({
      data: { userId: contributor.id, workspaceId: workspace.id, role: WorkspaceRole.contributor },
    });

    await team.changeRole(workspace.id, contributor.id, WorkspaceRole.editor, WorkspaceRole.admin);

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId: contributor.id, workspaceId: workspace.id } },
    });
    expect(membership.role).toBe(WorkspaceRole.editor);
  });

  it('does not let an admin invite a new owner', async () => {
    const owner = await makeUser('Owner');
    const { workspace } = await makeWorkspace({ name: 'Client', ownerId: owner.id });

    // The same escalation with an extra step: invite an address you control as
    // an owner, accept it, and the workspace has a second owner who is you.
    await expect(
      team.inviteMember({
        workspaceId: workspace.id,
        invitedById: owner.id,
        actorRole: WorkspaceRole.admin,
        email: 'friend@example.com',
        role: WorkspaceRole.owner,
      }),
    ).rejects.toThrow(/permission/i);

    expect(await prisma.invitation.count({ where: { workspaceId: workspace.id } })).toBe(0);
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

/**
 * Opening a post written before the workspace moved, and saving it unchanged.
 *
 * An agency onboards a client in another country, or corrects a timezone that
 * was wrong from the start. Posts scheduled before that carry the old zone on
 * their own row; every screen shows workspace time; and the composer sends
 * back whichever zone it was handed. If the field is rendered in one zone and
 * saved in another, pressing Save without touching anything moves the post by
 * the difference — and, in a workspace with review on, sends it back to the
 * reviewer for a change nobody made.
 */
describe('editing a post from before the workspace changed timezone', () => {
  it('leaves the instant alone when nothing was edited', async () => {
    const { utcToLocalInput } = await import('../src/lib/time');

    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({ name: 'Moved', ownerId: owner.id });

    const scheduledAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        message: 'Written when the workspace was in London',
        status: 'scheduled',
        scheduledAt,
        // The zone it was created in, kept on the row.
        timezone: 'Europe/London',
        targets: { create: { targetId: target.id, status: 'pending' } },
      },
    });

    // The workspace has since moved.
    const workspaceZone = 'Asia/Tokyo';
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { timezone: workspaceZone },
    });

    // What the edit screen puts in the field, and what the composer sends back
    // with it. These have to be the same zone or the post moves.
    const shown = utcToLocalInput(scheduledAt, workspaceZone);

    await posts.updatePost(
      {
        workspaceId: workspace.id,
        userId: owner.id,
        role: WorkspaceRole.owner,
        requiresApproval: false,
      },
      post.id,
      { scheduledAtLocal: shown, timezone: workspaceZone },
    );

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });

    // To the minute: `datetime-local` has no seconds, so the stored instant is
    // compared at the resolution the field actually carries.
    expect(Math.floor(after.scheduledAt!.getTime() / 60_000)).toBe(
      Math.floor(scheduledAt.getTime() / 60_000),
    );
  });

  it('would have moved it, had the field been rendered in the post’s old zone', async () => {
    const { utcToLocalInput, localInputToUtc } = await import('../src/lib/time');

    // The bug, stated as arithmetic rather than left implicit: London and
    // Tokyo are hours apart, so the same wall clock is a different instant.
    const instant = new Date('2027-01-15T09:00:00Z');
    const shownInOldZone = utcToLocalInput(instant, 'Europe/London');
    const savedInWorkspaceZone = localInputToUtc(shownInOldZone, 'Asia/Tokyo');

    expect(savedInWorkspaceZone.getTime()).not.toBe(instant.getTime());
  });
})

/**
 * Editing a post while a worker is publishing it.
 *
 * The dangerous window is narrow and invisible from the post row: a worker
 * claims one destination, which becomes `processing`, and the post itself
 * stays `scheduled` until an outcome comes back. Replacing the destinations
 * in that window used to delete every row including the claimed one — so the
 * post went out on Facebook with nothing left to record it, and the recreated
 * row published it a second time.
 */
describe('editing a post whose destination a worker has claimed', () => {
  async function seedClaimed() {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({ name: 'Racing', ownerId: owner.id });

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        message: 'Going out now',
        status: 'scheduled',
        scheduledAt: new Date(Date.now() - 60_000),
        targets: { create: { targetId: target.id, status: 'processing', lockedAt: new Date() } },
      },
      include: { targets: true },
    });

    return { owner, workspace, target, post };
  }

  it('is refused rather than allowed to race', async () => {
    const seed = await seedClaimed();

    await expect(
      posts.updatePost(
        {
          workspaceId: seed.workspace.id,
          userId: seed.owner.id,
          role: WorkspaceRole.owner,
          requiresApproval: false,
        },
        seed.post.id,
        { message: 'Changed my mind' },
      ),
    ).rejects.toThrow(/being published/i);
  });

  it('never deletes the row the worker is holding, even if the check is outrun', async () => {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({ name: 'Racing', ownerId: owner.id });
    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        message: 'Going out now',
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + 3_600_000),
        targets: { create: { targetId: target.id, status: 'pending' } },
      },
    });
    const second = await prisma.target.create({
      data: {
        workspaceId: workspace.id,
        type: 'page',
        providerId: '2000',
        name: 'Second Page',
      },
    });

    // The refusal reads the post, then the write replaces the destinations —
    // two statements, with a window between them. A worker claims inside that
    // window here, while the edit is out fetching the link preview, so the
    // check passes on a state that is no longer true by the time we write.
    duringGraphRequest = async () => {
      await prisma.postTarget.updateMany({
        where: { postId: post.id, targetId: target.id, status: 'pending' },
        data: { status: 'processing', lockedAt: new Date() },
      });
    };

    await posts.updatePost(
      { workspaceId: workspace.id, userId: owner.id, role: WorkspaceRole.owner, requiresApproval: false },
      post.id,
      { link: `${process.env.FACEBOOK_GRAPH_BASE_URL}/preview`, targetIds: [second.id] },
    );

    const after = await prisma.postTarget.findMany({ where: { postId: post.id } });

    // The claimed row survived: it is the only record that this post is
    // already on its way to Facebook, and without it the recreated `pending`
    // row would publish the same post a second time. Losing the race costs a
    // stale destination, which is recoverable; losing the row is not.
    expect(after.filter((row) => row.status === 'processing').map((row) => row.targetId)).toEqual([
      target.id,
    ]);
    expect(after.map((row) => row.targetId).sort()).toEqual([target.id, second.id].sort());
  });
})

/**
 * Cancelling a post Facebook is already holding.
 *
 * Native scheduling hands the post to Facebook at creation time, so the copy
 * that matters lives there, not here. Cancelling has to delete it there too —
 * and when that fails, the one thing it must not do is say the post was
 * cancelled anyway. "Cancelled" in our UI while Facebook publishes on schedule
 * is the worst outcome available: the client sees a post they were told would
 * never go out, and nobody is looking for it because our records agree it is
 * gone.
 */
describe('cancelling a post Facebook is holding', () => {
  async function seedHandedOff(options: { withToken?: boolean } = {}) {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({ name: 'Handed', ownerId: owner.id });

    if (options.withToken === false) {
      // A destination whose page token was cleared — a reconnect that did not
      // finish, or a Page removed from the account.
      await prisma.target.update({
        where: { id: target.id },
        data: { accessToken: null, socialAccountId: null },
      });
    }

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        message: 'Facebook has this one',
        status: PostStatus.scheduled,
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
        targets: {
          create: {
            targetId: target.id,
            status: 'scheduled_remote',
            remotePostId: '1000_4242',
            nativeScheduledFor: new Date(Date.now() + 60 * 60 * 1000),
          },
        },
      },
    });

    return { owner, workspace, target, post };
  }

  const asOwner = (workspaceId: string, userId: string) => ({
    workspaceId,
    userId,
    role: WorkspaceRole.owner,
  });

  it('leaves the destination alone when Facebook refuses the deletion', async () => {
    const seed = await seedHandedOff();
    graphStatus = 400;
    graphBody = {
      error: { message: 'Unsupported delete request.', code: 100, type: 'GraphMethodException' },
    };

    const result = await posts.cancelPost(
      asOwner(seed.workspace.id, seed.owner.id),
      seed.post.id,
    );

    expect(result.failures).toHaveLength(1);
    expect(result.removedFromFacebook).toBe(0);

    // Still scheduled, here and there, because that is the truth.
    const targets = await prisma.postTarget.findMany({ where: { postId: seed.post.id } });
    expect(targets.map((row) => row.status)).toEqual(['scheduled_remote']);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: seed.post.id } });
    expect(after.status).not.toBe(PostStatus.cancelled);
  });

  it('reports a destination it cannot even ask about, rather than skipping it', async () => {
    const seed = await seedHandedOff({ withToken: false });

    const result = await posts.cancelPost(
      asOwner(seed.workspace.id, seed.owner.id),
      seed.post.id,
    );

    // With no token there is no way to reach the post on Facebook. Passing
    // over it silently is worse than failing: it reports a clean cancellation
    // for a post that is still going out.
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatch(/still/i);

    const targets = await prisma.postTarget.findMany({ where: { postId: seed.post.id } });
    expect(targets.map((row) => row.status)).toEqual(['scheduled_remote']);
  });

  it('cancels normally when Facebook accepts the deletion', async () => {
    const seed = await seedHandedOff();

    const result = await posts.cancelPost(
      asOwner(seed.workspace.id, seed.owner.id),
      seed.post.id,
    );

    expect(result.failures).toEqual([]);
    expect(result.removedFromFacebook).toBe(1);

    const targets = await prisma.postTarget.findMany({ where: { postId: seed.post.id } });
    expect(targets.map((row) => row.status)).toEqual(['cancelled']);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: seed.post.id } });
    expect(after.status).toBe(PostStatus.cancelled);
  });
});

/**
 * Switching a post to native scheduling while editing it.
 *
 * The composer offers the same "let Facebook hold it" choice when editing as
 * when creating, so the edit path has to mean the same thing by it. Creating
 * refuses the combinations Facebook cannot honour and hands the post over when
 * it can; editing did neither, so the setting was recorded and then ignored.
 */
describe('changing publish mode on an edit', () => {
  async function seedScheduled(targetType: 'page' | 'group' | 'instagram' = 'page') {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({ name: 'Modes', ownerId: owner.id });

    if (targetType !== 'page') {
      await prisma.target.update({ where: { id: target.id }, data: { type: targetType } });
    }

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        message: 'Going out later',
        status: PostStatus.scheduled,
        publishMode: 'worker',
        scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        targets: { create: { targetId: target.id, status: 'pending' } },
      },
    });

    return { owner, workspace, target, post };
  }

  const context = (workspaceId: string, userId: string) => ({
    workspaceId,
    userId,
    role: WorkspaceRole.owner,
    requiresApproval: false,
  });

  it('refuses native scheduling for a Group, the same as creating one would', async () => {
    const seed = await seedScheduled('group');

    await expect(
      posts.updatePost(context(seed.workspace.id, seed.owner.id), seed.post.id, {
        publishMode: 'native',
        targetIds: [seed.target.id],
      }),
    ).rejects.toThrow(/group/i);
  });

  it('refuses native scheduling for Instagram, the same as creating one would', async () => {
    const seed = await seedScheduled('instagram');

    await expect(
      posts.updatePost(context(seed.workspace.id, seed.owner.id), seed.post.id, {
        publishMode: 'native',
        targetIds: [seed.target.id],
      }),
    ).rejects.toThrow(/instagram/i);
  });

  it('actually hands the post to Facebook when the mode changes to native', async () => {
    const seed = await seedScheduled();

    await posts.updatePost(context(seed.workspace.id, seed.owner.id), seed.post.id, {
      publishMode: 'native',
      targetIds: [seed.target.id],
    });

    // Recording the choice and leaving the post for the worker is the worst
    // reading of it: the whole reason to pick native is that the post survives
    // our worker being down, and the UI would say Facebook had it when nobody
    // had asked Facebook anything.
    const targets = await prisma.postTarget.findMany({ where: { postId: seed.post.id } });
    expect(targets.map((row) => row.status)).toEqual(['scheduled_remote']);
    expect(targets[0]?.remotePostId).toBeTruthy();
  });

  it('does not hand it over when the edit sends it back for review', async () => {
    const owner = await makeUser('Owner');
    const contributor = await makeUser('Contributor');
    const { workspace, target } = await makeWorkspace({
      name: 'Reviewed',
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
        message: 'Approved once',
        status: PostStatus.scheduled,
        publishMode: 'worker',
        approvalStatus: ApprovalStatus.approved,
        scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000),
        targets: { create: { targetId: target.id, status: 'pending' } },
      },
    });

    await posts.updatePost(
      {
        workspaceId: workspace.id,
        userId: contributor.id,
        role: WorkspaceRole.contributor,
        requiresApproval: true,
      },
      post.id,
      { message: 'Changed after approval', publishMode: 'native', targetIds: [target.id] },
    );

    // Handing it to Facebook would publish, on a schedule, something a
    // reviewer has not seen — which is the entire thing the queue prevents.
    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.pending_approval);

    const targets = await prisma.postTarget.findMany({ where: { postId: post.id } });
    expect(targets.map((row) => row.status)).toEqual(['pending']);
  });

  it('does not hand it over when the edit turns it into a draft', async () => {
    const seed = await seedScheduled();

    await posts.updatePost(context(seed.workspace.id, seed.owner.id), seed.post.id, {
      publishMode: 'native',
      targetIds: [seed.target.id],
      scheduledAtLocal: null,
    });

    // A draft has no time for Facebook to hold it until.
    const targets = await prisma.postTarget.findMany({ where: { postId: seed.post.id } });
    expect(targets.map((row) => row.status)).toEqual(['pending']);
  });

  it('leaves a worker post alone when the mode is not what changed', async () => {
    const seed = await seedScheduled();

    await posts.updatePost(context(seed.workspace.id, seed.owner.id), seed.post.id, {
      message: 'Reworded, same plan',
    });

    const targets = await prisma.postTarget.findMany({ where: { postId: seed.post.id } });
    expect(targets.map((row) => row.status)).toEqual(['pending']);
  });
});

/**
 * Retrying one destination of a post that has not gone out yet.
 *
 * A destination can fail long before the scheduled moment: native scheduling
 * hands the post to Facebook at creation time, so a Page that refuses it is
 * `failed` while the rest of the post sits queued for next Friday. Retrying
 * that one destination must not drag it out of the schedule the author chose.
 */
describe('retrying a post that is still ahead of its time', () => {
  async function seedPartiallyHandedOff() {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({ name: 'Split', ownerId: owner.id });
    const second = await prisma.target.create({
      data: { workspaceId: workspace.id, type: 'page', providerId: '2000', name: 'Second Page' },
    });

    const scheduledAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        message: 'Friday campaign',
        status: PostStatus.scheduled,
        publishMode: 'native',
        scheduledAt,
        targets: {
          create: [
            {
              targetId: target.id,
              status: 'scheduled_remote',
              remotePostId: '1000_9999',
              nativeScheduledFor: scheduledAt,
            },
            { targetId: second.id, status: 'failed', errorMessage: 'Page refused it' },
          ],
        },
      },
    });

    return { owner, workspace, post, scheduledAt };
  }

  it('keeps the time the author chose', async () => {
    const seed = await seedPartiallyHandedOff();

    await posts.retryPost(
      { workspaceId: seed.workspace.id, userId: seed.owner.id, role: WorkspaceRole.owner },
      seed.post.id,
    );

    const after = await prisma.post.findUniqueOrThrow({ where: { id: seed.post.id } });

    // Moving it to "now" publishes this destination days early while the other
    // stays queued for Friday — the post goes out twice, at two times, neither
    // of which is the one anybody asked for.
    expect(after.scheduledAt?.toISOString()).toBe(seed.scheduledAt.toISOString());
    expect(after.status).toBe(PostStatus.scheduled);

    const retried = await prisma.postTarget.findFirstOrThrow({
      where: { postId: seed.post.id, status: 'pending' },
    });
    expect(retried.errorMessage).toBeNull();
  });

  it('still makes a post whose moment has passed due immediately', async () => {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({ name: 'Overdue', ownerId: owner.id });
    const scheduledAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: owner.id,
        message: 'Should have gone out',
        status: PostStatus.failed,
        scheduledAt,
        targets: { create: { targetId: target.id, status: 'failed' } },
      },
    });

    await posts.retryPost(
      { workspaceId: workspace.id, userId: owner.id, role: WorkspaceRole.owner },
      post.id,
    );

    // The usual case, and the reason retry moves the time at all: waiting for
    // a slot that is already behind us would mean the retry never runs.
    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.scheduledAt?.getTime()).toBeGreaterThan(scheduledAt.getTime());
    expect(after.scheduledAt?.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

/**
 * What survives a bulk upload that does not finish.
 *
 * A CSV of five hundred rows is processed one at a time inside one request,
 * and each row can scrape a link or, in native mode, hand a post to Facebook —
 * so a large file can outlast a deployment's request timeout. What matters
 * then is whether the work done so far is still there: a run that buffered
 * everything until the end would lose all of it, and the uploader would have
 * no way to tell which rows had already reached Facebook.
 */
describe('a bulk run that stops partway', () => {
  it('keeps every row it finished before the failure', async () => {
    const owner = await makeUser('Owner');
    const { workspace, target } = await makeWorkspace({ name: 'Bulk', ownerId: owner.id });

    const context = {
      workspaceId: workspace.id,
      userId: owner.id,
      role: WorkspaceRole.owner,
      requiresApproval: false,
    };
    const row = (message: string, targetIds: string[]) => ({
      message,
      media: [],
      targetIds,
      publishMode: 'worker' as const,
      scheduledAtLocal: null,
      timezone: 'UTC',
      useQueue: false,
      saveAsDraft: true,
    });

    await posts.createPost(context, row('Row one', [target.id]));
    await posts.createPost(context, row('Row two', [target.id]));

    // A row naming a destination that is not this workspace's fails on its
    // own, the way a timeout would end the run partway.
    await expect(
      posts.createPost(context, row('Row three', ['not-a-real-target'])),
    ).rejects.toThrow();

    // Each row is committed as it is processed, so the two that finished are
    // on the posts list where somebody can see them — which is what makes a
    // half-finished upload recoverable rather than a mystery.
    const stored = await prisma.post.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(stored.map((post) => post.message)).toEqual(['Row one', 'Row two']);
  });
});

/**
 * Turning review off, when things were waiting behind it.
 *
 * This is the batch case in its strongest form: one setting is flipped and
 * every held post is freed at once. The ones whose moment has already gone
 * publish on the next tick — the same thing approving them would have done,
 * and deliberate — but the admin flipping the switch has no idea how many that
 * is. Everything they might have wanted to check first is already on Facebook
 * thirty seconds later.
 */
describe('releasing everything review was holding', () => {
  async function seedHeld(times: Array<Date | null>) {
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

    for (const [index, scheduledAt] of times.entries()) {
      await prisma.post.create({
        data: {
          workspaceId: workspace.id,
          authorId: contributor.id,
          submittedById: contributor.id,
          submittedAt: new Date(),
          message: `Held ${index}`,
          status: PostStatus.pending_approval,
          approvalStatus: ApprovalStatus.pending,
          scheduledAt,
          targets: { create: { targetId: target.id } },
        },
      });
    }

    return { workspace, owner };
  }

  const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);
  const nextWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  it('says how many are going out immediately', async () => {
    const { workspace, owner } = await seedHeld([hourAgo(), hourAgo(), nextWeek(), null]);

    const result = await approvals.releaseHeldPosts({
      workspaceId: workspace.id,
      userId: owner.id,
    });

    expect(result.released).toBe(4);
    // The two that matter: these are on Facebook within the next tick.
    expect(result.publishingNow).toBe(2);
    expect(result.scheduled).toBe(1);
    expect(result.drafts).toBe(1);
  });

  it('counts nothing as immediate when everything is still ahead', async () => {
    const { workspace, owner } = await seedHeld([nextWeek(), nextWeek()]);

    const result = await approvals.releaseHeldPosts({
      workspaceId: workspace.id,
      userId: owner.id,
    });

    expect(result.released).toBe(2);
    expect(result.publishingNow).toBe(0);
  });

  it('records the breakdown, not just a total', async () => {
    const { workspace, owner } = await seedHeld([hourAgo(), nextWeek()]);

    await approvals.releaseHeldPosts({ workspaceId: workspace.id, userId: owner.id });

    // The audit entry is the only durable record — no email is sent, on
    // purpose. A bare total cannot answer "what went out when we did that".
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { workspaceId: workspace.id, action: 'approvals.disabled' },
    });
    expect(entry.detail).toMatchObject({ released: 2, publishingNow: 1 });
  });
});

/**
 * Who may put a post into the review queue, and which posts can go there.
 *
 * Editing, cancelling and retrying all check that the post is yours unless
 * your role covers other people's work. Submitting is the one that changes a
 * post's state on somebody else's behalf and it checked nothing at all — and
 * nothing checked *which* post either, so a published one could be pushed back
 * into the queue reading as unpublished while its copy sat on Facebook.
 */
describe('submitting a post for review', () => {
  async function seedTwoContributors() {
    const owner = await makeUser('Owner');
    const author = await makeUser('Author');
    const other = await makeUser('Other');
    const { workspace, target } = await makeWorkspace({
      name: 'Client',
      ownerId: owner.id,
      requiresApproval: true,
    });
    for (const user of [author, other]) {
      await prisma.membership.create({
        data: { userId: user.id, workspaceId: workspace.id, role: WorkspaceRole.contributor },
      });
    }
    return { workspace, owner, author, other, target };
  }

  async function draftBy(
    workspaceId: string,
    authorId: string,
    targetId: string,
    status: PostStatus = PostStatus.draft,
  ) {
    return prisma.post.create({
      data: {
        workspaceId,
        authorId,
        message: 'A post',
        status,
        scheduledAt: status === PostStatus.draft ? null : new Date(Date.now() + 3_600_000),
        targets: { create: { targetId } },
      },
    });
  }

  it('lets the author submit their own', async () => {
    const seed = await seedTwoContributors();
    const post = await draftBy(seed.workspace.id, seed.author.id, seed.target.id);

    await approvals.submitForApproval({
      workspaceId: seed.workspace.id,
      postId: post.id,
      userId: seed.author.id,
      role: WorkspaceRole.contributor,
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.pending_approval);
  });

  it('refuses a contributor submitting a draft that is not theirs', async () => {
    const seed = await seedTwoContributors();
    const post = await draftBy(seed.workspace.id, seed.author.id, seed.target.id);

    await expect(
      approvals.submitForApproval({
        workspaceId: seed.workspace.id,
        postId: post.id,
        userId: seed.other.id,
        role: WorkspaceRole.contributor,
      }),
    ).rejects.toThrow(/permission/i);
  });

  it('lets an owner submit on behalf of a contributor', async () => {
    const seed = await seedTwoContributors();
    const post = await draftBy(seed.workspace.id, seed.author.id, seed.target.id);

    await approvals.submitForApproval({
      workspaceId: seed.workspace.id,
      postId: post.id,
      userId: seed.owner.id,
      role: WorkspaceRole.owner,
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.pending_approval);
  });

  it('refuses to put a published post back in the queue', async () => {
    const seed = await seedTwoContributors();
    const post = await draftBy(seed.workspace.id, seed.author.id, seed.target.id, PostStatus.published);

    // It is already on Facebook. Reading as "awaiting review" afterwards
    // describes a decision nobody can now make.
    await expect(
      approvals.submitForApproval({
        workspaceId: seed.workspace.id,
        postId: post.id,
        userId: seed.author.id,
        role: WorkspaceRole.contributor,
      }),
    ).rejects.toThrow();

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.published);
  });

  it('lets a rejected post be sent back after changes', async () => {
    const seed = await seedTwoContributors();
    const post = await draftBy(seed.workspace.id, seed.author.id, seed.target.id, PostStatus.rejected);

    await approvals.submitForApproval({
      workspaceId: seed.workspace.id,
      postId: post.id,
      userId: seed.author.id,
      role: WorkspaceRole.contributor,
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.pending_approval);
    expect(after.reviewNote).toBeNull();
  });
});
