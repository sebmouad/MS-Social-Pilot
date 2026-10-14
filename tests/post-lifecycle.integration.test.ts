import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { ApprovalStatus, PostStatus, WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * The ways round review, closed one at a time.
 *
 * Each of these was a path by which a post a reviewer never saw could reach a
 * client's Page, or by which a post waiting for review fell out of the queue
 * and was never published at all: editing a draft into the schedule, editing a
 * held post, switching a held post to native, and "Post now". The fixes all
 * live in different places, so each gets a test that fails without its own.
 */

const jar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      jar.set(name, value);
    },
    delete: (name: string) => {
      jar.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));

let server: Server;
let database: TestDatabase;
/** Every request the fake Graph server saw, with its body. */
let graphCalls: Array<{ url: string; body: string }> = [];

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let posts: typeof import('../src/lib/posts');
let approvals: typeof import('../src/lib/approvals');
let runner: typeof import('../src/lib/scheduler/runner');

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      graphCalls.push({ url: request.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: '1000_5000' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');

  setTestEnv({ FACEBOOK_GRAPH_BASE_URL: `http://127.0.0.1:${address.port}` });
  database = setupTestDatabase('lifecycle');

  ({ prisma } = await import('../src/lib/prisma'));
  posts = await import('../src/lib/posts');
  approvals = await import('../src/lib/approvals');
  runner = await import('../src/lib/scheduler/runner');
  await (await import('../src/lib/settings')).writeSetting('features.instagram', true, null);
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database?.drop();
});

