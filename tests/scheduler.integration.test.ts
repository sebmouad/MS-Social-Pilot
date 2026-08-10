import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * End-to-end test of the publishing pipeline.
 *
 * A real Postgres database and a stub Graph API, driven through the same
 * `runSchedulerTick` the worker calls. This is the test that would catch the
 * failures that actually matter in a scheduling product: a post silently not
 * going out, going out twice, or a dead token being retried forever.
 */

let server: Server;
let baseUrl: string;
let database: TestDatabase;

/** Requests the stub received, for asserting on what we sent Facebook. */
interface Recorded {
  path: string;
  body: Record<string, string>;
}
let received: Recorded[] = [];

/** Per-path queue of canned responses; falls back to a generic success. */
let responses: Array<{ status: number; body: unknown }> = [];

type Prisma = typeof import('../src/lib/prisma')['prisma'];
type Runner = typeof import('../src/lib/scheduler/runner');

let prisma: Prisma;
let runner: Runner;

beforeAll(async () => {
  // A stub Graph API. It records what it was asked to do and replies with
  // whatever the current test queued up.
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = Object.fromEntries(new URLSearchParams(raw));
      received.push({ path: request.url ?? '', body });

      const next = responses.shift() ?? { status: 200, body: { id: '1000_2000' } };
      response.writeHead(next.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(next.body));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;

  setTestEnv({ FACEBOOK_GRAPH_BASE_URL: baseUrl, SCHEDULER_MAX_ATTEMPTS: '3' });
  database = setupTestDatabase('scheduler');

  // Imported after the environment is set so Prisma picks up DATABASE_URL.
  ({ prisma } = await import('../src/lib/prisma'));
  runner = await import('../src/lib/scheduler/runner');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  database?.drop();
});

/** Build a workspace with one page, and a post due five minutes ago. */
async function seedDuePost(options: { message?: string; link?: string } = {}) {
  const { encryptSecret } = await import('../src/lib/crypto');

  const workspace = await prisma.workspace.create({
    data: { name: 'Test workspace', slug: `test-${randomBytes(4).toString('hex')}`, timezone: 'UTC' },
  });
  const user = await prisma.user.create({
    data: {
      email: `owner-${randomBytes(4).toString('hex')}@example.com`,
      name: 'Owner',
      passwordHash: 'x',
      memberships: { create: { workspaceId: workspace.id, role: 'owner' } },
    },
  });
  const account = await prisma.socialAccount.create({
    data: {
      workspaceId: workspace.id,
      providerUserId: '55555',
      name: 'Test Account',
      accessToken: encryptSecret('user-token'),
    },
  });
  const target = await prisma.target.create({
    data: {
      workspaceId: workspace.id,
      socialAccountId: account.id,
      type: 'page',
      providerId: '1000',
      name: 'Test Page',
      accessToken: encryptSecret('page-token'),
    },
  });
  const post = await prisma.post.create({
    data: {
      workspaceId: workspace.id,
      authorId: user.id,
      message: options.message ?? 'Hello from the scheduler',
      link: options.link ?? null,
      status: 'scheduled',
      publishMode: 'worker',
      scheduledAt: new Date(Date.now() - 5 * 60 * 1000),
      targets: { create: { targetId: target.id, status: 'pending' } },
    },
    include: { targets: true },
  });

  return { workspace, user, account, target, post, postTarget: post.targets[0]! };
}

