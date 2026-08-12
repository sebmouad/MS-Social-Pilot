import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Comments, ratings, inbox threads, videos, unscheduled posts, Instagram and
 * advertising — end to end against a stub Graph and a real database.
 *
 * Two properties are load-bearing and neither is visible from a unit test:
 *
 * - **Partial failure.** A Page whose token cannot read the inbox must still
 *   get its comments. One refused edge cannot take the pass down with it.
 * - **Tenant isolation.** None of these rows carry a workspace id of their own;
 *   they are reached by joining through the Page or the post. If that join is
 *   ever loosened, one client sees another's inbox.
 */

let database: TestDatabase;
let server: Server;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let engagement: typeof import('../src/lib/engagement');
let instagram: typeof import('../src/lib/instagram');
let ads: typeof import('../src/lib/ads');

/** Path suffix to handler. A missing route answers like Graph does: error 100. */
let routes: Record<string, () => unknown> = {};
/** Path suffixes that should answer with a permission error instead. */
let denied: string[] = [];
/** Every write Graph received, so a test can check what was actually sent. */
let received: Array<{ path: string; body: string }> = [];

beforeAll(async () => {
  setTestEnv();

  server = createServer((request, response) => {
    const url = new URL(request.url ?? '', 'http://localhost');

    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      if (chunks.length > 0) {
        received.push({ path: url.pathname, body: Buffer.concat(chunks).toString('utf8') });
      }
    });

    if (denied.some((suffix) => url.pathname.endsWith(suffix))) {
      response.writeHead(403, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ error: { message: 'Permissions error', code: 200 } }),
      );
      return;
    }

    // Longest suffix wins, so `/c1/comments` beats the generic `/comments`.
    const match = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((suffix) => url.pathname.endsWith(suffix));
    if (!match) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: '(#100) Unknown path', code: 100 } }));
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(routes[match]!()));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  process.env.FACEBOOK_GRAPH_BASE_URL = `http://127.0.0.1:${address.port}`;

  database = setupTestDatabase('engagement');

  ({ prisma } = await import('../src/lib/prisma'));
  engagement = await import('../src/lib/engagement');
  instagram = await import('../src/lib/instagram');
  ads = await import('../src/lib/ads');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  routes = {};
  denied = [];
  received = [];

  await prisma.postComment.deleteMany();
  await prisma.conversationMessage.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.pageReview.deleteMany();
  await prisma.externalPost.deleteMany();
  await prisma.pageVideo.deleteMany();
  await prisma.instagramInsight.deleteMany();
  await prisma.instagramMedia.deleteMany();
  await prisma.instagramAccount.deleteMany();
  await prisma.adInsight.deleteMany();
  await prisma.adAccount.deleteMany();
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.target.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seedWorkspace(label = 'client') {
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
  const target = await prisma.target.create({
    data: {
      workspaceId: workspace.id,
      socialAccountId: account.id,
      type: 'page',
      providerId: `page-${suffix}`,
      name: `${label} Page`,
      accessToken: encryptSecret('page-token'),
    },
  });
  const post = await prisma.post.create({
    data: {
      workspaceId: workspace.id,
      authorId: user.id,
      message: 'Hello world',
      status: 'published',
      targets: {
        create: {
          targetId: target.id,
          status: 'published',
          remotePostId: `post-${suffix}`,
          publishedAt: new Date('2026-08-01T10:00:00Z'),
        },
      },
    },
    include: { targets: true },
  });

  return { user, workspace, account, target, post, postTarget: post.targets[0]! };
}

/** The full happy-path Graph, so individual tests only override what matters. */
function stubEverything(): void {
  routes['/comments'] = () => ({
    data: [
      {
        id: 'c1',
        message: 'Love this',
        created_time: '2026-08-01T12:00:00+0000',
        like_count: 2,
        from: { id: 'u1', name: 'Ada' },
      },
    ],
  });
  routes['/ratings'] = () => ({
    data: [
      {
        created_time: '2026-07-01T10:00:00+0000',
        rating: 5,
        review_text: 'Great service',
        reviewer: { name: 'Ada' },
        open_graph_story: { id: 's1' },
      },
      {
        created_time: '2026-07-02T10:00:00+0000',
        rating: 3,
        reviewer: { name: 'Grace' },
        open_graph_story: { id: 's2' },
      },
    ],
  });
  routes['/conversations'] = () => ({
    data: [
      {
        id: 't1',
        snippet: 'Are you open?',
        unread_count: 1,
        message_count: 2,
        updated_time: '2026-08-02T10:00:00+0000',
        participants: { data: [{ name: 'Ada' }] },
        messages: {
          data: [
            {
              id: 'm1',
              message: 'Are you open?',
              created_time: '2026-08-02T09:00:00+0000',
              from: { name: 'Ada' },
            },
          ],
        },
      },
    ],
  });
  routes['/published_posts'] = () => ({
    data: [
      { id: 'external-1', message: 'Posted from the app', created_time: '2026-08-03T10:00:00+0000' },
    ],
  });
  routes['/videos'] = () => ({
    data: [
      { id: 'v1', title: 'Launch', length: 30, created_time: '2026-08-01T10:00:00+0000' },
    ],
  });
  routes['/video_insights'] = () => ({
    data: [
      { name: 'total_video_views', period: 'lifetime', values: [{ value: 500 }] },
      { name: 'total_video_view_total_time', period: 'lifetime', values: [{ value: 90000 }] },
    ],
  });
}