beforeEach(async () => {
  graphCalls = [];
  jar.clear();
  await prisma.shortLink.deleteMany();
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.queueSlot.deleteMany();
  await prisma.target.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.emailLog.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

const HOUR = 60 * 60 * 1000;

/** `datetime-local` in UTC, which is the zone every workspace here uses. */
function localInput(date: Date): string {
  return date.toISOString().slice(0, 16);
}

async function seed(options: { requiresApproval?: boolean } = {}) {
  const { encryptSecret } = await import('../src/lib/crypto');
  const make = (name: string) =>
    prisma.user.create({
      data: { email: `${name}-${randomBytes(3).toString('hex')}@example.com`, name, passwordHash: 'x' },
    });

  const owner = await make('Owner');
  const editor = await make('Editor');
  const contributor = await make('Contributor');

  const workspace = await prisma.workspace.create({
    data: {
      name: 'Client',
      slug: `client-${randomBytes(3).toString('hex')}`,
      timezone: 'UTC',
      requiresApproval: options.requiresApproval ?? true,
      memberships: {
        create: [
          { userId: owner.id, role: WorkspaceRole.owner },
          { userId: editor.id, role: WorkspaceRole.editor },
          { userId: contributor.id, role: WorkspaceRole.contributor },
        ],
      },
    },
  });

  const target = await prisma.target.create({
    data: {
      workspaceId: workspace.id,
      type: 'page',
      providerId: '1000',
      name: 'Client Page',
      accessToken: encryptSecret('page-token'),
    },
  });

  const as = (user: { id: string }, role: WorkspaceRole) => ({
    workspaceId: workspace.id,
    userId: user.id,
    role,
    requiresApproval: options.requiresApproval ?? true,
  });

  return { owner, editor, contributor, workspace, target, as };
}

type Seed = Awaited<ReturnType<typeof seed>>;

function makePost(
  s: Seed,
  data: {
    status: PostStatus;
    approvalStatus: ApprovalStatus;
    scheduledAt?: Date | null;
    publishMode?: 'worker' | 'native';
    authorId?: string;
    message?: string;
    link?: string | null;
    targetStatus?: 'pending' | 'failed';
  },
) {
  return prisma.post.create({
    data: {
      workspaceId: s.workspace.id,
      authorId: data.authorId ?? s.contributor.id,
      submittedById: data.approvalStatus === ApprovalStatus.pending ? s.contributor.id : null,
      message: data.message ?? 'Hello',
      link: data.link ?? null,
      status: data.status,
      approvalStatus: data.approvalStatus,
      publishMode: data.publishMode ?? 'worker',
      scheduledAt: data.scheduledAt ?? null,
      timezone: 'UTC',
      targets: { create: { targetId: s.target.id, status: data.targetStatus ?? 'pending' } },
    },
  });
}

describe('editing a contributor draft into the schedule', () => {
  it('sends it for review rather than scheduling it', async () => {
    const s = await seed();
    const draft = await makePost(s, {
      status: PostStatus.draft,
      // What `initialApprovalStatus` gives every draft: nothing was submitted.
      approvalStatus: ApprovalStatus.not_required,
    });

    await posts.updatePost(s.as(s.contributor, WorkspaceRole.contributor), draft.id, {
      message: 'Hello',
      scheduledAtLocal: localInput(new Date(Date.now() + 3 * HOUR)),
      timezone: 'UTC',
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe(PostStatus.pending_approval);
    expect(after.approvalStatus).toBe(ApprovalStatus.pending);
    expect(after.submittedById).toBe(s.contributor.id);
    expect(await approvals.pendingApprovalCount(s.workspace.id, { all: true })).toBe(1);
  });

  it('lets an editor schedule their own draft directly', async () => {
    const s = await seed();
    const draft = await makePost(s, {
      status: PostStatus.draft,
      approvalStatus: ApprovalStatus.not_required,
      authorId: s.editor.id,
    });

    await posts.updatePost(s.as(s.editor, WorkspaceRole.editor), draft.id, {
      scheduledAtLocal: localInput(new Date(Date.now() + 3 * HOUR)),
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe(PostStatus.scheduled);
    expect(after.approvalStatus).toBe(ApprovalStatus.approved);
  });

  it('schedules it directly when the workspace does not review', async () => {
    const s = await seed({ requiresApproval: false });
    const draft = await makePost(s, { status: PostStatus.draft, approvalStatus: ApprovalStatus.not_required });

    await posts.updatePost(s.as(s.contributor, WorkspaceRole.contributor), draft.id, {
      scheduledAtLocal: localInput(new Date(Date.now() + 3 * HOUR)),
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe(PostStatus.scheduled);
    expect(after.approvalStatus).toBe(ApprovalStatus.not_required);
  });
});

describe('editing a post that is waiting for review', () => {
  it('keeps it in the queue instead of stranding it as scheduled', async () => {
    const s = await seed();
    const held = await makePost(s, {
      status: PostStatus.pending_approval,
      approvalStatus: ApprovalStatus.pending,
      scheduledAt: new Date(Date.now() + 3 * HOUR),
    });

    // The composer resends the time with every save.
    await posts.updatePost(s.as(s.contributor, WorkspaceRole.contributor), held.id, {
      message: 'Fixed a typo',
      scheduledAtLocal: localInput(held.scheduledAt!),
      timezone: 'UTC',
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: held.id } });
    expect(after.status).toBe(PostStatus.pending_approval);
    expect(after.approvalStatus).toBe(ApprovalStatus.pending);
    expect(await approvals.pendingApprovalCount(s.workspace.id, { all: true })).toBe(1);
  });

  it('keeps it waiting even when an editor edits it — editing is not approving', async () => {
    const s = await seed();
    const held = await makePost(s, {
      status: PostStatus.pending_approval,
      approvalStatus: ApprovalStatus.pending,
      scheduledAt: new Date(Date.now() + 3 * HOUR),
    });

    await posts.updatePost(s.as(s.editor, WorkspaceRole.editor), held.id, {
      message: 'Tidied by an editor',
      scheduledAtLocal: localInput(held.scheduledAt!),
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: held.id } });
    expect(after.status).toBe(PostStatus.pending_approval);
    expect(after.approvalStatus).toBe(ApprovalStatus.pending);
  });

  it('sends a rejected post back to review once it is edited', async () => {
    const s = await seed();
    const rejected = await prisma.post.create({
      data: {
        workspaceId: s.workspace.id,
        authorId: s.contributor.id,
        message: 'Off-brand',
        status: PostStatus.rejected,
        approvalStatus: ApprovalStatus.rejected,
        reviewedById: s.owner.id,
        reviewedAt: new Date(),
        reviewNote: 'Tone it down.',
        scheduledAt: new Date(Date.now() + 3 * HOUR),
        timezone: 'UTC',
        targets: { create: { targetId: s.target.id } },
      },
    });

    await posts.updatePost(s.as(s.contributor, WorkspaceRole.contributor), rejected.id, {
      message: 'On-brand now',
      scheduledAtLocal: localInput(rejected.scheduledAt!),
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: rejected.id } });
    expect(after.status).toBe(PostStatus.pending_approval);
    expect(after.approvalStatus).toBe(ApprovalStatus.pending);
    expect(after.reviewNote).toBeNull();
    expect(await approvals.pendingApprovalCount(s.workspace.id, { all: true })).toBe(1);
  });

  it('is not handed to Facebook when switched to native', async () => {
    const s = await seed();
    const held = await makePost(s, {
      status: PostStatus.pending_approval,
      approvalStatus: ApprovalStatus.pending,
      scheduledAt: new Date(Date.now() + 3 * HOUR),
    });

    // Nothing the reviewer looks at changes, so this is not a re-review — and
    // that was the only thing the hand-off checked.
    await posts.updatePost(s.as(s.contributor, WorkspaceRole.contributor), held.id, {
      publishMode: 'native',
    });

    expect(graphCalls).toHaveLength(0);
    const targets = await prisma.postTarget.findMany({ where: { postId: held.id } });
    expect(targets.map((row) => row.status)).toEqual(['pending']);
  });
});

describe('editing a post whose time has passed', () => {
  it('lets the text be fixed without moving the time', async () => {
    const s = await seed({ requiresApproval: false });
    const failed = await makePost(s, {
      status: PostStatus.failed,
      approvalStatus: ApprovalStatus.not_required,
      scheduledAt: new Date(Date.now() - HOUR),
      authorId: s.owner.id,
      targetStatus: 'failed',
    });

    await posts.updatePost(s.as(s.owner, WorkspaceRole.owner), failed.id, {
      message: 'Typo fixed',
      scheduledAtLocal: localInput(failed.scheduledAt!),
      timezone: 'UTC',
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: failed.id } });
    expect(after.message).toBe('Typo fixed');
    expect(after.scheduledAt?.getTime()).toBe(failed.scheduledAt?.getTime());

    // Fixing the text is not asking for it to go out: that is what retrying
    // is for. The form carrying the old time must not publish it on the next
    // tick.
    expect(after.status).toBe(PostStatus.failed);
    const tick = await runner.runSchedulerTick();
    expect(tick.claimed).toBe(0);
    expect(graphCalls).toHaveLength(0);
  });

  it('keeps an overdue post that is still scheduled on its way out', async () => {
    const s = await seed({ requiresApproval: false });
    const overdue = await makePost(s, {
      status: PostStatus.scheduled,
      approvalStatus: ApprovalStatus.not_required,
      scheduledAt: new Date(Date.now() - 5 * 60 * 1000),
      authorId: s.owner.id,
    });

    await posts.updatePost(s.as(s.owner, WorkspaceRole.owner), overdue.id, {
      message: 'Corrected before the tick',
      scheduledAtLocal: localInput(overdue.scheduledAt!),
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: overdue.id } });
    expect(after.status).toBe(PostStatus.scheduled);
  });

  it('still refuses moving it to another time in the past', async () => {
    const s = await seed({ requiresApproval: false });
    const post = await makePost(s, {
      status: PostStatus.scheduled,
      approvalStatus: ApprovalStatus.not_required,
      scheduledAt: new Date(Date.now() + HOUR),
      authorId: s.owner.id,
    });

    await expect(
      posts.updatePost(s.as(s.owner, WorkspaceRole.owner), post.id, {
        scheduledAtLocal: localInput(new Date(Date.now() - 2 * HOUR)),
      }),
    ).rejects.toThrow(/already passed/i);
  });

  it('refuses an edit that would leave the post with nothing in it', async () => {
    const s = await seed({ requiresApproval: false });
    const post = await makePost(s, {
      status: PostStatus.draft,
      approvalStatus: ApprovalStatus.not_required,
      authorId: s.owner.id,
    });

    await expect(
      posts.updatePost(s.as(s.owner, WorkspaceRole.owner), post.id, { message: '   ' }),
    ).rejects.toThrow(/write something/i);
  });
});

describe('the edit schema', () => {
  it('has the same content rules as creating', async () => {
    const { updatePostSchema } = await import('../src/lib/validation');
    const video = { id: 'v', kind: 'video' as const, url: '/v.mp4' };
    const photo = { id: 'p', kind: 'image' as const, url: '/p.jpg' };

    expect(updatePostSchema.safeParse({ media: [video, photo] }).success).toBe(false);
    expect(updatePostSchema.safeParse({ media: [video, { ...video, id: 'w' }] }).success).toBe(false);
    expect(updatePostSchema.safeParse({ message: '', link: null, media: [] }).success).toBe(false);
    expect(updatePostSchema.safeParse({ message: 'fine', link: null, media: [photo] }).success).toBe(true);
    // Partial edits stay partial.
    expect(updatePostSchema.safeParse({ message: '' }).success).toBe(true);
  });
});

describe('"Post now"', () => {
  async function publishAs(s: Seed, user: { id: string }, postId: string) {
    const { createSession } = await import('../src/lib/auth');
    jar.set('msp_session', await createSession(user.id));
    const module = await import('../src/app/api/posts/[id]/publish/route');
    return module.POST(new Request(`http://localhost/api/posts/${postId}/publish`, { method: 'POST' }), {
      params: Promise.resolve({ id: postId }),
    });
  }

  it('will not put a contributor draft on the Page while review is on', async () => {
    const s = await seed();
    const draft = await makePost(s, { status: PostStatus.draft, approvalStatus: ApprovalStatus.not_required });

    const response = await publishAs(s, s.contributor, draft.id);

    expect(response.status).toBe(403);
    expect(graphCalls).toHaveLength(0);
    const after = await prisma.post.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe(PostStatus.draft);
  });

  it('still works for an editor, who needs no review', async () => {
    const s = await seed();
    const draft = await makePost(s, {
      status: PostStatus.draft,
      approvalStatus: ApprovalStatus.not_required,
      authorId: s.editor.id,
    });

    const response = await publishAs(s, s.editor, draft.id);

    expect(response.status).toBe(200);
    expect(graphCalls).toHaveLength(1);
  });

  it('refuses a post somebody is still reviewing, whoever presses it', async () => {
    const s = await seed();
    const held = await makePost(s, {
      status: PostStatus.pending_approval,
      approvalStatus: ApprovalStatus.pending,
      scheduledAt: new Date(Date.now() + HOUR),
    });

    const response = await publishAs(s, s.owner, held.id);

    expect(response.status).toBe(409);
    expect(graphCalls).toHaveLength(0);
  });
});

describe('approving a post meant for Facebook to hold', () => {
  it('hands it to Facebook, rather than leaving it to our worker', async () => {
    const s = await seed();
    const held = await makePost(s, {
      status: PostStatus.pending_approval,
      approvalStatus: ApprovalStatus.pending,
      publishMode: 'native',
      scheduledAt: new Date(Date.now() + 3 * HOUR),
    });

    const result = await approvals.approvePost({
      workspaceId: s.workspace.id,
      postId: held.id,
      reviewerId: s.owner.id,
      reviewerRole: WorkspaceRole.owner,
    });

    expect(result.nativeFallback).toBeNull();
    expect(graphCalls).toHaveLength(1);
    expect(graphCalls[0]!.body).toContain('scheduled_publish_time');
    const targets = await prisma.postTarget.findMany({ where: { postId: held.id } });
    expect(targets.map((row) => row.status)).toEqual(['scheduled_remote']);
  });

  it('keeps an overdue one with our worker, and says so', async () => {
    const s = await seed();
    const held = await makePost(s, {
      status: PostStatus.pending_approval,
      approvalStatus: ApprovalStatus.pending,
      publishMode: 'native',
      scheduledAt: new Date(Date.now() - HOUR),
    });

    const result = await approvals.approvePost({
      workspaceId: s.workspace.id,
      postId: held.id,
      reviewerId: s.owner.id,
      reviewerRole: WorkspaceRole.owner,
    });

    // Facebook refuses anything under ten minutes out; handing it over would
    // have failed the destination the reviewer just cleared.
    expect(result.nativeFallback).toBe('too_soon');
    expect(graphCalls).toHaveLength(0);

    const after = await prisma.post.findUniqueOrThrow({ where: { id: held.id } });
    expect(after.publishMode).toBe('worker');
    expect(after.status).toBe(PostStatus.scheduled);

    const tick = await runner.runSchedulerTick();
    expect(tick.published).toBe(1);
  });
});

describe('handing a post to Facebook', () => {
  it('tags its links the way the worker would', async () => {
    const s = await seed({ requiresApproval: false });
    await prisma.workspace.update({
      where: { id: s.workspace.id },
      data: { utmSource: 'facebook', utmMedium: 'social' },
    });

    await posts.createPost(s.as(s.owner, WorkspaceRole.owner), {
      message: 'Read this',
      link: 'https://example.com/article',
      media: [],
      targetIds: [s.target.id],
      publishMode: 'native',
      scheduledAtLocal: localInput(new Date(Date.now() + 3 * HOUR)),
      timezone: 'UTC',
      useQueue: false,
      saveAsDraft: false,
    });

    const feed = graphCalls.find((call) => call.url.includes('/feed'));
    expect(feed, JSON.stringify(graphCalls)).toBeDefined();
    expect(decodeURIComponent(feed!.body)).toContain('utm_source=facebook');
  });
});

describe('withdrawing a post from review', () => {
  it('returns it to the author as a draft, off the approvals screen', async () => {
    const s = await seed();
    const post = await makePost(s, {
      status: PostStatus.pending_approval,
      approvalStatus: ApprovalStatus.pending,
      scheduledAt: new Date(Date.now() + 3 * HOUR),
    });

    await approvals.withdrawFromReview({
      workspaceId: s.workspace.id,
      postId: post.id,
      userId: s.contributor.id,
      role: WorkspaceRole.contributor,
    });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.status).toBe(PostStatus.draft);
    expect(after.approvalStatus).toBe(ApprovalStatus.not_required);
    expect(after.submittedById).toBeNull();
    expect(await approvals.pendingApprovalCount(s.workspace.id, { all: true })).toBe(0);
  });

  it('refuses someone else\'s post, and one no longer waiting', async () => {
    const s = await seed();
    const theirs = await makePost(s, {
      status: PostStatus.pending_approval,
      approvalStatus: ApprovalStatus.pending,
      authorId: s.editor.id,
    });
    await expect(
      approvals.withdrawFromReview({
        workspaceId: s.workspace.id,
        postId: theirs.id,
        userId: s.contributor.id,
        role: WorkspaceRole.contributor,
      }),
    ).rejects.toMatchObject({ key: 'errors.noPermission' });

    const approved = await makePost(s, { status: PostStatus.scheduled, approvalStatus: ApprovalStatus.approved });
    await expect(
      approvals.withdrawFromReview({
        workspaceId: s.workspace.id,
        postId: approved.id,
        userId: s.contributor.id,
        role: WorkspaceRole.contributor,
      }),
    ).rejects.toMatchObject({ key: 'errors.notPending' });
  });
});

describe('Instagram without media', () => {
  async function instagram(s: Seed) {
    await prisma.user.update({ where: { id: s.owner.id }, data: { isInstanceOwner: true } });
    const { encryptSecret } = await import('../src/lib/crypto');
    return prisma.target.create({
      data: {
        workspaceId: s.workspace.id,
        type: 'instagram',
        providerId: 'ig-1',
        name: '@client',
        accessToken: encryptSecret('ig-token'),
      },
    });
  }

  const textOnly = (targetIds: string[], saveAsDraft: boolean) => ({
    message: 'Words only',
    link: null,
    media: [],
    targetIds,
    publishMode: 'worker' as const,
    scheduledAtLocal: localInput(new Date(Date.now() + 3 * HOUR)),
    timezone: 'UTC',
    useQueue: false,
    saveAsDraft,
  });

  it('is refused when scheduled, naming the account', async () => {
    const s = await seed({ requiresApproval: false });
    const ig = await instagram(s);

    await expect(
      posts.createPost(s.as(s.owner, WorkspaceRole.owner), textOnly([s.target.id, ig.id], false)),
    ).rejects.toMatchObject({ key: 'errors.instagramNeedsMedia', params: { names: '@client' } });
  });

  it('may still be saved as a draft, but not scheduled from one', async () => {
    const s = await seed({ requiresApproval: false });
    const ig = await instagram(s);

    const { postId } = await posts.createPost(s.as(s.owner, WorkspaceRole.owner), textOnly([ig.id], true));

    await expect(
      posts.updatePost(s.as(s.owner, WorkspaceRole.owner), postId, {
        scheduledAtLocal: localInput(new Date(Date.now() + 3 * HOUR)),
        timezone: 'UTC',
        status: 'scheduled',
      }),
    ).rejects.toMatchObject({ key: 'errors.instagramNeedsMedia' });
  });
});

describe('listing posts', () => {
  it('answers a malformed date range with a 400, not a 500', async () => {
    const s = await seed();
    const { createSession } = await import('../src/lib/auth');
    jar.set('msp_session', await createSession(s.owner.id));
    const module = await import('../src/app/api/posts/route');

    const bad = await module.GET(new Request('http://localhost/api/posts?from=not-a-date'));
    expect(bad.status).toBe(400);

    const backwards = await module.GET(
      new Request('http://localhost/api/posts?from=2026-02-01&to=2026-01-01'),
    );
    expect(backwards.status).toBe(400);

    const good = await module.GET(new Request('http://localhost/api/posts?from=2026-01-01&to=2026-02-01'));
    expect(good.status).toBe(200);
  });
});

describe('allocating a queue slot', () => {
  it('never hands the same slot to two transactions at once', async () => {
    const s = await seed({ requiresApproval: false });
    await prisma.queueSlot.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        workspaceId: s.workspace.id,
        dayOfWeek,
        hour: 9,
        minute: 0,
      })),
    });

    const claim = () =>
      prisma.$transaction(async (tx) => {
        const at = await posts.allocateQueueSlot(tx, s.workspace.id, 'UTC');
        await tx.post.create({
          data: {
            workspaceId: s.workspace.id,
            authorId: s.owner.id,
            message: 'Queued',
            status: PostStatus.scheduled,
            scheduledAt: at,
            timezone: 'UTC',
          },
        });
        return at;
      });

    const [first, second, third] = await Promise.all([claim(), claim(), claim()]);
    const times = new Set([first, second, third].map((date) => date.getTime()));
    expect(times.size).toBe(3);
  });

  it('says so when the workspace has no queue times', async () => {
    const s = await seed({ requiresApproval: false });
    await expect(
      prisma.$transaction((tx) => posts.allocateQueueSlot(tx, s.workspace.id, 'UTC')),
    ).rejects.toThrow(/queue is empty/i);
  });
});
