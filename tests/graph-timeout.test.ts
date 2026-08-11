import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';

/**
 * Sending a file is not a request that answers in a moment.
 *
 * One timeout used to cover both, at a minute: generous for a JSON call, short
 * for a video. A 25 MB upload needs better than 3.5 Mbit/s upstream to finish
 * inside that, and when it does not the abort arrives as a network error, is
 * classed transient, and retries until the attempt limit — so the post fails
 * with a message that says nothing about what actually went wrong.
 */

let server: Server;
let baseUrl: string;
/** How long each path should stall before answering. */
const delays = new Map<string, number>();

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.SESSION_SECRET = 'test-session-secret';
  process.env.FACEBOOK_APP_ID = '123';
  process.env.FACEBOOK_APP_SECRET = 'test-app-secret';

  server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? '';
    const delay = [...delays.entries()].find(([key]) => path.endsWith(key))?.[1] ?? 0;

    request.on('data', () => undefined);
    request.on('end', () => {
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id: 'ok' }));
      }, delay);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.FACEBOOK_GRAPH_BASE_URL = baseUrl;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('graph timeouts', () => {
  it('gives an upload longer than an ordinary call', async () => {
    process.env.GRAPH_TIMEOUT_SECONDS = '5';
    process.env.GRAPH_UPLOAD_TIMEOUT_SECONDS = '30';

    const { env } = await import('../src/lib/env');
    expect(env.graphUploadTimeoutMs).toBeGreaterThan(env.graphTimeoutMs);
  });

  it('says which file ran out of time, and how long it had', async () => {
    process.env.GRAPH_UPLOAD_TIMEOUT_SECONDS = '300';
    delays.set('/slow-photo', 60_000);

    const { graphUpload } = await import('../src/lib/facebook/graph');

    // Aborted through the caller's signal rather than by waiting five minutes.
    // Nothing in the app passes one, so in production this branch is only ever
    // reached by the timeout — which is what the message describes.
    const aborted = AbortSignal.abort();

    // "The operation was aborted", five times over, tells nobody anything.
    await expect(
      graphUpload('slow-photo', {
        accessToken: 'token',
        signal: aborted,
        file: {
          data: Buffer.alloc(2 * 1024 * 1024),
          filename: 'holiday.mp4',
          contentType: 'video/mp4',
        },
      }),
    ).rejects.toThrow(/holiday\.mp4 \(2\.0 MB\) did not finish within 300 seconds/);
  });

  it('abandons a call that outlasts the request timeout', async () => {
    // Five seconds is the registry's minimum for this setting, so the stall
    // has to be longer than that rather than as short as the test would like.
    process.env.GRAPH_TIMEOUT_SECONDS = '5';
    delays.set('/slow-json', 8_000);

    const { graphRequest, GraphError } = await import('../src/lib/facebook/graph');

    await expect(
      graphRequest('slow-json', { accessToken: 'token' }),
    ).rejects.toThrow(GraphError);
  }, 20_000);

  it('lets an upload run past the shorter request timeout', async () => {
    // The upload is slower than an ordinary call is allowed to be, which is
    // exactly the case a single shared timeout got wrong.
    process.env.GRAPH_TIMEOUT_SECONDS = '5';
    process.env.GRAPH_UPLOAD_TIMEOUT_SECONDS = '30';
    delays.set('/slow-upload', 8_000);

    const { graphUpload } = await import('../src/lib/facebook/graph');

    const result = await graphUpload<{ id: string }>('slow-upload', {
      accessToken: 'token',
      file: {
        data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        filename: 'photo.png',
        contentType: 'image/png',
      },
    });

    expect(result.id).toBe('ok');
  }, 20_000);
});