describe('syncTargetEdges', () => {
  it('stores every edge in one pass', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();

    const result = await engagement.syncTargetEdges({ targetId: target.id });

    expect(result.errors).toEqual([]);
    expect(result.comments).toBe(1);
    expect(result.reviews).toBe(2);
    expect(result.conversations).toBe(1);
    expect(result.externalPosts).toBe(1);
    expect(result.videos).toBe(1);

    expect(await prisma.postComment.count()).toBe(1);
    expect(await prisma.conversationMessage.count()).toBe(1);
    expect(
      (await engagement.readReviews({ workspaceId: workspace.id })).averageRating,
    ).toBe(4);
  });

  it('keeps the other edges when one is refused', async () => {
    // The whole point of catching per edge: a Page without the messaging
    // permission should still get its comments and ratings.
    const { target } = await seedWorkspace();
    stubEverything();
    denied = ['/conversations'];

    const result = await engagement.syncTargetEdges({ targetId: target.id });

    expect(result.comments).toBe(1);
    expect(result.reviews).toBe(2);
    expect(result.conversations).toBe(0);
    expect(result.errors.map((error) => error.edge)).toEqual(['conversations']);
    expect(result.errors[0]!.message).toMatch(/permission/i);
  });

  it('is idempotent', async () => {
    const { target } = await seedWorkspace();
    stubEverything();

    await engagement.syncTargetEdges({ targetId: target.id });
    await engagement.syncTargetEdges({ targetId: target.id });

    expect(await prisma.postComment.count()).toBe(1);
    expect(await prisma.pageReview.count()).toBe(2);
    expect(await prisma.conversation.count()).toBe(1);
  });

  it('does not store our own posts as external ones', async () => {
    // Otherwise every Page-level total counts scheduled posts twice.
    const { target, postTarget } = await seedWorkspace();
    stubEverything();
    routes['/published_posts'] = () => ({
      data: [
        { id: postTarget.remotePostId, message: 'Ours', created_time: '2026-08-01T10:00:00+0000' },
        { id: 'someone-else', message: 'Theirs', created_time: '2026-08-03T10:00:00+0000' },
      ],
    });

    const result = await engagement.syncTargetEdges({ targetId: target.id });

    expect(result.externalPosts).toBe(1);
    const stored = await prisma.externalPost.findMany();
    expect(stored.map((row) => row.remoteId)).toEqual(['someone-else']);
  });

  it('attaches video-level insights to the video', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();

    await engagement.syncTargetEdges({ targetId: target.id });
    const [video] = await engagement.readVideos({ workspaceId: workspace.id });

    expect(video!.views).toBe(500);
    expect(video!.totalWatchTimeMs).toBe(90000);
  });

  it('refuses to touch a Group', async () => {
    const { workspace } = await seedWorkspace();
    const group = await prisma.target.create({
      data: {
        workspaceId: workspace.id,
        type: 'group',
        providerId: 'group-1',
        name: 'A Group',
      },
    });

    const result = await engagement.syncTargetEdges({ targetId: group.id });
    expect(result.errors[0]!.message).toMatch(/group/i);
    expect(result.comments).toBe(0);
  });
});

describe('external post insights', () => {
  /** The post catalogue, as Graph returns it for a single post. */
  function stubPostCatalogue(): void {
    routes['/insights'] = () => ({
      data: [
        { name: 'post_impressions', period: 'lifetime', values: [{ value: 4000 }] },
        { name: 'post_impressions_unique', period: 'lifetime', values: [{ value: 3100 }] },
        { name: 'post_engaged_users', period: 'lifetime', values: [{ value: 210 }] },
        {
          name: 'post_reactions_by_type_total',
          period: 'lifetime',
          values: [{ value: { like: 40, love: 9 } }],
        },
      ],
    });
    routes['/external-1'] = () => ({
      likes: { summary: { total_count: 49 } },
      comments: { summary: { total_count: 7 } },
      shares: { count: 3 },
      permalink_url: 'https://facebook.com/external-1',
    });
  }

  it('reads the full catalogue for a post nobody scheduled here', async () => {
    // Without this the list can say a colleague posted from the Facebook app
    // but not whether anyone saw it, and Page-level totals stay wrong.
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();
    stubPostCatalogue();

    await engagement.syncTargetEdges({ targetId: target.id });

    const [post] = await engagement.readExternalPosts({ workspaceId: workspace.id });
    expect(post!.impressions).toBe(4000);
    expect(post!.reach).toBe(3100);
    expect(post!.reactions).toBe(49);
    expect(post!.metricCount).toBe(4);
    expect(post!.syncedAt).not.toBeNull();
  });

  it('backfills the permalink Graph reported', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();
    stubPostCatalogue();

    await engagement.syncTargetEdges({ targetId: target.id });

    const [post] = await engagement.readExternalPosts({ workspaceId: workspace.id });
    expect(post!.permalink).toBe('https://facebook.com/external-1');
  });

  it('stores the post without insights when the catalogue is refused', async () => {
    // A refused insights edge must not lose the post itself.
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();
    denied = ['/insights'];

    await engagement.syncTargetEdges({ targetId: target.id });

    const [post] = await engagement.readExternalPosts({ workspaceId: workspace.id });
    expect(post!.message).toBe('Posted from the app');
    expect(post!.metricCount).toBe(0);
  });
});

describe('readPostMetrics', () => {
  it('returns every stored metric with its catalogue description', async () => {
    const { workspace, target, postTarget, user } = await seedWorkspace();
    routes['/insights'] = () => ({
      data: [
        { name: 'post_impressions', period: 'lifetime', values: [{ value: 900 }] },
        { name: 'post_clicks_by_type', period: 'lifetime', values: [{ value: { link: 12 } }] },
      ],
    });
    routes[`/${postTarget.remotePostId}`] = () => ({ shares: { count: 1 } });

    const { syncPostInsights } = await import('../src/lib/analytics');
    await syncPostInsights(postTarget.id);

    const { readPostMetrics } = await import('../src/lib/analytics');
    const result = await readPostMetrics({
      workspaceId: workspace.id,
      postTargetId: postTarget.id,
    });

    expect(result!.targetName).toBe(target.name);
    const impressions = result!.metrics.find((row) => row.metric === 'post_impressions');
    expect(impressions!.value).toBe(900);
    expect(impressions!.description.length).toBeGreaterThan(10);
    expect(impressions!.breakdown).toBe(false);

    const clicks = result!.metrics.find((row) => row.metric === 'post_clicks_by_type');
    expect(clicks!.breakdown).toBe(true);
    expect(clicks!.value).toEqual({ link: 12 });
  });

  it('will not read a post from another workspace', async () => {
    const mine = await seedWorkspace('mine');
    const theirs = await seedWorkspace('theirs');

    expect(
      await (
        await import('../src/lib/analytics')
      ).readPostMetrics({
        workspaceId: mine.workspace.id,
        postTargetId: theirs.postTarget.id,
      }),
    ).toBeNull();
  });
});

