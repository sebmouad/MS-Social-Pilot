import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

/**
 * The Graph edges that are not `/insights`: comments, ratings, conversations,
 * published posts, videos, Instagram and Ads.
 *
 * Two behaviours are worth protecting here. Paging must terminate — a Page with
 * years of comments cannot be allowed to hold a worker job open forever — and
 * every reader must drop rows it cannot key, rather than inventing an id that
 * would duplicate on the next sync.
 */

let server: Server;
/** Every request path the stub saw, for asserting on paging. */
let seen: Array<{ path: string; params: URLSearchParams }> = [];
/** Route handlers by path suffix. */
let routes: Record<string, (params: URLSearchParams) => unknown> = {};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.SESSION_SECRET = 'test';
  process.env.FACEBOOK_APP_ID = '1';
  process.env.FACEBOOK_APP_SECRET = 'secret';

  server = createServer((request, response) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    seen.push({ path: url.pathname, params: url.searchParams });

    const match = Object.keys(routes).find((suffix) => url.pathname.endsWith(suffix));
    if (!match) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Unknown Graph path', code: 100 } }));
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(routes[match]!(url.searchParams)));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  process.env.FACEBOOK_GRAPH_BASE_URL = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
  routes = {};
});

const { graphPaged } = await import('../src/lib/facebook/graph');
const {
  fetchComments,
  fetchConversations,
  fetchPageVideos,
  fetchPublishedPosts,
  fetchReviews,
} = await import('../src/lib/facebook/edges');
const { findInstagramAccount, fetchInstagramMedia } = await import(
  '../src/lib/facebook/instagram'
);
const { actionMap, fetchAdAccounts, fetchAdInsights } = await import('../src/lib/facebook/ads');

describe('graphPaged', () => {
  it('follows the cursor across pages', async () => {
    routes['/thing/items'] = (params) => {
      const after = params.get('after');
      if (!after) {
        return { data: [{ id: '1' }], paging: { cursors: { after: 'p2' }, next: 'http://next' } };
      }
      return { data: [{ id: '2' }] };
    };

    const items = await graphPaged<{ id: string }>('thing/items', {
      accessToken: 'token',
      maxPages: 5,
    });

    expect(items.map((item) => item.id)).toEqual(['1', '2']);
  });

  it('stops at maxPages even when Graph keeps offering another', async () => {
    // The guard that matters: an endless cursor chain must not run forever.
    routes['/thing/items'] = () => ({
      data: [{ id: 'x' }],
      paging: { cursors: { after: 'always' }, next: 'http://next' },
    });

    const items = await graphPaged<{ id: string }>('thing/items', {
      accessToken: 'token',
      maxPages: 3,
    });

    expect(items).toHaveLength(3);
    expect(seen).toHaveLength(3);
  });

  it('stops when there is a cursor but no next link', async () => {
    routes['/thing/items'] = () => ({ data: [{ id: 'x' }], paging: { cursors: { after: 'p2' } } });

    const items = await graphPaged<{ id: string }>('thing/items', {
      accessToken: 'token',
      maxPages: 5,
    });

    expect(items).toHaveLength(1);
  });
});

describe('fetchComments', () => {
  beforeEach(() => {
    routes['/comments'] = () => ({
      data: [
        {
          id: 'c1',
          message: 'Nice one',
          created_time: '2026-08-01T10:00:00+0000',
          like_count: 3,
          comment_count: 1,
          from: { id: 'u1', name: 'Ada' },
        },
        {
          id: 'c2',
          message: 'Thanks!',
          created_time: '2026-08-01T11:00:00+0000',
          parent: { id: 'c1' },
          is_hidden: true,
        },
        // No created_time: unusable, because the sort and the window both
        // depend on it.
        { id: 'c3', message: 'broken' },
      ],
    });
  });

  it('reads top-level comments and replies together', async () => {
    const comments = await fetchComments('100_200', 'token');

    expect(comments.map((comment) => comment.remoteId)).toEqual(['c1', 'c2']);
    expect(comments[1]!.parentRemoteId).toBe('c1');
  });

  it('keeps like and reply counts', async () => {
    const [first] = await fetchComments('100_200', 'token');
    expect(first!.likeCount).toBe(3);
    expect(first!.replyCount).toBe(1);
    expect(first!.fromName).toBe('Ada');
  });

  it('carries the hidden flag through', async () => {
    const comments = await fetchComments('100_200', 'token');
    expect(comments[1]!.isHidden).toBe(true);
    expect(comments[0]!.isHidden).toBe(false);
  });

  it('asks for the flattened stream so replies arrive in one call', async () => {
    await fetchComments('100_200', 'token');
    expect(seen[0]!.params.get('filter')).toBe('stream');
  });
});

