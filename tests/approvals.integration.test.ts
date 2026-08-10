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
        scheduledAtLocal: '2027-01-01T09:00',
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
        scheduledAtLocal: '2027-01-01T09:00',
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
        scheduledAtLocal: '2027-01-01T09:00',
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
          scheduledAtLocal: '2027-01-01T09:00',
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