describe('probing every level', () => {
  it('probes the levels it has a subject for and says why it skipped the rest', async () => {
    const { target } = await seedWorkspace();
    // A Page and a published post exist; no video, no Instagram account.
    routes['/insights'] = () => ({
      data: [{ name: 'post_impressions', period: 'lifetime', values: [{ value: 1 }] }],
    });

    const { probeAllLevels } = await import('../src/lib/analytics');
    const summary = await probeAllLevels(target.id);

    const video = summary.find((row) => row.level === 'video');
    expect(video!.checked).toBe(0);
    expect(video!.skipped).toBeTruthy();

    const post = summary.find((row) => row.level === 'post');
    expect(post!.checked).toBeGreaterThan(0);
  });

  it('records post-level availability against the destination', async () => {
    const { target } = await seedWorkspace();
    routes['/insights'] = () => ({
      data: [{ name: 'post_impressions', period: 'lifetime', values: [{ value: 1 }] }],
    });

    const { probeTarget, readAvailability, readCoverage } = await import('../src/lib/analytics');
    await probeTarget(target.id, 'lifetime', 'post');

    const availability = await readAvailability(target.id);
    const impressions = availability.find((row) => row.metric === 'post_impressions');
    expect(impressions!.available).toBe(true);

    // Everything else in the post catalogue was asked for and did not come
    // back, which is a different fact from never having been asked.
    const coverage = await readCoverage(target.id);
    const post = coverage.find((row) => row.level === 'post');
    expect(post!.available).toBe(1);
    expect(post!.checked).toBe(post!.catalogue);
  });
});

/**
 * The number of rows to read arrives from a query string on one path and from
 * our own code on another, and those want opposite things.
 */
describe('how many comments a read returns', () => {
  async function seedComments(count: number) {
    const seeded = await seedWorkspace();
    await prisma.postComment.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        postTargetId: seeded.postTarget.id,
        remoteId: `bulk-${index}`,
        message: `Comment ${index}`,
        createdTime: new Date(Date.now() - index * 1000),
      })),
    });
    return seeded;
  }

  it('defaults to a screenful', async () => {
    const { workspace } = await seedComments(5);
    expect(await engagement.readComments({ workspaceId: workspace.id })).toHaveLength(5);
  });

  it('lets our own code ask for more than a screenful', async () => {
    // More than the route's ceiling, so a ceiling applied here would show up.
    // The CSV export asks for thousands, and cutting it to a page would be the
    // silent truncation this codebase keeps having to remove.
    const { workspace } = await seedComments(250);

    const rows = await engagement.readComments({ workspaceId: workspace.id, limit: 5000 });
    expect(rows).toHaveLength(250);
  });

  it('reads the newest first, whatever nonsense the number is', async () => {
    const { workspace } = await seedComments(4);

    // Prisma reads a negative take as rows counted backwards, so this used to
    // return the oldest comments under a heading that said latest.
    const rows = await engagement.readComments({ workspaceId: workspace.id, limit: -2 });

    expect(rows[0]?.message).toBe('Comment 0');
    expect(rows).toHaveLength(4);
  });

  it('ignores a number that is not one', async () => {
    const { workspace } = await seedComments(3);
    expect(
      await engagement.readComments({ workspaceId: workspace.id, limit: Number.NaN }),
    ).toHaveLength(3);
  });
});

describe('comment moderation', () => {
  it('hides a comment on Facebook before recording it locally', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();
    await engagement.syncTargetEdges({ targetId: target.id });

    const [comment] = await engagement.readComments({ workspaceId: workspace.id });
    routes['/c1'] = () => ({ success: true });

    expect(
      await engagement.moderateComment({
        commentId: comment!.id,
        workspaceId: workspace.id,
        userId: user.id,
        role: WorkspaceRole.editor,
        hidden: true,
      }),
    ).toBe('ok');

    const after = await prisma.postComment.findUniqueOrThrow({ where: { id: comment!.id } });
    expect(after.isHidden).toBe(true);
  });

  it('leaves the row alone when Facebook refuses the hide', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();
    await engagement.syncTargetEdges({ targetId: target.id });

    const [comment] = await engagement.readComments({ workspaceId: workspace.id });
    denied = ['/c1'];

    await expect(
      engagement.moderateComment({
        commentId: comment!.id,
        workspaceId: workspace.id,
        userId: user.id,
        role: WorkspaceRole.editor,
        hidden: true,
      }),
    ).rejects.toThrow();

    const after = await prisma.postComment.findUniqueOrThrow({ where: { id: comment!.id } });
    // Showing it as hidden here while it is still public on Facebook is the
    // failure mode that gets a page reported.
    expect(after.isHidden).toBe(false);
  });

  it('stores our own reply immediately', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();
    await engagement.syncTargetEdges({ targetId: target.id });

    const [comment] = await engagement.readComments({ workspaceId: workspace.id });
    routes['/c1/comments'] = () => ({ id: 'reply-1' });

    const result = await engagement.replyToCommentAs({
      commentId: comment!.id,
      workspaceId: workspace.id,
      userId: user.id,
      role: WorkspaceRole.editor,
      message: 'Thanks!',
    });

    expect(result.remoteId).toBe('reply-1');
    const reply = await prisma.postComment.findFirst({ where: { remoteId: 'reply-1' } });
    expect(reply?.parentRemoteId).toBe('c1');
  });

  it('will not moderate another workspace’s comment', async () => {
    const mine = await seedWorkspace('mine');
    const theirs = await seedWorkspace('theirs');
    stubEverything();
    await engagement.syncTargetEdges({ targetId: theirs.target.id });

    const [comment] = await engagement.readComments({ workspaceId: theirs.workspace.id });

    expect(
      await engagement.moderateComment({
        commentId: comment!.id,
        workspaceId: mine.workspace.id,
        userId: mine.user.id,
        role: WorkspaceRole.owner,
        hidden: true,
      }),
    ).toBe('not_found');
  });

  it('records who deleted a comment, and what it said', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();
    await engagement.syncTargetEdges({ targetId: target.id });

    const [comment] = await engagement.readComments({ workspaceId: workspace.id });
    routes['/c1'] = () => ({ success: true });

    expect(
      await engagement.removeComment({
        commentId: comment!.id,
        workspaceId: workspace.id,
        userId: user.id,
        role: WorkspaceRole.owner,
      }),
    ).toBe('ok');

    // Facebook keeps nothing once the delete lands, and the local row is gone
    // too, so this entry is the only remaining account of what happened on
    // somebody else's page.
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { workspaceId: workspace.id, action: 'comment.deleted' },
    });
    expect(entry.actorId).toBe(user.id);
    expect(JSON.stringify(entry.detail)).toContain('c1');
  });

  it('records a hide, and the unhide that follows it', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();
    await engagement.syncTargetEdges({ targetId: target.id });

    const [comment] = await engagement.readComments({ workspaceId: workspace.id });
    routes['/c1'] = () => ({ success: true });

    const moderate = (hidden: boolean) =>
      engagement.moderateComment({
        commentId: comment!.id,
        workspaceId: workspace.id,
        userId: user.id,
        role: WorkspaceRole.editor,
        hidden,
      });

    expect(await moderate(true)).toBe('ok');
    expect(await moderate(false)).toBe('ok');

    const actions = await prisma.activityLog.findMany({
      where: { workspaceId: workspace.id, action: { startsWith: 'comment.' } },
      orderBy: { createdAt: 'asc' },
      select: { action: true },
    });
    expect(actions.map((entry) => entry.action)).toEqual(['comment.hidden', 'comment.unhidden']);
  });

  it('refuses a contributor', async () => {
    // Every action here is immediately visible on the client's page.
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();
    await engagement.syncTargetEdges({ targetId: target.id });

    const [comment] = await engagement.readComments({ workspaceId: workspace.id });
    routes['/c1'] = () => ({ success: true });

    expect(
      await engagement.moderateComment({
        commentId: comment!.id,
        workspaceId: workspace.id,
        userId: user.id,
        role: WorkspaceRole.contributor,
        hidden: true,
      }),
    ).toBe('forbidden');

    expect((await prisma.postComment.findUniqueOrThrow({ where: { id: comment!.id } })).isHidden).toBe(
      false,
    );
  });

  it('lets an editor hide but not delete', async () => {
    // Hiding is undone from the same screen. Deleting removes a customer's
    // words from the client's page and nothing brings them back.
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();
    await engagement.syncTargetEdges({ targetId: target.id });

    const [comment] = await engagement.readComments({ workspaceId: workspace.id });
    routes['/c1'] = () => ({ success: true });

    expect(
      await engagement.removeComment({
        commentId: comment!.id,
        workspaceId: workspace.id,
        userId: user.id,
        role: WorkspaceRole.editor,
      }),
    ).toBe('forbidden');
    expect(await prisma.postComment.count()).toBe(1);

    expect(
      await engagement.removeComment({
        commentId: comment!.id,
        workspaceId: workspace.id,
        userId: user.id,
        role: WorkspaceRole.admin,
      }),
    ).toBe('ok');
    expect(await prisma.postComment.count()).toBe(0);
  });

  it('refuses a contributor’s reply', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();
    await engagement.syncTargetEdges({ targetId: target.id });

    const [comment] = await engagement.readComments({ workspaceId: workspace.id });
    routes['/c1/comments'] = () => ({ id: 'reply-1' });

    const result = await engagement.replyToCommentAs({
      commentId: comment!.id,
      workspaceId: workspace.id,
      userId: user.id,
      role: WorkspaceRole.contributor,
      message: 'Thanks!',
    });

    expect(result.outcome).toBe('forbidden');
    expect(await prisma.postComment.count({ where: { remoteId: 'reply-1' } })).toBe(0);
  });
});