describe('fetchReviews', () => {
  it('reads stars and recommendations without conflating them', async () => {
    routes['/ratings'] = () => ({
      data: [
        {
          created_time: '2026-07-01T10:00:00+0000',
          rating: 5,
          review_text: 'Great',
          reviewer: { id: 'u1', name: 'Ada' },
          open_graph_story: { id: 's1' },
        },
        {
          created_time: '2026-07-02T10:00:00+0000',
          recommendation_type: 'positive',
          reviewer: { name: 'Grace' },
          open_graph_story: { id: 's2' },
        },
      ],
    });

    const reviews = await fetchReviews('100', 'token');

    expect(reviews[0]!.rating).toBe(5);
    // "Recommends" is not four stars; it must not be turned into a number.
    expect(reviews[1]!.rating).toBeNull();
    expect(reviews[1]!.recommendationType).toBe('positive');
  });

  it('skips a rating with no story id', async () => {
    // There is no stable id on the rating itself; a synthetic key would
    // duplicate the row on the next sync.
    routes['/ratings'] = () => ({
      data: [{ created_time: '2026-07-01T10:00:00+0000', rating: 4 }],
    });

    expect(await fetchReviews('100', 'token')).toEqual([]);
  });
});

describe('fetchConversations', () => {
  it('reads threads with their recent messages', async () => {
    routes['/conversations'] = () => ({
      data: [
        {
          id: 't1',
          snippet: 'Are you open?',
          unread_count: 2,
          message_count: 5,
          updated_time: '2026-08-02T10:00:00+0000',
          participants: { data: [{ name: 'Ada' }, { name: 'The Page' }] },
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

    const [thread] = await fetchConversations('100', 'token');

    expect(thread!.participants).toEqual(['Ada', 'The Page']);
    expect(thread!.unreadCount).toBe(2);
    expect(thread!.messages).toHaveLength(1);
    expect(thread!.messages[0]!.fromName).toBe('Ada');
  });

  it('falls back to the message count it can see', async () => {
    routes['/conversations'] = () => ({
      data: [
        {
          id: 't1',
          updated_time: '2026-08-02T10:00:00+0000',
          messages: { data: [{ id: 'm1', created_time: '2026-08-02T09:00:00+0000' }] },
        },
      ],
    });

    const [thread] = await fetchConversations('100', 'token');
    expect(thread!.messageCount).toBe(1);
  });
});

describe('fetchPublishedPosts', () => {
  it('uses Facebook’s own story text when a post has no message', async () => {
    routes['/published_posts'] = () => ({
      data: [
        { id: 'p1', message: 'Written by us', created_time: '2026-08-01T10:00:00+0000' },
        { id: 'p2', story: 'The Page shared a link.', created_time: '2026-08-01T11:00:00+0000' },
      ],
    });

    const posts = await fetchPublishedPosts('100', 'token');
    expect(posts[0]!.message).toBe('Written by us');
    expect(posts[1]!.message).toBe('The Page shared a link.');
  });

  it('passes the window through as unix seconds', async () => {
    routes['/published_posts'] = () => ({ data: [] });
    const since = new Date('2026-08-01T00:00:00Z');

    await fetchPublishedPosts('100', 'token', { since });

    expect(seen[0]!.params.get('since')).toBe(String(Math.floor(since.getTime() / 1000)));
  });
});

describe('fetchPageVideos', () => {
  it('asks only for uploaded videos', async () => {
    // A video merely shared onto the Page has no insights of its own.
    routes['/videos'] = () => ({ data: [] });
    await fetchPageVideos('100', 'token');
    expect(seen[0]!.params.get('type')).toBe('uploaded');
  });

  it('reads length and permalink', async () => {
    routes['/videos'] = () => ({
      data: [
        {
          id: 'v1',
          title: 'Launch',
          length: 42.5,
          permalink_url: '/watch/v1',
          created_time: '2026-08-01T10:00:00+0000',
        },
      ],
    });

    const [video] = await fetchPageVideos('100', 'token');
    expect(video!.lengthSeconds).toBe(42.5);
    expect(video!.permalink).toBe('/watch/v1');
  });
});

describe('Instagram discovery', () => {
  it('returns null for a Page with no linked account', async () => {
    // Most Pages have none; that is not an error.
    routes['/100'] = () => ({ id: '100' });
    expect(await findInstagramAccount('100', 'token')).toBeNull();
  });

  it('returns the account when one is linked', async () => {
    routes['/100'] = () => ({
      id: '100',
      instagram_business_account: { id: '900', username: 'acme' },
    });

    expect(await findInstagramAccount('100', 'token')).toEqual({
      igUserId: '900',
      username: 'acme',
    });
  });

  it('skips media with an unusable timestamp', async () => {
    routes['/media'] = () => ({
      data: [
        { id: 'm1', timestamp: '2026-08-01T10:00:00+0000', like_count: 4 },
        { id: 'm2', timestamp: 'not a date' },
      ],
    });

    const media = await fetchInstagramMedia('900', 'token');
    expect(media.map((item) => item.remoteId)).toEqual(['m1']);
    expect(media[0]!.likeCount).toBe(4);
  });
});

describe('Ads insights', () => {
  it('prefixes a bare account id with act_', async () => {
    routes['/me/adaccounts'] = () => ({
      data: [{ account_id: '12345', name: 'Acme', currency: 'EUR' }],
    });

    const [account] = await fetchAdAccounts('token');
    expect(account!.actId).toBe('act_12345');
  });

  it('parses the string numbers Ads Insights returns', async () => {
    routes['/act_1/insights'] = () => ({
      data: [
        {
          date_start: '2026-08-01',
          campaign_id: 'c1',
          campaign_name: 'Summer',
          spend: '123.45',
          impressions: '1000',
          clicks: '25',
          reach: '800',
          cpc: '4.938',
          ctr: '2.5',
          actions: [{ action_type: 'link_click', value: '20' }],
        },
      ],
    });

    const [row] = await fetchAdInsights({
      actId: 'act_1',
      accessToken: 'token',
      level: 'campaign',
      since: new Date('2026-08-01T00:00:00Z'),
      until: new Date('2026-08-07T00:00:00Z'),
    });

    expect(row!.spend).toBe(123.45);
    expect(row!.impressions).toBe(1000);
    expect(row!.objectId).toBe('c1');
    expect(row!.objectName).toBe('Summer');
    expect(row!.actions).not.toBeNull();
  });

  it('asks for daily rows rather than one collapsed total', async () => {
    routes['/act_1/insights'] = () => ({ data: [] });

    await fetchAdInsights({
      actId: 'act_1',
      accessToken: 'token',
      level: 'account',
      since: new Date('2026-08-01T00:00:00Z'),
      until: new Date('2026-08-07T00:00:00Z'),
    });

    expect(seen[0]!.params.get('time_increment')).toBe('1');
    expect(seen[0]!.params.get('time_range')).toBe(
      JSON.stringify({ since: '2026-08-01', until: '2026-08-07' }),
    );
  });

  it('separates action arrays from scalar fields', async () => {
    routes['/act_1/insights'] = () => ({
      data: [
        {
          date_start: '2026-08-01',
          spend: '10',
          objective: 'LINK_CLICKS',
          actions: [{ action_type: 'like', value: '2' }],
        },
      ],
    });

    const [row] = await fetchAdInsights({
      actId: 'act_1',
      accessToken: 'token',
      level: 'account',
      since: new Date('2026-08-01T00:00:00Z'),
      until: new Date('2026-08-02T00:00:00Z'),
    });

    expect(row!.actions).toHaveProperty('actions');
    expect(row!.fields.objective).toBe('LINK_CLICKS');
    expect(row!.fields).not.toHaveProperty('actions');
  });
});

describe('actionMap', () => {
  it('flattens an action array into a map', () => {
    expect(
      actionMap([
        { action_type: 'link_click', value: '20' },
        { action_type: 'post_engagement', value: 35 },
      ]),
    ).toEqual({ link_click: 20, post_engagement: 35 });
  });

  it('ignores entries it cannot read', () => {
    expect(actionMap([{ value: '5' }, { action_type: 'x', value: 'nope' }, null])).toEqual({});
  });

  it('returns an empty map for anything that is not an array', () => {
    expect(actionMap(undefined)).toEqual({});
    expect(actionMap({ action_type: 'x' })).toEqual({});
  });
});
