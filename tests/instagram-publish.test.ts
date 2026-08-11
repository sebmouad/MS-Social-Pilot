import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';

import { setTestEnv } from './helpers/database';

/**
 * Publishing to Instagram: the container two-step, and the rules around it.
 *
 * Worth testing against a stub Graph rather than only as a decision table,
 * because the sequence is the substance. A container published before Facebook
 * has finished fetching the file produces a post with nothing in it, and a
 * carousel parent published before its children are ready produces one that is
 * missing pictures — neither of which Instagram lets anybody fix afterwards.
 */

let server: Server;
let publish: typeof import('../src/lib/facebook/instagram-publish');

/** Every call the stub saw, in order, so the sequence itself can be asserted. */
let calls: Array<{ path: string; method: string; body: Record<string, string> }> = [];
/** Container id → the statuses it reports, one per poll. */
let statuses: Record<string, string[]> = {};
let containerSeq = 0;

beforeAll(async () => {
  setTestEnv();

  server = createServer((request, response) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
      calls.push({ path: url.pathname, method: request.method ?? 'GET', body });

      const reply = (payload: unknown) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      };

      if (url.pathname.endsWith('/media_publish')) return reply({ id: 'ig_post_1' });
      if (url.pathname.endsWith('/media')) {
        containerSeq += 1;
        return reply({ id: `container_${containerSeq}` });
      }

      // A container being polled: hand back the next status it was given.
      const containerId = url.pathname.split('/').pop() ?? '';
      const queue = statuses[containerId];
      const next = queue && queue.length > 1 ? queue.shift()! : (queue?.[0] ?? 'FINISHED');
      return reply({ status_code: next, status: 'Processing note from Facebook' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  process.env.FACEBOOK_GRAPH_BASE_URL = `http://127.0.0.1:${address.port}`;

  publish = await import('../src/lib/facebook/instagram-publish');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  calls = [];
  statuses = {};
  containerSeq = 0;
});

const BASE = {
  igUserId: 'ig_1',
  accessToken: 'page-token',
  caption: 'Fresh out of the oven',
};

/** Never actually sleep; the polling interval is not what is being tested. */
const NO_WAIT = { wait: async () => {} };

describe('what Instagram will take', () => {
  it('refuses a caption with nothing attached', () => {
    // Not a smaller post — Instagram has no text-only post at all, and saying
    // so here is more use than Graph's error, which does not explain it.
    expect(() => publish.planInstagramPublish({ ...BASE, media: [] })).toThrow(
      /no text-only post/i,
    );
  });

  it('refuses a caption past the limit', () => {
    expect(() =>
      publish.planInstagramPublish({
        ...BASE,
        caption: 'x'.repeat(publish.IG_LIMITS.captionLength + 1),
        media: [{ kind: 'image', url: 'https://example.test/a.jpg' }],
      }),
    ).toThrow(/2200 characters/);
  });

  it('refuses more than a carousel holds', () => {
    const media = Array.from({ length: 11 }, (_, index) => ({
      kind: 'image' as const,
      url: `https://example.test/${index}.jpg`,
    }));

    expect(() => publish.planInstagramPublish({ ...BASE, media })).toThrow(/at most 10/);
  });

  it('picks the shape from what is attached', () => {
    const image = { kind: 'image' as const, url: 'https://example.test/a.jpg' };
    const video = { kind: 'video' as const, url: 'https://example.test/a.mp4' };

    expect(publish.planInstagramPublish({ ...BASE, media: [image] })).toEqual({
      strategy: 'image',
    });
    expect(publish.planInstagramPublish({ ...BASE, media: [video] })).toEqual({
      strategy: 'video',
    });
    expect(publish.planInstagramPublish({ ...BASE, media: [image, image, image] })).toEqual({
      strategy: 'carousel',
      count: 3,
    });
  });
});

describe('a single photo', () => {
  it('is created as a container and then published', async () => {
    const result = await publish.publishToInstagram(
      { ...BASE, media: [{ kind: 'image', url: 'https://example.test/a.jpg' }] },
      NO_WAIT,
    );

    expect(result.remotePostId).toBe('ig_post_1');

    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts.map((call) => call.path.split('/').pop())).toEqual(['media', 'media_publish']);

    // The URL, not the bytes: this is the whole reason signed media links exist.
    expect(posts[0]!.body.image_url).toBe('https://example.test/a.jpg');
    expect(posts[0]!.body.caption).toBe('Fresh out of the oven');
    expect(posts[1]!.body.creation_id).toBe('container_1');
  });
});

describe('a video', () => {
  it('goes up as a reel, because plain feed video is no longer accepted', async () => {
    await publish.publishToInstagram(
      { ...BASE, media: [{ kind: 'video', url: 'https://example.test/a.mp4' }] },
      NO_WAIT,
    );

    const create = calls.find((call) => call.method === 'POST')!;
    expect(create.body.media_type).toBe('REELS');
    expect(create.body.video_url).toBe('https://example.test/a.mp4');
  });

  it('waits for Facebook to finish processing before publishing', async () => {
    statuses['container_1'] = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'];

    await publish.publishToInstagram(
      { ...BASE, media: [{ kind: 'video', url: 'https://example.test/a.mp4' }] },
      NO_WAIT,
    );

    const polls = calls.filter((call) => call.method === 'GET');
    expect(polls.length).toBe(3);

    // And the publish came last, not while the file was still being processed.
    expect(calls.at(-1)!.path.endsWith('/media_publish')).toBe(true);
  });

  it('passes on the reason when Facebook rejects the file', async () => {
    statuses['container_1'] = ['ERROR'];

    await expect(
      publish.publishToInstagram(
        { ...BASE, media: [{ kind: 'video', url: 'https://example.test/bad.mp4' }] },
        NO_WAIT,
      ),
    ).rejects.toThrow(/could not process the file/i);

    // Nothing was published on top of the failure.
    expect(calls.some((call) => call.path.endsWith('/media_publish'))).toBe(false);
  });

  it('gives up rather than polling for ever', async () => {
    statuses['container_1'] = ['IN_PROGRESS'];

    await expect(
      publish.publishToInstagram(
        { ...BASE, media: [{ kind: 'video', url: 'https://example.test/slow.mp4' }] },
        { ...NO_WAIT, timeoutMs: 0 },
      ),
    ).rejects.toThrow(/still processing/i);
  });
});

describe('a carousel', () => {
  it('builds every child, waits for each, then publishes one parent', async () => {
    await publish.publishToInstagram(
      {
        ...BASE,
        media: [
          { kind: 'image', url: 'https://example.test/1.jpg' },
          { kind: 'image', url: 'https://example.test/2.jpg' },
        ],
      },
      NO_WAIT,
    );

    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts.length).toBe(4); // two children, one parent, one publish

    expect(posts[0]!.body.is_carousel_item).toBe('true');
    expect(posts[1]!.body.is_carousel_item).toBe('true');

    // The children carry no caption; the parent carries it once.
    expect(posts[0]!.body.caption).toBeUndefined();
    expect(posts[2]!.body.media_type).toBe('CAROUSEL');
    expect(posts[2]!.body.children).toBe('container_1,container_2');
    expect(posts[2]!.body.caption).toBe('Fresh out of the oven');
  });

  it('does not publish a parent whose children are still being fetched', async () => {
    statuses['container_2'] = ['IN_PROGRESS', 'FINISHED'];

    await publish.publishToInstagram(
      {
        ...BASE,
        media: [
          { kind: 'image', url: 'https://example.test/1.jpg' },
          { kind: 'video', url: 'https://example.test/2.mp4' },
        ],
      },
      NO_WAIT,
    );

    // A carousel published early is missing pictures, and Instagram does not
    // let anybody add them afterwards. So the second child was waited on
    // before the parent container was created at all.
    const parentIndex = calls.findIndex((call) => call.body.media_type === 'CAROUSEL');
    const lastChildPoll = calls.reduce(
      (last, call, index) =>
        call.method === 'GET' && call.path.endsWith('container_2') ? index : last,
      -1,
    );

    expect(lastChildPoll).toBeGreaterThan(-1);
    expect(lastChildPoll).toBeLessThan(parentIndex);
  });
});