describe('reading back is scoped to the workspace', () => {
  it('never returns another workspace’s comments, reviews or threads', async () => {
    const mine = await seedWorkspace('mine');
    const theirs = await seedWorkspace('theirs');
    stubEverything();

    await engagement.syncTargetEdges({ targetId: theirs.target.id });

    expect(await engagement.readComments({ workspaceId: mine.workspace.id })).toEqual([]);
    expect((await engagement.readReviews({ workspaceId: mine.workspace.id })).count).toBe(0);
    expect(await engagement.readConversations({ workspaceId: mine.workspace.id })).toEqual([]);
    expect(await engagement.readVideos({ workspaceId: mine.workspace.id })).toEqual([]);
    expect(await engagement.readExternalPosts({ workspaceId: mine.workspace.id })).toEqual([]);

    expect((await engagement.readComments({ workspaceId: theirs.workspace.id })).length).toBe(1);
  });
});

describe('CSV export', () => {
  /** Split a CSV into rows, respecting quoted fields. */
  async function parse(csv: string): Promise<string[][]> {
    const { parseCsv } = await import('../src/lib/csv');
    return parseCsv(csv);
  }

  const window = (workspaceId: string) => ({
    workspaceId,
    from: new Date('2026-07-01T00:00:00Z'),
    to: new Date('2026-09-01T00:00:00Z'),
  });

  it('gives every captured metric its own column', async () => {
    // The whole point of the export: the UI table shows seven numbers, this
    // has to reach the rest of the catalogue.
    const { workspace, postTarget } = await seedWorkspace();
    routes['/insights'] = () => ({
      data: [
        { name: 'post_impressions', period: 'lifetime', values: [{ value: 900 }] },
        { name: 'post_impressions_viral', period: 'lifetime', values: [{ value: 120 }] },
        { name: 'post_video_views', period: 'lifetime', values: [{ value: 44 }] },
      ],
    });
    routes[`/${postTarget.remotePostId}`] = () => ({ shares: { count: 2 } });

    const { syncPostInsights } = await import('../src/lib/analytics');
    await syncPostInsights(postTarget.id);

    const { postMetricsCsv } = await import('../src/lib/analytics-export');
    const [header, row] = await parse(await postMetricsCsv(window(workspace.id)));

    expect(header).toContain('post_impressions_viral');
    expect(header).toContain('post_video_views');
    expect(row![header!.indexOf('post_impressions')]).toBe('900');
    expect(row![header!.indexOf('post_video_views')]).toBe('44');
  });

  it('quotes post text containing a comma or a newline', async () => {
    const { workspace, post } = await seedWorkspace();
    await prisma.post.update({
      where: { id: post.id },
      data: { message: 'Hello, world\nsecond line' },
    });

    const { postMetricsCsv } = await import('../src/lib/analytics-export');
    const csv = await postMetricsCsv(window(workspace.id));
    const rows = await parse(csv);

    // Round-trips through the reader: a naive join would have split this into
    // two rows and three fields.
    expect(rows).toHaveLength(2);
    expect(rows[1]!).toContain('Hello, world\nsecond line');
  });

  it('keeps a breakdown map as JSON rather than flattening it to a number', async () => {
    const { workspace, postTarget } = await seedWorkspace();
    routes['/insights'] = () => ({
      data: [
        {
          name: 'post_reactions_by_type_total',
          period: 'lifetime',
          values: [{ value: { like: 5, love: 2 } }],
        },
      ],
    });
    routes[`/${postTarget.remotePostId}`] = () => ({ shares: { count: 0 } });

    const { syncPostInsights } = await import('../src/lib/analytics');
    await syncPostInsights(postTarget.id);

    const { postMetricsCsv } = await import('../src/lib/analytics-export');
    const [header, row] = await parse(await postMetricsCsv(window(workspace.id)));

    expect(JSON.parse(row![header!.indexOf('post_reactions_by_type_total')]!)).toEqual({
      like: 5,
      love: 2,
    });
  });

  it('exports the edges and the ad spend', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubEverything();
    await engagement.syncTargetEdges({ targetId: target.id });

    const { buildExport } = await import('../src/lib/analytics-export');

    const comments = await parse(await buildExport('comments', window(workspace.id)));
    expect(comments[1]).toContain('Love this');

    const reviews = await parse(await buildExport('reviews', window(workspace.id)));
    expect(reviews.flat()).toContain('Great service');

    const videos = await parse(await buildExport('videos', window(workspace.id)));
    expect(videos[0]).toContain('total_video_views');

    // No ad account connected: a header and nothing else, not a crash.
    const spend = await parse(await buildExport('ads', window(workspace.id)));
    expect(spend[0]![0]).toBe('date');
    expect(spend).toHaveLength(1);
  });

  it('never exports another workspace’s rows', async () => {
    const mine = await seedWorkspace('mine');
    const theirs = await seedWorkspace('theirs');
    stubEverything();
    await engagement.syncTargetEdges({ targetId: theirs.target.id });

    const { buildExport } = await import('../src/lib/analytics-export');
    const comments = await parse(await buildExport('comments', window(mine.workspace.id)));

    // Header only.
    expect(comments).toHaveLength(1);
  });
});

