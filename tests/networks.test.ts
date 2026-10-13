import { afterEach, describe, expect, it, vi } from 'vitest';

import { networkProblems, xLength } from '../src/lib/network-rules';
import { blueskyFacets, bluesky } from '../src/lib/networks/bluesky';
import { linkedinCommentary } from '../src/lib/networks/linkedin';
import { normaliseInstance, mastodon } from '../src/lib/networks/mastodon';
import { failureFor } from '../src/lib/networks/types';

/** The other networks: their rules, their text quirks, and what goes over the wire. */

afterEach(() => vi.unstubAllGlobals());

const context = (overrides: Partial<{ accessToken: string; meta: Record<string, unknown> }> = {}) => ({
  credentials: { accessToken: 'secret', refreshToken: null, expiresAt: null, meta: {}, ...overrides },
  saveCredentials: vi.fn(async () => undefined),
});

describe('network rules', () => {
  it('count X links as 23 characters', () => {
    expect(xLength('Read https://example.com/a/very/long/path/that/goes/on/and/on')).toBe(5 + 23);
  });

  it('catch a post too long, too many pictures, a video or no picture, per network', () => {
    const long = 'a'.repeat(301);
    const problems = networkProblems(
      [
        { type: 'bluesky', name: '@me' },
        { type: 'page', name: 'Bakery' },
        { type: 'pinterest', name: 'me / Recipes' },
      ],
      { message: long, link: null, media: [{ kind: 'video' }] },
    );
    expect(problems.map((problem) => `${problem.network}:${problem.key}`)).toEqual([
      'bluesky:tooLong',
      'bluesky:noVideo',
      'pinterest:noVideo',
      'pinterest:needsImage',
    ]);
  });

  it('count the link into the text where the network shows no card', () => {
    const post = { message: 'a'.repeat(270), link: 'https://example.com', media: [] };
    expect(networkProblems([{ type: 'x', name: '@me' }], post)).toHaveLength(1);
    expect(networkProblems([{ type: 'bluesky', name: '@me' }], post)).toHaveLength(0);
  });
});

describe('text on each network', () => {
  it('Bluesky: links and hashtags as facets, in UTF-8 bytes', () => {
    const facets = blueskyFacets('Café 🥐 https://example.com #brunch');
    expect(facets).toHaveLength(2);
    const link = facets.find((facet) => facet.features[0]!.$type!.endsWith('#link'))!;
    // "Café " is 6 bytes, the croissant 4, the space 1.
    expect(link.index.byteStart).toBe(11);
    expect(facets.find((facet) => facet.features[0]!.$type!.endsWith('#tag'))!.features[0]!.tag).toBe('brunch');
  });

  it('LinkedIn: markup characters escaped, hashtags as templates', () => {
    expect(linkedinCommentary('Hi (all) @team #News')).toBe('Hi \\(all\\) \\@team {hashtag|\\#|News}');
  });

  it('Mastodon: a server from any way of writing it, never a private address', () => {
    expect(normaliseInstance('mastodon.social')).toBe('https://mastodon.social');
    expect(normaliseInstance('https://Mastodon.Social/@me')).toBe('https://mastodon.social');
    expect(normaliseInstance('@me@piaille.fr')).toBe('https://piaille.fr');
    expect(normaliseInstance('localhost')).toBeNull();
    expect(normaliseInstance('not a server')).toBeNull();
  });
});

describe('failures', () => {
  it('sort into the kinds the scheduler retries or not', () => {
    expect(failureFor(401, 'x', 'Bluesky').kind).toBe('auth');
    expect(failureFor(429, 'x', 'X').kind).toBe('rate_limit');
    expect(failureFor(503, 'x', 'X').kind).toBe('transient');
    expect(failureFor(400, 'x', 'X').kind).toBe('rejected');
  });
});

describe('publishing', () => {
  it('Bluesky: signs in with the app password and creates the post record', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith('createSession')) {
        return new Response(JSON.stringify({ accessJwt: 'jwt', did: 'did:plc:abc', handle: 'me.bsky.social' }));
      }
      return new Response(JSON.stringify({ uri: 'at://did:plc:abc/app.bsky.feed.post/3kxyz', cid: 'c' }));
    }));
    const result = await bluesky.publish(
      { providerId: 'did:plc:abc', name: '@me.bsky.social' },
      { text: 'Hello #world', link: null, media: [], idempotencyKey: 'k' },
      context({ meta: { identifier: 'did:plc:abc' } }),
    );
    expect(result.remoteUrl).toBe('https://bsky.app/profile/me.bsky.social/post/3kxyz');
    expect(calls[0]!.body).toEqual({ identifier: 'did:plc:abc', password: 'secret' });
    expect((calls[1]!.body as { record: { text: string } }).record.text).toBe('Hello #world');
  });

  it('Mastodon: posts to the account’s own server, with an idempotency key and the link in the text', async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ id: '1', url: 'https://piaille.fr/@me/1' }));
    }));
    // The server's address is checked before anything is sent to it.
    vi.doMock('../src/lib/safe-fetch', async (original) => ({ ...(await original<object>()), assertResolvesPublicly: async () => undefined }));
    const { mastodon: fresh } = await import('../src/lib/networks/mastodon');
    const result = await fresh.publish(
      { providerId: '1@piaille.fr', name: '@me@piaille.fr' },
      { text: 'Hello', link: 'https://example.com', media: [], idempotencyKey: 'pt_1' },
      context({ meta: { instance: 'https://piaille.fr' } }),
    );
    expect(result.remoteUrl).toBe('https://piaille.fr/@me/1');
    expect(seen[0]!.url).toBe('https://piaille.fr/api/v1/statuses');
    expect(seen[0]!.headers['idempotency-key']).toBe('pt_1');
    expect((seen[0]!.body as { status: string }).status).toBe('Hello\n\nhttps://example.com');
    vi.doUnmock('../src/lib/safe-fetch');
    expect(mastodon.key).toBe('mastodon');
  });
});