beforeEach(async () => {
  received = [];
  responses = [];
  // Order matters: children before parents.
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.target.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

describe('runSchedulerTick', () => {
  it('publishes a due post and records the permalink', async () => {
    const { post, postTarget } = await seedDuePost({ link: 'https://example.com/article' });
    responses = [{ status: 200, body: { id: '1000_7777' } }];

    const result = await runner.runSchedulerTick();

    expect(result).toMatchObject({ claimed: 1, published: 1, failed: 0, retrying: 0 });

    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(updated.status).toBe('published');
    expect(updated.remotePostId).toBe('1000_7777');
    expect(updated.remoteUrl).toBe('https://www.facebook.com/1000/posts/7777/');
    expect(updated.publishedAt).not.toBeNull();

    const parent = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(parent.status).toBe('published');
  });

  it('sends the message, link and appsecret_proof to the feed edge', async () => {
    await seedDuePost({ message: 'Launch day', link: 'https://example.com/launch' });
    await runner.runSchedulerTick();

    expect(received).toHaveLength(1);
    const call = received[0]!;
    expect(call.path).toContain('/1000/feed');
    expect(call.body.message).toBe('Launch day');
    expect(call.body.link).toBe('https://example.com/launch');
    expect(call.body.access_token).toBe('page-token');
    // Signed with the app secret, so a stolen token alone is not enough.
    expect(call.body.appsecret_proof).toMatch(/^[a-f0-9]{64}$/);
    // The worker publishes at the due moment; it must not also ask Facebook
    // to hold the post, which would publish it twice over.
    expect(call.body.published).toBeUndefined();
    expect(call.body.scheduled_publish_time).toBeUndefined();
  });

  it('leaves a post that is not due yet alone', async () => {
    const { post } = await seedDuePost();
    await prisma.post.update({
      where: { id: post.id },
      data: { scheduledAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    const result = await runner.runSchedulerTick();
    expect(result.claimed).toBe(0);
    expect(received).toHaveLength(0);
  });

  it('does not publish the same destination twice across ticks', async () => {
    await seedDuePost();

    await runner.runSchedulerTick();
    const second = await runner.runSchedulerTick();

    expect(second.claimed).toBe(0);
    expect(received).toHaveLength(1);
  });

  it('retries a transient failure with a backoff instead of failing', async () => {
    const { postTarget } = await seedDuePost();
    responses = [
      { status: 500, body: { error: { message: 'Service temporarily unavailable', code: 2 } } },
    ];

    const result = await runner.runSchedulerTick();
    expect(result).toMatchObject({ published: 0, failed: 0, retrying: 1 });

    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(updated.status).toBe('pending');
    expect(updated.attempts).toBe(1);
    expect(updated.nextAttemptAt?.getTime()).toBeGreaterThan(Date.now());
    expect(updated.lockedAt).toBeNull();
  });

  it('gives up on a dead token and flags the account for reconnection', async () => {
    const { account, postTarget } = await seedDuePost();
    responses = [
      {
        status: 400,
        body: {
          error: {
            message: 'Error validating access token: the session has been invalidated.',
            code: 190,
            error_subcode: 460,
            type: 'OAuthException',
          },
        },
      },
    ];

    const result = await runner.runSchedulerTick();
    expect(result).toMatchObject({ published: 0, failed: 1, retrying: 0 });

    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(updated.status).toBe('failed');
    expect(updated.errorCode).toBe('190');
    // Never scheduled for another attempt: the token will not heal itself.
    expect(updated.nextAttemptAt).toBeNull();

    const flagged = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(flagged.invalidatedAt).not.toBeNull();
    expect(flagged.invalidReason).toMatch(/session has been invalidated/i);
  });

  it('stops retrying once the attempt ceiling is reached', async () => {
    const { postTarget } = await seedDuePost();

    // SCHEDULER_MAX_ATTEMPTS is 3 for this suite.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      responses = [{ status: 500, body: { error: { message: 'Please retry', code: 2 } } }];
      await prisma.postTarget.update({
        where: { id: postTarget.id },
        data: { nextAttemptAt: null },
      });
      await runner.runSchedulerTick();
    }

    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(updated.attempts).toBe(3);
    expect(updated.status).toBe('failed');
    expect(updated.errorMessage).toMatch(/gave up after 3 attempts/i);
  });

  it('reports a partial failure when one of two destinations fails', async () => {
    const { encryptSecret } = await import('../src/lib/crypto');
    const { workspace, post } = await seedDuePost();

    const account = await prisma.socialAccount.findFirstOrThrow({
      where: { workspaceId: workspace.id },
    });
    const second = await prisma.target.create({
      data: {
        workspaceId: workspace.id,
        socialAccountId: account.id,
        type: 'page',
        providerId: '2000',
        name: 'Second Page',
        accessToken: encryptSecret('page-token-2'),
      },
    });
    await prisma.postTarget.create({ data: { postId: post.id, targetId: second.id, status: 'pending' } });

    responses = [
      { status: 200, body: { id: '1000_1111' } },
      { status: 400, body: { error: { message: 'Duplicate status message', code: 506 } } },
    ];

    // Serial so the queued responses map predictably onto the two destinations.
    const result = await runner.runSchedulerTick({ concurrency: 1 });
    expect(result.claimed).toBe(2);
    expect(result.published + result.failed).toBe(2);

    const parent = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    // One succeeded, one did not — the post must say so rather than claiming
    // it published cleanly or failed entirely.
    expect(parent.status).toBe('partially_failed');
  });

  it('skips destinations that have been turned off', async () => {
    const { target } = await seedDuePost();
    await prisma.target.update({ where: { id: target.id }, data: { enabled: false } });

    const result = await runner.runSchedulerTick();
    expect(result.claimed).toBe(0);
    expect(received).toHaveLength(0);
  });

  it('reclaims a lock abandoned by a crashed worker', async () => {
    const { postTarget } = await seedDuePost();

    await prisma.postTarget.update({
      where: { id: postTarget.id },
      data: {
        status: 'processing',
        lockedAt: new Date(Date.now() - 60 * 60 * 1000),
        lockedBy: 'worker-that-died',
      },
    });

    const result = await runner.runSchedulerTick();
    expect(result.reclaimedStale).toBe(1);
    expect(result.published).toBe(1);
  });

  it('does not reclaim a lock that is still fresh', async () => {
    const { postTarget } = await seedDuePost();

    await prisma.postTarget.update({
      where: { id: postTarget.id },
      data: { status: 'processing', lockedAt: new Date(), lockedBy: 'worker-still-running' },
    });

    const result = await runner.runSchedulerTick();
    expect(result.reclaimedStale).toBe(0);
    expect(result.claimed).toBe(0);
  });
});

describe('publishNow', () => {
  it('publishes a draft immediately, ignoring its scheduled time', async () => {
    const { post, postTarget } = await seedDuePost();
    await prisma.post.update({
      where: { id: post.id },
      data: { status: 'draft', scheduledAt: null },
    });
    responses = [{ status: 200, body: { id: '1000_9999' } }];

    const result = await runner.publishNow(post.id);
    expect(result.published).toBe(1);

    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(updated.status).toBe('published');
    expect(updated.remotePostId).toBe('1000_9999');
  });

  it('clears a pending backoff so a manual retry runs at once', async () => {
    const { post, postTarget } = await seedDuePost();
    await prisma.postTarget.update({
      where: { id: postTarget.id },
      data: { status: 'failed', attempts: 2, nextAttemptAt: new Date(Date.now() + 3 * 60 * 60 * 1000) },
    });

    const result = await runner.publishNow(post.id);
    expect(result.published).toBe(1);
  });
});