describe('Instagram', () => {
  function stubInstagram(pageId: string): void {
    routes[`/${pageId}`] = () => ({
      id: pageId,
      instagram_business_account: { id: 'ig-900', username: 'acme' },
    });
    routes['/ig-900'] = () => ({
      id: 'ig-900',
      username: 'acme',
      name: 'Acme',
      followers_count: 4200,
      follows_count: 120,
      media_count: 88,
    });
    routes['/ig-900/media'] = () => ({
      data: [
        {
          id: 'm1',
          caption: 'A photo',
          media_type: 'IMAGE',
          timestamp: '2026-08-01T10:00:00+0000',
          like_count: 40,
          comments_count: 3,
        },
      ],
    });
    routes['/ig-900/insights'] = () => ({
      data: [
        { name: 'reach', period: 'day', values: [{ value: 900, end_time: '2026-08-02T07:00:00+0000' }] },
      ],
    });
    routes['/m1/insights'] = () => ({
      data: [
        { name: 'reach', period: 'lifetime', values: [{ value: 750 }] },
        { name: 'saved', period: 'lifetime', values: [{ value: 12 }] },
      ],
    });
  }

  it('discovers the account behind a Page', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubInstagram(target.providerId);

    const result = await instagram.discoverInstagramAccounts(workspace.id);

    expect(result.found).toBe(1);
    const [account] = await instagram.listInstagramAccounts(workspace.id);
    expect(account!.username).toBe('acme');
    expect(account!.followersCount).toBe(4200);
    expect(account!.linkedPage).toBe(target.name);
  });

  it('does not duplicate an account across repeated discovery', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubInstagram(target.providerId);

    await instagram.discoverInstagramAccounts(workspace.id);
    await instagram.discoverInstagramAccounts(workspace.id);

    expect(await prisma.instagramAccount.count()).toBe(1);
  });

  it('stores account insights and per-media figures', async () => {
    const { workspace, target, user } = await seedWorkspace();
    stubInstagram(target.providerId);
    await instagram.discoverInstagramAccounts(workspace.id);

    const [account] = await instagram.listInstagramAccounts(workspace.id);
    const result = await instagram.syncInstagramAccount({ accountId: account!.id });

    expect(result.error).toBeUndefined();
    expect(result.media).toBe(1);

    const series = await instagram.readInstagramInsights({
      accountId: account!.id,
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-09-01T00:00:00Z'),
    });
    expect(series.some((entry) => entry.metric === 'reach' && entry.total === 900)).toBe(true);

    const [media] = await instagram.readInstagramMedia({ accountId: account!.id });
    expect(media!.reach).toBe(750);
    expect(media!.saved).toBe(12);
  });

  it('skips a Page with no linked account rather than failing', async () => {
    const { workspace, target, user } = await seedWorkspace();
    routes[`/${target.providerId}`] = () => ({ id: target.providerId });

    const result = await instagram.discoverInstagramAccounts(workspace.id);
    expect(result).toEqual({ found: 0, errors: [] });
  });
});

