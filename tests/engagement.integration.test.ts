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

beforeAll(async () => {
  setTestEnv();

  server = createServer((request, response) => {
    const url = new URL(request.url ?? '', 'http://localhost');

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
    const { workspace, target } = await seedWorkspace();
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
    const { workspace, target } = await seedWorkspace();
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

describe('comment moderation', () => {
  it('hides a comment on Facebook before recording it locally', async () => {
    const { workspace, target } = await seedWorkspace();
    stubEverything();
    await engagement.syncTargetEdges({ targetId: target.id });

    const [comment] = await engagement.readComments({ workspaceId: workspace.id });
    routes['/c1'] = () => ({ success: true });

    expect(
      await engagement.moderateComment({
        commentId: comment!.id,
        workspaceId: workspace.id,
        hidden: true,
      }),
    ).toBe(true);

    const after = await prisma.postComment.findUniqueOrThrow({ where: { id: comment!.id } });
    expect(after.isHidden).toBe(true);
  });

  it('leaves the row alone when Facebook refuses the hide', async () => {
    const { workspace, target } = await seedWorkspace();
    stubEverything();
    await engagement.syncTargetEdges({ targetId: target.id });

    const [comment] = await engagement.readComments({ workspaceId: workspace.id });
    denied = ['/c1'];

    await expect(
      engagement.moderateComment({
        commentId: comment!.id,
        workspaceId: workspace.id,
        hidden: true,
      }),
    ).rejects.toThrow();

    const after = await prisma.postComment.findUniqueOrThrow({ where: { id: comment!.id } });
    // Showing it as hidden here while it is still public on Facebook is the
    // failure mode that gets a page reported.
    expect(after.isHidden).toBe(false);
  });

  it('stores our own reply immediately', async () => {
    const { workspace, target } = await seedWorkspace();
    stubEverything();
    await engagement.syncTargetEdges({ targetId: target.id });

    const [comment] = await engagement.readComments({ workspaceId: workspace.id });
    routes['/c1/comments'] = () => ({ id: 'reply-1' });

    const remoteId = await engagement.replyToCommentAs({
      commentId: comment!.id,
      workspaceId: workspace.id,
      message: 'Thanks!',
    });

    expect(remoteId).toBe('reply-1');
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
        hidden: true,
      }),
    ).toBe(false);
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
    const { workspace, target } = await seedWorkspace();
    stubInstagram(target.providerId);

    const result = await instagram.discoverInstagramAccounts(workspace.id);

    expect(result.found).toBe(1);
    const [account] = await instagram.listInstagramAccounts(workspace.id);
    expect(account!.username).toBe('acme');
    expect(account!.followersCount).toBe(4200);
    expect(account!.linkedPage).toBe(target.name);
  });

  it('does not duplicate an account across repeated discovery', async () => {
    const { workspace, target } = await seedWorkspace();
    stubInstagram(target.providerId);

    await instagram.discoverInstagramAccounts(workspace.id);
    await instagram.discoverInstagramAccounts(workspace.id);

    expect(await prisma.instagramAccount.count()).toBe(1);
  });

  it('stores account insights and per-media figures', async () => {
    const { workspace, target } = await seedWorkspace();
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
    const { workspace, target } = await seedWorkspace();
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
    // One row at account level and one at campaign level.
    expect(result.rows).toBe(2);

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

    expect(await prisma.adInsight.count()).toBe(2);
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