describe('post counters', () => {
  it('Bluesky: reads likes, reposts, replies and quotes from the public AppView', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({ posts: [{ likeCount: 4, repostCount: 2, replyCount: 1, quoteCount: 1 }] }));
    }));
    const stats = await bluesky.stats!('at://did:plc:me/app.bsky.feed.post/1', context());
    expect(stats).toEqual({ likes: 4, reposts: 2, replies: 1, quotes: 1 });
    expect(seen[0]).toBe('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=at%3A%2F%2Fdid%3Aplc%3Ame%2Fapp.bsky.feed.post%2F1');
  });

  it('Mastodon: reads the status from the account’s own server', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ favourites_count: 3, reblogs_count: 1, replies_count: 0 }));
    }));
    vi.doMock('../src/lib/safe-fetch', async (original) => ({ ...(await original<object>()), assertResolvesPublicly: async () => undefined }));
    const { mastodon: fresh } = await import('../src/lib/networks/mastodon');
    const stats = await fresh.stats!('42', context({ meta: { instance: 'https://piaille.fr' } }));
    expect(stats).toEqual({ likes: 3, reposts: 1, replies: 0 });
    expect(seen[0]!.url).toBe('https://piaille.fr/api/v1/statuses/42');
    expect(seen[0]!.headers.authorization).toBe('Bearer secret');
    vi.doUnmock('../src/lib/safe-fetch');
  });

  it('X: reads public metrics with a token still valid', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({ data: { public_metrics: { like_count: 5, retweet_count: 1, reply_count: 2, quote_count: 0, impression_count: 90 } } }));
    }));
    const { x } = await import('../src/lib/networks/x');
    const ctx = context();
    ctx.credentials.expiresAt = new Date(Date.now() + 60 * 60 * 1000) as never;
    expect(await x.stats!('123', ctx)).toEqual({ likes: 5, reposts: 1, replies: 2, quotes: 0, views: 90 });
    expect(seen).toEqual(['https://api.x.com/2/tweets/123?tweet.fields=public_metrics']);
  });

  it('YouTube: reads the video statistics, a hidden like count as null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [{ statistics: { viewCount: '1200', commentCount: '4' } }] }))));
    const { youtube } = await import('../src/lib/networks/youtube');
    const ctx = context();
    ctx.credentials.expiresAt = new Date(Date.now() + 60 * 60 * 1000) as never;
    expect(await youtube.stats!('abc', ctx)).toEqual({ likes: null, reposts: null, replies: 4, views: 1200 });
  });

  it('Bluesky: reads the reply thread, nested replies under their parent', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(url);
      const author = { did: 'did:plc:a', handle: 'a.bsky.social', displayName: 'Alex' };
      return new Response(JSON.stringify({ thread: { post: { uri: 'at://me/1', author }, replies: [
        { post: { uri: 'at://a/2', author, record: { text: 'Nice', createdAt: '2026-10-01T10:00:00Z' }, likeCount: 2, replyCount: 1 },
          replies: [{ post: { uri: 'at://b/3', author: { did: 'did:plc:b', handle: 'b.bsky.social' }, record: { text: 'Agreed', createdAt: '2026-10-01T11:00:00Z' } } }] },
        { blocked: true },
      ] } }));
    }));
    const replies = await bluesky.replies!('at://me/1', context());
    expect(seen[0]).toContain('/xrpc/app.bsky.feed.getPostThread?uri=at%3A%2F%2Fme%2F1');
    expect(replies.map((reply) => [reply.remoteId, reply.parentRemoteId, reply.message, reply.fromName])).toEqual([
      ['at://a/2', null, 'Nice', 'Alex'],
      ['at://b/3', 'at://a/2', 'Agreed', 'b.bsky.social'],
    ]);
    expect(replies[0]!.likeCount).toBe(2);
  });

  it('Mastodon: reads descendants as plain text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ descendants: [
      { id: '50', in_reply_to_id: '42', content: '<p>Hello &amp; welcome</p>', created_at: '2026-10-01T10:00:00Z', account: { id: '7', acct: 'sam@example.social', display_name: '' } },
      { id: '51', in_reply_to_id: '50', content: '<p>Thanks</p>', created_at: '2026-10-01T11:00:00Z', favourites_count: 1, account: { id: '8', acct: 'kim', display_name: 'Kim' } },
    ] }))));
    vi.doMock('../src/lib/safe-fetch', async (original) => ({ ...(await original<object>()), assertResolvesPublicly: async () => undefined }));
    const { mastodon: fresh } = await import('../src/lib/networks/mastodon');
    const replies = await fresh.replies!('42', context({ meta: { instance: 'https://example.social' } }));
    expect(replies.map((reply) => [reply.remoteId, reply.parentRemoteId, reply.message, reply.fromName])).toEqual([
      ['50', null, 'Hello & welcome', 'sam@example.social'],
      ['51', '50', 'Thanks', 'Kim'],
    ]);
    vi.doUnmock('../src/lib/safe-fetch');
  });

  it('store as reactions, comments and shares', async () => {
    const { networkInsights } = await import('../src/lib/analytics');
    const stored = networkInsights({ likes: 4, reposts: 2, replies: 1, quotes: 1 });
    expect(stored).toMatchObject({ reactions: 4, comments: 1, shares: 3, impressions: null, reach: null });
    expect(networkInsights({ likes: 1, reposts: null, replies: 0, views: 50 })).toMatchObject({ impressions: 50, shares: null });
  });
});