describe('Ads', () => {
  function stubAds(): void {
    routes['/me/adaccounts'] = () => ({
      data: [{ id: 'act_500', name: 'Acme Ads', currency: 'EUR', account_status: 1 }],
    });
    routes['/act_500/insights'] = () => ({
      data: [
        {
          date_start: '2026-08-01',
          date_stop: '2026-08-01',
          account_id: '500',
          campaign_id: 'camp-1',
          campaign_name: 'Summer',
          spend: '100.50',
          impressions: '10000',
          clicks: '250',
          reach: '8000',
          cpc: '0.402',
          ctr: '2.5',
          actions: [{ action_type: 'link_click', value: '200' }],
        },
      ],
    });
  }

  it('discovers ad accounts from the connected user token', async () => {
    const { workspace } = await seedWorkspace();
    stubAds();

    expect(await ads.discoverAdAccounts(workspace.id)).toEqual({ found: 1, errors: [] });

    const [account] = await ads.listAdAccounts(workspace.id);
    expect(account!.actId).toBe('act_500');
    expect(account!.currency).toBe('EUR');
  });

  it('stores daily rows and totals them for the window', async () => {
    const { workspace } = await seedWorkspace();
    stubAds();
    await ads.discoverAdAccounts(workspace.id);

    const [account] = await ads.listAdAccounts(workspace.id);
    const result = await ads.syncAdAccount({ adAccountId: account!.id });

    expect(result.error).toBeUndefined();
    // One row per level: account, campaign, ad set and ad.
    expect(result.rows).toBe(4);

    const summary = await ads.readAdSummary({
      workspaceId: workspace.id,
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-09-01T00:00:00Z'),
    });

    expect(summary.spend).toBe(100.5);
    expect(summary.currency).toBe('EUR');
    // Derived from the totals, not averaged from the daily rates.
    expect(summary.cpc).toBe(0.4);
    expect(summary.actions.link_click).toBe(200);
  });

  it('groups campaign rows and takes the best day for reach', async () => {
    // Reach counts people; summing daily figures would count the same person
    // on every day they saw the ad.
    const { workspace } = await seedWorkspace();
    stubAds();
    await ads.discoverAdAccounts(workspace.id);
    const [account] = await ads.listAdAccounts(workspace.id);

    routes['/act_500/insights'] = () => ({
      data: [
        {
          date_start: '2026-08-01',
          campaign_id: 'camp-1',
          campaign_name: 'Summer',
          account_id: '500',
          spend: '10',
          impressions: '100',
          clicks: '5',
          reach: '90',
        },
        {
          date_start: '2026-08-02',
          campaign_id: 'camp-1',
          campaign_name: 'Summer',
          account_id: '500',
          spend: '20',
          impressions: '200',
          clicks: '5',
          reach: '150',
        },
      ],
    });

    await ads.syncAdAccount({ adAccountId: account!.id });

    const [campaign] = await ads.readCampaigns({
      workspaceId: workspace.id,
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-09-01T00:00:00Z'),
    });

    expect(campaign!.spend).toBe(30);
    expect(campaign!.impressions).toBe(300);
    expect(campaign!.reach).toBe(150);
    expect(campaign!.cpc).toBe(3);
  });

  it('re-syncing the same window does not duplicate rows', async () => {
    const { workspace } = await seedWorkspace();
    stubAds();
    await ads.discoverAdAccounts(workspace.id);
    const [account] = await ads.listAdAccounts(workspace.id);

    await ads.syncAdAccount({ adAccountId: account!.id });
    await ads.syncAdAccount({ adAccountId: account!.id });

    expect(await prisma.adInsight.count()).toBe(4);
  });

  it('breaks spend down by ad set and by ad, not only by campaign', async () => {
    const { workspace } = await seedWorkspace();
    stubAds();
    await ads.discoverAdAccounts(workspace.id);
    const [account] = await ads.listAdAccounts(workspace.id);

    routes['/act_500/insights'] = () => ({
      data: [
        {
          date_start: '2026-08-01',
          account_id: '500',
          campaign_id: 'camp-1',
          campaign_name: 'Summer',
          adset_id: 'set-1',
          adset_name: 'Lookalike 1%',
          ad_id: 'ad-1',
          ad_name: 'Video A',
          spend: '40',
          impressions: '400',
          clicks: '10',
          reach: '350',
        },
      ],
    });

    await ads.syncAdAccount({ adAccountId: account!.id });

    const window = {
      workspaceId: workspace.id,
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-09-01T00:00:00Z'),
    };

    expect((await ads.readCampaigns({ ...window, level: 'adset' }))[0]!.name).toBe('Lookalike 1%');
    expect((await ads.readCampaigns({ ...window, level: 'ad' }))[0]!.name).toBe('Video A');
    // Campaign stays the default, so existing callers are unaffected.
    expect((await ads.readCampaigns(window))[0]!.name).toBe('Summer');
  });

  it('reports the permission error rather than showing zero spend', async () => {
    // "No ad accounts" and "not allowed to see the ad accounts" are different
    // facts, and a silent zero would be read as the first.
    const { workspace } = await seedWorkspace();
    denied = ['/me/adaccounts'];

    const result = await ads.discoverAdAccounts(workspace.id);
    expect(result.found).toBe(0);
    expect(result.errors[0]).toMatch(/permission/i);
  });

  it('never returns another workspace’s spend', async () => {
    const mine = await seedWorkspace('mine');
    const theirs = await seedWorkspace('theirs');
    stubAds();
    await ads.discoverAdAccounts(theirs.workspace.id);
    const [account] = await ads.listAdAccounts(theirs.workspace.id);
    await ads.syncAdAccount({ adAccountId: account!.id });

    const summary = await ads.readAdSummary({
      workspaceId: mine.workspace.id,
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-09-01T00:00:00Z'),
    });

    expect(summary.spend).toBe(0);
    expect(await ads.listAdAccounts(mine.workspace.id)).toEqual([]);
  });
});

/**
 * Replying in the Page inbox.
 *
 * Two rules decide whether a reply is possible at all, and both belong to
 * Facebook rather than to us: a Page may answer only within 24 hours of the
 * person's last message, and only a person can be answered — a thread whose
 * last word is the Page's has no recipient. Getting either wrong means a
 * customer message goes unanswered while the screen says it was sent.
 */
describe('replying to an inbox thread', () => {
  const NOW = new Date('2026-08-02T12:00:00Z');

  async function seedThread(options: {
    lastFrom: 'them' | 'us';
    theirLastAt: Date;
  }) {
    const seed = await seedWorkspace();

    const conversation = await prisma.conversation.create({
      data: {
        targetId: seed.target.id,
        remoteId: 't_1',
        snippet: 'Are you open on Sunday?',
        messageCount: 1,
        participants: ['Ada Byron'],
        updatedTime: options.theirLastAt,
      },
    });

    await prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        remoteId: 'm_them',
        fromName: 'Ada Byron',
        fromId: 'psid-ada',
        message: 'Are you open on Sunday?',
        createdTime: options.theirLastAt,
      },
    });

    if (options.lastFrom === 'us') {
      // Several replies running: the newest inbound message is buried, which
      // is exactly the case a "look at the last few messages" check gets wrong.
      for (let index = 0; index < 3; index += 1) {
        await prisma.conversationMessage.create({
          data: {
            conversationId: conversation.id,
            remoteId: `m_us_${index}`,
            fromName: 'client Page',
            fromId: seed.target.providerId,
            message: 'Yes, ten until four.',
            createdTime: new Date(options.theirLastAt.getTime() + (index + 1) * 60_000),
          },
        });
      }
    }

    return { ...seed, conversation };
  }

  beforeEach(() => {
    routes['/messages'] = () => ({ message_id: 'mid.sent' });
  });

  it('sends the reply and shows it in the thread straight away', async () => {
    const seed = await seedThread({
      lastFrom: 'them',
      theirLastAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });

    const result = await engagement.replyToConversationAs({
      conversationId: seed.conversation.id,
      workspaceId: seed.workspace.id,
      userId: seed.user.id,
      role: WorkspaceRole.owner,
      message: 'Yes — ten until four.',
      now: NOW,
    });

    expect(result.outcome).toBe('ok');

    // Not waiting for the next sync: the thread has to read correctly the
    // moment the request returns, or it looks like the reply was lost.
    const messages = await prisma.conversationMessage.findMany({
      where: { conversationId: seed.conversation.id },
      orderBy: { createdTime: 'desc' },
    });
    expect(messages[0]?.message).toBe('Yes — ten until four.');
    expect(messages[0]?.fromId).toBe(seed.target.providerId);

    const after = await prisma.conversation.findUniqueOrThrow({
      where: { id: seed.conversation.id },
    });
    expect(after.snippet).toBe('Yes — ten until four.');
    expect(after.messageCount).toBe(2);
    expect(after.unreadCount).toBe(0);
  });

  it('addresses the Send API the way Facebook requires', async () => {
    const seed = await seedThread({
      lastFrom: 'them',
      theirLastAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });

    await engagement.replyToConversationAs({
      conversationId: seed.conversation.id,
      workspaceId: seed.workspace.id,
      userId: seed.user.id,
      role: WorkspaceRole.owner,
      message: 'Yes — ten until four.',
      now: NOW,
    });

    const call = received.find((entry) => entry.path.endsWith('/messages'));
    expect(call, 'no send reached Graph').toBeDefined();
    const form = new URLSearchParams(call!.body);

    // The person's page-scoped id, not the thread id: the thread is not an
    // address Facebook will deliver to.
    expect(JSON.parse(form.get('recipient')!)).toEqual({ id: 'psid-ada' });
    expect(JSON.parse(form.get('message')!)).toEqual({ text: 'Yes — ten until four.' });

    // Without RESPONSE this is an unprompted message, which a Page may not send
    // without a message tag — every reply would come back refused.
    expect(form.get('messaging_type')).toBe('RESPONSE');

    // And it went to the Page, signed with the Page's own token.
    expect(call!.path).toContain(seed.target.providerId);
    expect(form.get('access_token')).toBe('page-token');
  });

  it('refuses once Facebook’s 24-hour window has closed', async () => {
    const seed = await seedThread({
      lastFrom: 'them',
      theirLastAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
    });

    const result = await engagement.replyToConversationAs({
      conversationId: seed.conversation.id,
      workspaceId: seed.workspace.id,
      userId: seed.user.id,
      role: WorkspaceRole.owner,
      message: 'Sorry for the delay!',
      now: NOW,
    });

    expect(result.outcome).toBe('outside_window');

    // Refused here, so Graph was never asked and nothing was written.
    const count = await prisma.conversationMessage.count({
      where: { conversationId: seed.conversation.id },
    });
    expect(count).toBe(1);
  });

  it('still finds the recipient behind a run of the page’s own replies', async () => {
    const seed = await seedThread({
      lastFrom: 'us',
      theirLastAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000),
    });

    const result = await engagement.replyToConversationAs({
      conversationId: seed.conversation.id,
      workspaceId: seed.workspace.id,
      userId: seed.user.id,
      role: WorkspaceRole.owner,
      message: 'One more thing —',
      now: NOW,
    });

    expect(result.outcome).toBe('ok');
  });

  it('has nobody to answer in a thread the page started', async () => {
    const seed = await seedWorkspace();
    const conversation = await prisma.conversation.create({
      data: {
        targetId: seed.target.id,
        remoteId: 't_2',
        messageCount: 1,
        updatedTime: NOW,
        messages: {
          create: {
            remoteId: 'm_us',
            fromName: 'client Page',
            fromId: seed.target.providerId,
            message: 'Just checking in',
            createdTime: NOW,
          },
        },
      },
    });

    const result = await engagement.replyToConversationAs({
      conversationId: conversation.id,
      workspaceId: seed.workspace.id,
      userId: seed.user.id,
      role: WorkspaceRole.owner,
      message: 'Hello?',
      now: NOW,
    });

    expect(result.outcome).toBe('no_recipient');
  });

  it('is not open to a contributor', async () => {
    const seed = await seedThread({
      lastFrom: 'them',
      theirLastAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });

    const result = await engagement.replyToConversationAs({
      conversationId: seed.conversation.id,
      workspaceId: seed.workspace.id,
      userId: seed.user.id,
      role: WorkspaceRole.contributor,
      message: 'Speaking for the business',
      now: NOW,
    });

    expect(result.outcome).toBe('forbidden');
  });

  it('cannot reach another client’s inbox', async () => {
    const mine = await seedWorkspace('mine');
    const theirs = await seedThread({
      lastFrom: 'them',
      theirLastAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });

    const result = await engagement.replyToConversationAs({
      conversationId: theirs.conversation.id,
      workspaceId: mine.workspace.id,
      userId: mine.user.id,
      role: WorkspaceRole.owner,
      message: 'Wrong client entirely',
      now: NOW,
    });

    expect(result.outcome).toBe('not_found');
  });

  it('tells the screen which threads can be answered, and until when', async () => {
    const seed = await seedThread({
      lastFrom: 'them',
      theirLastAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    });
    const stale = await prisma.conversation.create({
      data: {
        targetId: seed.target.id,
        remoteId: 't_stale',
        messageCount: 1,
        updatedTime: new Date(NOW.getTime() - 30 * 60 * 60 * 1000),
        messages: {
          create: {
            remoteId: 'm_old',
            fromName: 'Grace',
            fromId: 'psid-grace',
            message: 'Hello?',
            createdTime: new Date(NOW.getTime() - 30 * 60 * 60 * 1000),
          },
        },
      },
    });

    const rows = await engagement.readConversations({
      workspaceId: seed.workspace.id,
      now: NOW,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    const open = byId.get(seed.conversation.id)!.reply;
    expect(open.state).toBe('open');
    // 24 hours after their message, not 24 hours from now.
    if (open.state === 'open') {
      expect(open.until.toISOString()).toBe(
        new Date(NOW.getTime() + 23 * 60 * 60 * 1000).toISOString(),
      );
    }

    expect(byId.get(stale.id)!.reply.state).toBe('closed');
  });
});

/**
 * Finding a comment among many.
 *
 * A Page with a few hundred comments is normal, and moderation is an action
 * rather than a browse: hiding the one somebody complained about means being
 * able to reach it. The screen offered two hundred, newest first, with no
 * search and no way past them — so the reader has to page, and the count it
 * pages against has to be taken over the same criteria as the rows.
 */
describe('searching and paging comments', () => {
  async function seedComments(count: number, prefix = 'Comment') {
    const seed = await seedWorkspace();

    await prisma.postComment.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        postTargetId: seed.postTarget.id,
        remoteId: `c_${index}`,
        fromName: 'Ada',
        message: `${prefix} number ${index}`,
        createdTime: new Date('2026-08-01T10:00:00Z'),
        isHidden: index % 5 === 0,
      })),
    });

    return seed;
  }

  it('counts the same rows it returns', async () => {
    const seed = await seedComments(30);

    const total = await engagement.countComments({ workspaceId: seed.workspace.id });
    const all = await engagement.readComments({ workspaceId: seed.workspace.id, limit: 500 });

    // A count taken over different criteria than the rows gives a pager that
    // offers a page with nothing on it.
    expect(total).toBe(all.length);
  });

  it('agrees with itself when a filter is applied', async () => {
    const seed = await seedComments(30);

    for (const filter of [{ hidden: true }, { hidden: false }, { search: 'number 1' }]) {
      const total = await engagement.countComments({ workspaceId: seed.workspace.id, ...filter });
      const rows = await engagement.readComments({
        workspaceId: seed.workspace.id,
        ...filter,
        limit: 500,
      });
      expect(total, JSON.stringify(filter)).toBe(rows.length);
    }
  });

  it('finds a comment by its words, ignoring case', async () => {
    const seed = await seedWorkspace();
    await prisma.postComment.create({
      data: {
        postTargetId: seed.postTarget.id,
        remoteId: 'c_special',
        fromName: 'Grace',
        message: 'The delivery never ARRIVED',
        createdTime: new Date('2026-08-01T10:00:00Z'),
      },
    });

    const found = await engagement.readComments({
      workspaceId: seed.workspace.id,
      search: 'arrived',
    });

    expect(found).toHaveLength(1);
    expect(found[0]?.message).toContain('never ARRIVED');
  });

  it('walks every comment across pages without repeating one', async () => {
    const seed = await seedComments(25);

    const seen = new Set<string>();
    for (let page = 0; page < 3; page += 1) {
      const rows = await engagement.readComments({
        workspaceId: seed.workspace.id,
        skip: page * 10,
        limit: 10,
      });
      for (const row of rows) seen.add(row.id);
    }

    expect(seen.size).toBe(25);
  });

  it('keeps one client’s comments out of another’s search', async () => {
    const mine = await seedComments(3, 'Mine');
    await seedComments(3, 'Theirs');

    const found = await engagement.readComments({
      workspaceId: mine.workspace.id,
      search: 'Theirs',
    });

    expect(found).toEqual([]);
  });
})

/**
 * The rating summary an agency reports to its client.
 *
 * Four tiles: how many ratings, the average, how many recommend, how many do
 * not. They were computed from the five hundred most recent reviews and
 * labelled as the Page's, so a busy Page was described by its recent half.
 */
describe('the review summary', () => {
  async function seedReviews(
    targetId: string,
    ratings: Array<number | null>,
    recommendation: string | null = null,
  ) {
    await prisma.pageReview.createMany({
      data: ratings.map((rating, index) => ({
        targetId,
        remoteId: `r_${recommendation ?? 'x'}_${index}_${Math.random().toString(36).slice(2)}`,
        rating,
        recommendationType: recommendation,
        createdTime: new Date(2026, 0, 1 + (index % 300)),
      })),
    });
  }

  it('counts and averages every review, not the recent few hundred', async () => {
    const seed = await seedWorkspace();

    // Six hundred ratings, deliberately lopsided: the older four hundred are
    // fives and the newer two hundred are ones, so a summary of "the most
    // recent five hundred" gives a visibly different average from the truth.
    await seedReviews(seed.target.id, Array.from({ length: 400 }, () => 5));
    await seedReviews(seed.target.id, Array.from({ length: 200 }, () => 1));

    const summary = await engagement.readReviews({ workspaceId: seed.workspace.id });

    expect(summary.count).toBe(600);
    // (400×5 + 200×1) / 600 = 3.7
    expect(summary.averageRating).toBe(3.7);
    expect(summary.byRating['5']).toBe(400);
    expect(summary.byRating['1']).toBe(200);
  }, 120_000);

  it('counts a recommendation with no stars as a review, but not in the average', async () => {
    const seed = await seedWorkspace();
    await seedReviews(seed.target.id, [4, 4]);
    await seedReviews(seed.target.id, [null], 'positive');

    const summary = await engagement.readReviews({ workspaceId: seed.workspace.id });

    expect(summary.count).toBe(3);
    expect(summary.averageRating).toBe(4);
    expect(summary.recommends).toBe(1);
  });

  it('tallies recommendations across everything', async () => {
    const seed = await seedWorkspace();
    await seedReviews(seed.target.id, Array.from({ length: 3 }, () => null), 'positive');
    await seedReviews(seed.target.id, Array.from({ length: 2 }, () => null), 'negative');

    const summary = await engagement.readReviews({ workspaceId: seed.workspace.id });

    expect(summary.recommends).toBe(3);
    expect(summary.doesNotRecommend).toBe(2);
  });

  it('shows a handful of recent reviews rather than all of them', async () => {
    const seed = await seedWorkspace();
    await seedReviews(seed.target.id, Array.from({ length: 40 }, () => 5));

    const summary = await engagement.readReviews({ workspaceId: seed.workspace.id });

    expect(summary.count).toBe(40);
    expect(summary.recent).toHaveLength(20);
  });

  it('cannot see another client’s reviews', async () => {
    const mine = await seedWorkspace('mine');
    const theirs = await seedWorkspace('theirs');
    await seedReviews(mine.target.id, [5]);
    await seedReviews(theirs.target.id, [1, 1, 1]);

    const summary = await engagement.readReviews({ workspaceId: mine.workspace.id });

    expect(summary.count).toBe(1);
    expect(summary.averageRating).toBe(5);
  });
})
