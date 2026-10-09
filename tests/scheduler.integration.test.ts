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

/**
 * Runs while the stub is holding a request open, so a test can change the
 * world underneath a publish that is already in flight.
 */
let duringRequest: (() => Promise<void>) | null = null;

/** Per-path queue of canned responses; falls back to a generic success. */
let responses: Array<{ status: number; body: unknown }> = [];

type Prisma = typeof import('../src/lib/prisma')['prisma'];
type Runner = typeof import('../src/lib/scheduler/runner');

let prisma: Prisma;
let runner: Runner;
let jobs: typeof import('../src/lib/scheduler/jobs');

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
      const hook = duringRequest;
      duringRequest = null;
      void Promise.resolve(hook?.()).then(() => {
        response.writeHead(next.status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(next.body));
      });
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
  jobs = await import('../src/lib/scheduler/jobs');
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
  duringRequest = null;
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

  it('settles a turned-off destination instead of leaving it pending for ever', async () => {
    const { post, postTarget, target } = await seedDuePost();
    await prisma.target.update({ where: { id: target.id }, data: { enabled: false } });

    const result = await runner.runSchedulerTick();
    expect(result.skipped).toBe(1);

    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(updated.status).toBe('skipped');
    expect(updated.errorCode).toBe('destination_off');

    // Not "cancelled": nobody cancelled it. It never went anywhere.
    const parent = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(parent.status).toBe('failed');
  });

  it('publishes to the Pages that are still on, and skips the rest', async () => {
    const { post, workspace, target } = await seedDuePost();
    const off = await prisma.target.create({
      data: {
        workspaceId: workspace.id,
        type: 'page',
        providerId: '3000',
        name: 'Retired Page',
        enabled: false,
      },
    });
    await prisma.postTarget.create({ data: { postId: post.id, targetId: off.id } });

    const result = await runner.runSchedulerTick();
    expect(result.skipped).toBe(1);
    expect(result.published).toBe(1);

    // One destination going quiet must not colour the post as a failure.
    const parent = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(parent.status).toBe('published');
    void target;
  });

  it('leaves a turned-off destination alone until its post is due', async () => {
    const { post, postTarget, target } = await seedDuePost();
    await prisma.post.update({
      where: { id: post.id },
      data: { scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    await prisma.target.update({ where: { id: target.id }, data: { enabled: false } });

    // It may well be switched back on before tomorrow; deciding now would
    // settle the outcome early.
    const result = await runner.runSchedulerTick();
    expect(result.skipped).toBe(0);

    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(updated.status).toBe('pending');
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

  /** Hand a destination to a worker that started `minutesAgo` and never came back. */
  async function seedAbandonedLock(minutesAgo: number, attempts = 0) {
    const seeded = await seedDuePost();
    await prisma.postTarget.update({
      where: { id: seeded.postTarget.id },
      data: {
        status: 'processing',
        attempts,
        lockedAt: new Date(Date.now() - minutesAgo * 60 * 1000),
        lockedBy: 'worker-that-died',
      },
    });
    return seeded;
  }

  it('leaves a slow publish alone until the configured timeout elapses', async () => {
    // Five minutes into a large video upload. The default timeout is fifteen,
    // so nothing should touch it — reclaiming a publish that is still running
    // is how a post goes out twice.
    await seedAbandonedLock(5);

    const result = await runner.runSchedulerTick();
    expect(result.reclaimedStale).toBe(0);
    expect(received).toHaveLength(0);
  });

  it('takes the timeout from the configuration screen', async () => {
    const settings = await import('../src/lib/settings');
    await seedAbandonedLock(5);

    // Same five-minute-old lock as above, but shortened by an operator rather
    // than by the caller. `ensureSettings` is what the worker calls at the top
    // of every loop, so this is the path a real deployment takes.
    await settings.writeSetting('scheduler.staleLockMinutes', 3, null);
    await settings.ensureSettings();
    try {
      const result = await runner.runSchedulerTick();
      expect(result.reclaimedStale).toBe(1);
    } finally {
      await settings.clearSetting('scheduler.staleLockMinutes');
      await settings.ensureSettings();
    }
  });

  it('reclaims that same lock once the timeout is shortened', async () => {
    await seedAbandonedLock(5);

    const result = await runner.runSchedulerTick({ staleLockMinutes: 3 });
    expect(result.reclaimedStale).toBe(1);
    expect(result.published).toBe(1);
  });

  it('counts the interrupted run as an attempt', async () => {
    const { postTarget } = await seedAbandonedLock(60);

    await runner.runSchedulerTick();

    // One for the run that died, one for the retry that succeeded. Without the
    // first, a payload that kills the worker is handed back for ever.
    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(updated.attempts).toBe(2);
    expect(updated.status).toBe('published');
  });

  it('gives up on a destination whose attempts ran out while it was locked', async () => {
    // maxAttempts is 3 in this suite, so the crash that just happened was the
    // third and last go.
    const { post, postTarget } = await seedAbandonedLock(60, 2);

    const result = await runner.runSchedulerTick();
    expect(result.abandonedStale).toBe(1);
    expect(result.reclaimedStale).toBe(0);

    // Crucially it is not retried again in the same breath.
    expect(received).toHaveLength(0);

    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(updated.status).toBe('failed');
    expect(updated.attempts).toBe(3);
    expect(updated.errorCode).toBe('worker_lost');
    expect(updated.lockedBy).toBeNull();

    // And the post stops claiming to be publishing, so someone can see it.
    const parent = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(parent.status).toBe('failed');
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

  it('gives a manual retry its full set of attempts', async () => {
    const { post, postTarget } = await seedDuePost();
    // Failed on its last allowed attempt (SCHEDULER_MAX_ATTEMPTS is 3 here).
    await prisma.postTarget.update({
      where: { id: postTarget.id },
      data: { status: 'failed', attempts: 3, errorCode: '2', errorMessage: 'Gave up after 3 attempts.' },
    });
    responses = [
      { status: 500, body: { error: { message: 'Service temporarily unavailable', code: 2 } } },
    ];

    // Keeping the old count would fail it again on this one transient error.
    const result = await runner.publishNow(post.id);
    expect(result).toMatchObject({ failed: 0, retrying: 1 });

    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(updated.status).toBe('pending');
    expect(updated.attempts).toBe(1);
  });

  it('skips a destination that is turned off instead of publishing to it', async () => {
    const { post, target, postTarget } = await seedDuePost();
    await prisma.target.update({ where: { id: target.id }, data: { enabled: false } });

    const result = await runner.publishNow(post.id);
    expect(result).toMatchObject({ claimed: 0, published: 0, skipped: 1 });
    expect(received).toEqual([]);

    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(updated.status).toBe('skipped');
    expect(updated.errorCode).toBe('destination_off');

    // Settled honestly rather than left reading "publishing".
    const parent = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(parent.status).toBe('failed');
  });
});

/**
 * A link on a post with media. The photos and videos edges have no `link`
 * field and a feed post with attached media ignores it, so unless it goes in
 * the text, the link — and the UTM tags on it — silently disappears.
 */
describe('links on media posts', () => {
  async function seedWithMedia(media: Array<{ id: string; kind: 'image' | 'video'; url: string }>) {
    const seeded = await seedDuePost({ message: 'New menu', link: 'https://example.com/menu' });
    await prisma.post.update({ where: { id: seeded.post.id }, data: { media } });
    return seeded;
  }

  it('puts the link in a single photo caption', async () => {
    await seedWithMedia([{ id: 'm1', kind: 'image', url: 'https://cdn.example.com/a.jpg' }]);
    responses = [{ status: 200, body: { id: '3000', post_id: '1000_3001' } }];

    await runner.runSchedulerTick();

    const call = received[0]!;
    expect(call.path).toContain('/1000/photos');
    expect(call.body.message).toBe('New menu\n\nhttps://example.com/menu');
  });

  it('sends a photo\'s description as its alt text', async () => {
    const seeded = await seedDuePost({ message: 'New menu' });
    await prisma.post.update({
      where: { id: seeded.post.id },
      data: {
        media: [
          { id: 'm1', kind: 'image', url: 'https://cdn.example.com/a.jpg', altText: ' Three loaves on a rack ' },
        ],
      },
    });
    responses = [{ status: 200, body: { id: '3000', post_id: '1000_3001' } }];

    await runner.runSchedulerTick();

    expect(received[0]!.body.alt_text_custom).toBe('Three loaves on a rack');
  });

  it('puts the link in a multi-photo caption', async () => {
    await seedWithMedia([
      { id: 'm1', kind: 'image', url: 'https://cdn.example.com/a.jpg' },
      { id: 'm2', kind: 'image', url: 'https://cdn.example.com/b.jpg' },
    ]);
    responses = [
      { status: 200, body: { id: '3000' } },
      { status: 200, body: { id: '3001' } },
      { status: 200, body: { id: '1000_3002' } },
    ];

    await runner.runSchedulerTick();

    const feed = received.find((call) => call.path.includes('/1000/feed'))!;
    expect(feed.body.message).toBe('New menu\n\nhttps://example.com/menu');
    expect(feed.body).not.toHaveProperty('link');
  });

  it('puts the link in a video description and records a working permalink', async () => {
    const { postTarget } = await seedWithMedia([
      { id: 'm1', kind: 'video', url: 'https://cdn.example.com/clip.mp4' },
    ]);
    responses = [{ status: 200, body: { id: '5555' } }];

    await runner.runSchedulerTick();

    const call = received[0]!;
    expect(call.path).toContain('/1000/videos');
    expect(call.body.description).toBe('New menu\n\nhttps://example.com/menu');

    const updated = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    // A bare video id at the site root is not a page URL.
    expect(updated.remoteUrl).toBe('https://www.facebook.com/1000/videos/5555/');
  });
});

/**
 * Fair sharing between clients.
 *
 * Ordering purely by scheduled time is the obvious implementation and it
 * starves people: one workspace that queues a bulk import for 09:00 fills every
 * slot of every tick until it drains, so another client's single 09:01 post
 * waits behind work that has nothing to do with them. On a shared installation
 * that is one customer delaying another.
 */
describe('fairness between workspaces', () => {
  /** A workspace with one page and `count` posts, all due, oldest first. */
  async function seedBacklog(label: string, count: number, minutesAgo: number) {
    const { encryptSecret } = await import('../src/lib/crypto');
    const suffix = randomBytes(4).toString('hex');

    const workspace = await prisma.workspace.create({
      data: { name: label, slug: `${label}-${suffix}`, timezone: 'UTC' },
    });
    const user = await prisma.user.create({
      data: {
        email: `${label}-${suffix}@example.com`,
        name: 'Owner',
        passwordHash: 'x',
        memberships: { create: { workspaceId: workspace.id, role: 'owner' } },
      },
    });
    const target = await prisma.target.create({
      data: {
        workspaceId: workspace.id,
        type: 'page',
        providerId: `page-${suffix}`,
        name: `${label} Page`,
        accessToken: encryptSecret('page-token'),
      },
    });

    for (let index = 0; index < count; index += 1) {
      await prisma.post.create({
        data: {
          workspaceId: workspace.id,
          authorId: user.id,
          message: `${label} post ${index}`,
          status: 'scheduled',
          publishMode: 'worker',
          // All older than the other workspace's, so a global sort would put
          // every one of them first.
          scheduledAt: new Date(Date.now() - minutesAgo * 60 * 1000 - index * 1000),
          targets: { create: { targetId: target.id, status: 'pending' } },
        },
      });
    }

    return { workspace, target };
  }

  /** Which workspace each claimed destination belongs to. */
  async function claimedWorkspaces(limit: number) {
    const ids = await runner.findDueForTest(new Date(), limit);
    const rows = await prisma.postTarget.findMany({
      where: { id: { in: ids } },
      select: { id: true, post: { select: { workspaceId: true } } },
    });

    // findMany does not preserve the order of `in`, so re-key by id.
    const byId = new Map(rows.map((row) => [row.id, row.post.workspaceId]));
    return ids.map((id) => byId.get(id)!);
  }

  it('does not let one client’s backlog take every slot', async () => {
    const busy = await seedBacklog('busy', 40, 60);
    const quiet = await seedBacklog('quiet', 1, 30);

    const owners = await claimedWorkspaces(10);

    // A global sort by scheduled time would return ten busy-workspace rows and
    // nothing else, because every one of them is older.
    expect(owners).toContain(quiet.workspace.id);
    expect(owners.filter((id) => id === busy.workspace.id).length).toBeLessThan(10);
  });

  it('gives the quiet client its turn on the very first pass', async () => {
    const busy = await seedBacklog('busy', 100, 60);
    const quiet = await seedBacklog('quiet', 1, 1);

    const owners = await claimedWorkspaces(4);

    // Round-robin: one each before anyone gets a second.
    expect(owners[0]).toBe(busy.workspace.id);
    expect(owners[1]).toBe(quiet.workspace.id);
  });

  it('still drains one client’s backlog oldest-first', async () => {
    // Fairness between clients must not reorder work within a client.
    const { workspace } = await seedBacklog('solo', 5, 60);

    const ids = await runner.findDueForTest(new Date(), 5);
    const rows = await prisma.postTarget.findMany({
      where: { id: { in: ids } },
      select: { id: true, post: { select: { scheduledAt: true, workspaceId: true } } },
    });
    const byId = new Map(rows.map((row) => [row.id, row.post.scheduledAt!.getTime()]));
    const times = ids.map((id) => byId.get(id)!);

    expect(rows.every((row) => row.post.workspaceId === workspace.id)).toBe(true);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('shares the slots evenly between two equal backlogs', async () => {
    const first = await seedBacklog('first', 20, 60);
    const second = await seedBacklog('second', 20, 60);

    const owners = await claimedWorkspaces(10);

    expect(owners.filter((id) => id === first.workspace.id)).toHaveLength(5);
    expect(owners.filter((id) => id === second.workspace.id)).toHaveLength(5);
  });

  it('still respects everything the filter is for', async () => {
    // Fairness must not become a way for unapproved or paused work to slip out.
    const { workspace, target } = await seedBacklog('gated', 0, 60);
    const user = await prisma.user.findFirstOrThrow({ where: { memberships: { some: { workspaceId: workspace.id } } } });

    const make = async (data: Record<string, unknown>) =>
      prisma.post.create({
        data: {
          workspaceId: workspace.id,
          authorId: user.id,
          message: 'gated',
          status: 'scheduled',
          publishMode: 'worker',
          scheduledAt: new Date(Date.now() - 60 * 60 * 1000),
          targets: { create: { targetId: target.id, status: 'pending' } },
          ...data,
        },
      });

    await make({ approvalStatus: 'pending' });
    await make({ scheduledAt: new Date(Date.now() + 60 * 60 * 1000) });
    await make({ status: 'draft' });

    expect(await runner.findDueForTest(new Date(), 10)).toEqual([]);

    // And a paused destination is skipped even when the post is ready.
    await prisma.target.update({ where: { id: target.id }, data: { enabled: false } });
    await make({});
    expect(await runner.findDueForTest(new Date(), 10)).toEqual([]);
  });
});

/**
 * Instagram, as a destination like any other.
 *
 * The point of putting Instagram behind the same `Target` row as a Page is
 * that everything above the Graph call — claiming, retrying, per-destination
 * outcomes, the post list — carries on working without knowing the difference.
 * These check that it does, and that the one place the difference *is* real —
 * the container two-step, and a URL instead of an upload — happens.
 */
describe('publishing to Instagram', () => {
  async function seedInstagramPost(options: { media?: unknown[] } = {}) {
    const { encryptSecret } = await import('../src/lib/crypto');
    const suffix = randomBytes(4).toString('hex');

    const workspace = await prisma.workspace.create({
      data: { name: 'Bakery', slug: `ig-${suffix}`, timezone: 'UTC' },
    });
    const user = await prisma.user.create({
      data: {
        email: `ig-${suffix}@example.com`,
        name: 'Owner',
        passwordHash: 'x',
        memberships: { create: { workspaceId: workspace.id, role: 'owner' } },
      },
    });
    const account = await prisma.socialAccount.create({
      data: {
        workspaceId: workspace.id,
        providerUserId: `u-${suffix}`,
        name: 'Owner',
        accessToken: encryptSecret('user-token'),
      },
    });
    const target = await prisma.target.create({
      data: {
        workspaceId: workspace.id,
        socialAccountId: account.id,
        type: 'instagram',
        providerId: `ig-${suffix}`,
        name: '@bakery',
        // The linked Page's token: that is the credential Instagram accepts.
        accessToken: encryptSecret('page-token'),
      },
    });
    const post = await prisma.post.create({
      data: {
        workspaceId: workspace.id,
        authorId: user.id,
        message: 'Sourdough, seven tomorrow',
        status: 'scheduled',
        publishMode: 'worker',
        scheduledAt: new Date(Date.now() - 5 * 60 * 1000),
        media: (options.media ?? [
          { id: 'm1', kind: 'image', url: 'https://cdn.example.test/loaf.jpg' },
        ]) as never,
        targets: { create: { targetId: target.id, status: 'pending' } },
      },
      include: { targets: true },
    });

    return { workspace, target, post, postTarget: post.targets[0]! };
  }

  it('creates a container and publishes it, then records the post like any other', async () => {
    responses = [
      { status: 200, body: { id: 'container_1' } },
      { status: 200, body: { status_code: 'FINISHED' } },
      { status: 200, body: { id: 'ig_media_9' } },
    ];

    const seeded = await seedInstagramPost();
    await runner.runSchedulerTick({ now: new Date() });

    const after = await prisma.postTarget.findUniqueOrThrow({
      where: { id: seeded.postTarget.id },
    });
    expect(after.status).toBe('published');
    expect(after.remotePostId).toBe('ig_media_9');

    // The two-step, in order, against the Instagram user id.
    const posted = received.filter((entry) => entry.body.caption || entry.body.creation_id);
    expect(posted[0]!.path).toContain(`${seeded.target.providerId}/media`);
    expect(posted[0]!.body.image_url).toBe('https://cdn.example.test/loaf.jpg');
    expect(posted[0]!.body.caption).toBe('Sourdough, seven tomorrow');
    expect(posted[1]!.body.creation_id).toBe('container_1');
  });

  it('puts the link in the caption, because an Instagram caption has no link', async () => {
    responses = [
      { status: 200, body: { id: 'container_1' } },
      { status: 200, body: { status_code: 'FINISHED' } },
      { status: 200, body: { id: 'ig_media_10' } },
    ];

    const seeded = await seedInstagramPost();
    await prisma.post.update({
      where: { id: seeded.post.id },
      data: { link: 'https://bakery.example/opening-times' },
    });

    await runner.runSchedulerTick({ now: new Date() });

    const create = received.find((entry) => entry.body.caption)!;
    expect(create.body.caption).toContain('Sourdough, seven tomorrow');
    expect(create.body.caption).toContain('https://bakery.example/opening-times');
  });

  it('fails the destination, not the batch, when Instagram rejects the file', async () => {
    responses = [
      { status: 200, body: { id: 'container_1' } },
      { status: 200, body: { status_code: 'ERROR', status: 'Aspect ratio not supported' } },
    ];

    const seeded = await seedInstagramPost();
    await runner.runSchedulerTick({ now: new Date() });

    const after = await prisma.postTarget.findUniqueOrThrow({
      where: { id: seeded.postTarget.id },
    });

    // A file Instagram will not take is not going to be taken on a retry
    // either, so this is a final failure with the reason kept.
    expect(after.status).toBe('failed');
    expect(after.errorMessage).toContain('Aspect ratio not supported');
    expect(received.some((entry) => entry.body.creation_id)).toBe(false);
  });

  it('refuses a caption with nothing attached, before calling Facebook at all', async () => {
    const seeded = await seedInstagramPost({ media: [] });
    received = [];

    await runner.runSchedulerTick({ now: new Date() });

    const after = await prisma.postTarget.findUniqueOrThrow({
      where: { id: seeded.postTarget.id },
    });
    expect(after.status).toBe('failed');
    expect(after.errorMessage).toMatch(/text-only/i);
    expect(received).toEqual([]);
  });
});

/**
 * The dashboard's headline figures.
 *
 * They sit under a heading that says "totals across published posts", which is
 * a promise: a number that is a partial sum presented as a total is worse than
 * no number, because nothing on screen says to distrust it.
 */
describe('publishedTotals', () => {
  async function seedPublished(count: number, insights: Record<string, number>) {
    const seeded = await seedDuePost();

    await prisma.postTarget.updateMany({
      where: { postId: seeded.post.id },
      data: { status: 'published', insights },
    });

    for (let index = 1; index < count; index += 1) {
      const post = await prisma.post.create({
        data: {
          workspaceId: seeded.workspace.id,
          authorId: seeded.user.id,
          message: `Published ${index}`,
          status: 'published',
          targets: { create: { targetId: seeded.target.id, status: 'published', insights } },
        },
      });
      void post;
    }

    return seeded;
  }

  it('adds up every published destination, not the first few hundred', async () => {
    const analytics = await import('../src/lib/analytics');
    // Past the five hundred the old query fetched. A workspace this size is an
    // agency a year in, which is exactly who reads the dashboard.
    const seeded = await seedPublished(520, { impressions: 10, reach: 4, reactions: 2, comments: 1 });

    const totals = await analytics.publishedTotals(seeded.workspace.id);

    expect(totals.posts).toBe(520);
    expect(totals.impressions).toBe(5_200);
    expect(totals.reach).toBe(2_080);
  }, 120_000);

  it('counts a destination whose insights have never been fetched as zero, not as nothing', async () => {
    const analytics = await import('../src/lib/analytics');
    const seeded = await seedPublished(1, { impressions: 7, reach: 3, reactions: 1, comments: 0 });

    // A post published a minute ago has no insights yet. It must not remove
    // the whole row from the sum, and must not turn the total into null.
    await prisma.post.create({
      data: {
        workspaceId: seeded.workspace.id,
        authorId: seeded.user.id,
        message: 'Just went out',
        status: 'published',
        targets: { create: { targetId: seeded.target.id, status: 'published' } },
      },
    });

    const totals = await analytics.publishedTotals(seeded.workspace.id);

    expect(totals.impressions).toBe(7);
    expect(totals.posts).toBe(2);
  });

  it('ignores destinations that have not gone out', async () => {
    const analytics = await import('../src/lib/analytics');
    const seeded = await seedPublished(1, { impressions: 9, reach: 5, reactions: 0, comments: 0 });

    await prisma.post.create({
      data: {
        workspaceId: seeded.workspace.id,
        authorId: seeded.user.id,
        message: 'Still waiting',
        status: 'scheduled',
        targets: { create: { targetId: seeded.target.id, status: 'pending', insights: { impressions: 999 } } },
      },
    });

    expect((await analytics.publishedTotals(seeded.workspace.id)).impressions).toBe(9);
  });

  it('cannot see another client’s figures', async () => {
    const analytics = await import('../src/lib/analytics');
    const mine = await seedPublished(1, { impressions: 11, reach: 6, reactions: 0, comments: 0 });
    await seedPublished(3, { impressions: 100, reach: 50, reactions: 0, comments: 0 });

    expect((await analytics.publishedTotals(mine.workspace.id)).impressions).toBe(11);
  });

  it('is zero rather than empty for a workspace that has published nothing', async () => {
    const analytics = await import('../src/lib/analytics');
    const seeded = await seedDuePost();

    const totals = await analytics.publishedTotals(seeded.workspace.id);

    expect(totals).toMatchObject({ impressions: 0, reach: 0, reactions: 0, comments: 0, posts: 0 });
  });
})

/**
 * What the *first* worker does when its lock has already been taken away.
 *
 * `staleLockMinutes` exists so a crashed worker does not strand a post for
 * ever, and it necessarily fires sometimes on a worker that is alive — a slow
 * video upload outlasting the timeout is the ordinary case. So a second worker
 * can be publishing the same destination while the first is still talking to
 * Facebook, and then the first one comes back with a result to write.
 *
 * That the post may go out twice is the documented, accepted cost of
 * reclaiming at all. What is not acceptable is the first worker's write
 * landing on a row it no longer owns.
 */
describe('a worker whose lock was reclaimed while it was publishing', () => {
  /** Reclaim the row and hand it to a second worker, as a real tick would. */
  async function stealLock(postTargetId: string, thief: string) {
    await prisma.postTarget.update({
      where: { id: postTargetId },
      data: { status: 'pending', lockedAt: null, lockedBy: null },
    });
    await prisma.postTarget.updateMany({
      where: { id: postTargetId, status: 'pending' },
      data: { status: 'processing', lockedAt: new Date(), lockedBy: thief },
    });
  }

  it('does not overwrite the result of the worker that now owns the row', async () => {
    const { postTarget } = await seedDuePost();
    duringRequest = () => stealLock(postTarget.id, 'worker-b');

    await runner.runSchedulerTick({ workerId: 'worker-a' });

    const after = await prisma.postTarget.findUnique({ where: { id: postTarget.id } });

    // Worker B is still mid-publish. Its claim has to survive: it is the only
    // thing stopping a third worker picking the row up and posting again.
    expect(after?.status).toBe('processing');
    expect(after?.lockedBy).toBe('worker-b');
  });

  it('does not unlock a row a second worker is publishing when it fails', async () => {
    const { postTarget } = await seedDuePost();
    // A retryable failure, so the old code writes `pending` with no lock.
    responses = [
      { status: 500, body: { error: { message: 'Temporary', code: 2, type: 'OAuthException' } } },
    ];
    duringRequest = () => stealLock(postTarget.id, 'worker-b');

    await runner.runSchedulerTick({ workerId: 'worker-a' });

    const after = await prisma.postTarget.findUnique({ where: { id: postTarget.id } });

    // This is the bad one: worker A's failure unlocking the row frees a
    // destination worker B is actively publishing, so a third worker can claim
    // it and send the same post a third time. One stale lock, unbounded posts.
    expect(after?.status).toBe('processing');
    expect(after?.lockedBy).toBe('worker-b');
  });

  it('does not condemn the account on a failure it no longer owns', async () => {
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
    duringRequest = () => stealLock(postTarget.id, 'worker-b');

    await runner.runSchedulerTick({ workerId: 'worker-a' });

    // Marking the connection dead disables every destination on it and emails
    // the client. If the token really is dead, worker B is about to hit the
    // same error on the row it actually owns and will say so. Acting on a
    // result we were not allowed to write risks tearing down a working
    // account on a misclassified error, and gains nothing when we are right.
    const flagged = await prisma.socialAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(flagged.invalidatedAt).toBeNull();
  });
});

/**
 * The headline status a post shows in the UI is *derived*: read every
 * destination, work out one word for the post, write it back. Read and write
 * are separate, so two of these racing can leave the losing snapshot on the
 * row — and nothing recomputes it afterwards, because a refresh only happens
 * when there is publishing activity and by then there is none left.
 *
 * A post stuck this way is not a cosmetic problem. Whichever stale word wins,
 * the post never shows as published; and if the word is `publishing`,
 * `postEditBlocker` refuses to edit it, so it cannot be corrected by hand
 * either.
 *
 * Two workers reaching this at once is the ordinary multi-worker case — they
 * claim different destinations of the same post and both refresh it at the end
 * of their tick.
 */
describe('recomputing a post status while another one is in flight', () => {
  it('reads the destinations only after the refresh ahead of it has finished', async () => {
    const { workspace, post, postTarget } = await seedDuePost();
    // A second destination, because a post only reaches this race when two
    // workers are each holding one of its destinations.
    const otherTarget = await prisma.target.create({
      data: { workspaceId: workspace.id, type: 'page', providerId: '1001', name: 'Other Page' },
    });
    const second = await prisma.postTarget.create({
      data: { postId: post.id, targetId: otherTarget.id, status: 'processing' },
    });
    await prisma.postTarget.update({
      where: { id: postTarget.id },
      data: { status: 'processing' },
    });
    await prisma.post.update({ where: { id: post.id }, data: { status: 'publishing' } });

    // Stand in for the refresh that is already running: hold the lock this one
    // has to wait for, then finish the destinations while it waits.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired!: () => void;
    const locked = new Promise<void>((resolve) => {
      acquired = resolve;
    });

    const holding = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${post.id}))`;
        acquired();
        await held;
      },
      { timeout: 20_000 },
    );
    await locked;

    const refreshing = runner.refreshPostStatus(post.id);

    await prisma.postTarget.updateMany({
      where: { id: { in: [postTarget.id, second.id] } },
      data: { status: 'published', publishedAt: new Date(), lockedAt: null, lockedBy: null },
    });

    release();
    await holding;
    await refreshing;

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });

    // Reading before and writing after leaves the snapshot taken while both
    // destinations were still in flight — `scheduled` — on a post that has
    // already gone out to both, with no later refresh to correct it.
    expect(after.status).toBe('published');
  });
});

/**
 * Catching up with the posts Facebook is holding.
 *
 * Native scheduling hands the post over at creation time and Facebook
 * publishes it later on its own, telling us nothing. Left unasked, a
 * `scheduled_remote` destination stays that way for ever: the post reads
 * "Scheduled" months after it went live, never gets a `publishedAt`, and is
 * invisible to the analytics refresh, which only looks at published rows.
 */
describe('reconciling posts scheduled inside Facebook', () => {
  const now = new Date('2026-09-01T12:00:00Z');
  const logger = () => undefined;


  async function seedHandedOff(overrides: { scheduledFor?: Date } = {}) {
    const seeded = await seedDuePost();
    const { post, postTarget } = seeded;
    const scheduledFor = overrides.scheduledFor ?? new Date('2026-09-01T11:00:00Z');

    await prisma.post.update({
      where: { id: post.id },
      data: { status: 'scheduled', publishMode: 'native', scheduledAt: scheduledFor },
    });
    await prisma.postTarget.update({
      where: { id: postTarget.id },
      data: {
        status: 'scheduled_remote',
        remotePostId: '1000_4242',
        nativeScheduledFor: scheduledFor,
      },
    });

    return seeded;
  }

  it('marks a destination published once Facebook says it went out', async () => {
    const { post, postTarget } = await seedHandedOff();
    responses = [
      { status: 200, body: { id: '1000_4242', is_published: true, created_time: '2026-09-01T11:00:05+0000' } },
    ];

    const summary = await jobs.runNativeReconcile({ now, logger });
    expect(summary).toMatch(/1 published/);

    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(after.status).toBe('published');
    // Facebook's own timestamp, not the moment we happened to ask — otherwise
    // every report puts the post at whenever the worker next ran.
    expect(after.publishedAt?.toISOString()).toBe('2026-09-01T11:00:05.000Z');

    const parent = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(parent.status).toBe('published');
  });

  it('leaves a destination alone while Facebook is still holding it', async () => {
    const { postTarget } = await seedHandedOff();
    responses = [
      { status: 200, body: { id: '1000_4242', is_published: false, created_time: '2026-09-01T10:00:00+0000' } },
    ];

    expect(await jobs.runNativeReconcile({ now, logger })).toBeNull();

    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(after.status).toBe('scheduled_remote');
    expect(after.publishedAt).toBeNull();
  });

  it('does not ask about a post whose moment has not arrived', async () => {
    await seedHandedOff({ scheduledFor: new Date('2026-09-02T09:00:00Z') });
    received = [];

    expect(await jobs.runNativeReconcile({ now, logger })).toBeNull();
    expect(received).toEqual([]);
  });

  it('says so when the post was deleted on Facebook', async () => {
    const { post, postTarget } = await seedHandedOff();
    responses = [
      {
        status: 400,
        body: {
          error: {
            message: 'Unsupported get request. Object does not exist.',
            code: 100,
            type: 'GraphMethodException',
          },
        },
      },
    ];

    const summary = await jobs.runNativeReconcile({ now, logger });
    expect(summary).toMatch(/1 gone from Facebook/);

    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    // Left as `scheduled_remote` it would claim for ever that it is about to
    // go out, when in fact it never will.
    expect(after.status).toBe('failed');
    expect(after.errorCode).toBe('deleted_on_facebook');

    const parent = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(parent.status).toBe('failed');
  });

  it('keeps waiting when Facebook will not say either way', async () => {
    const { postTarget } = await seedHandedOff();
    // No `is_published` in the reply at all. Absent is not "no", and guessing
    // costs a post marked published that never went out.
    responses = [{ status: 200, body: { id: '1000_4242' } }];

    expect(await jobs.runNativeReconcile({ now, logger })).toBeNull();

    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(after.status).toBe('scheduled_remote');
  });

  it('gives up with an explanation once a post has gone unconfirmed for over a week', async () => {
    const { post, postTarget } = await seedHandedOff({ scheduledFor: new Date('2026-08-20T11:00:00Z') });
    responses = [{ status: 200, body: { id: '1000_4242' } }];

    const summary = await jobs.runNativeReconcile({ now, logger });
    expect(summary).toMatch(/1 never confirmed/);

    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: postTarget.id } });
    expect(after.status).toBe('failed');
    expect(after.errorCode).toBe('unconfirmed_on_facebook');

    const parent = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(parent.status).toBe('failed');

    // It most likely went out, so "Post now" must not send a second copy.
    received = [];
    expect((await runner.publishNow(post.id)).claimed).toBe(0);
    expect(received).toEqual([]);
  });

  it('does not let a full batch of unconfirmable rows starve newer ones', async () => {
    const { workspace, user } = await seedHandedOff();
    // A Page with no usable token: none of its rows can ever be checked.
    const tokenless = await prisma.target.create({
      data: { workspaceId: workspace.id, type: 'page', providerId: '2000', name: 'Tokenless Page' },
    });
    for (let index = 0; index < 100; index += 1) {
      await prisma.post.create({
        data: {
          workspaceId: workspace.id,
          authorId: user.id,
          message: `Old ${index}`,
          status: 'scheduled',
          publishMode: 'native',
          scheduledAt: new Date('2026-08-30T11:00:00Z'),
          targets: {
            create: {
              targetId: tokenless.id,
              status: 'scheduled_remote',
              remotePostId: `2000_${index}`,
              nativeScheduledFor: new Date('2026-08-30T11:00:00Z'),
            },
          },
        },
      });
    }
    // The checkable row is the newest, so it was last in line by schedule.
    const checkable = await prisma.postTarget.findFirstOrThrow({ where: { remotePostId: '1000_4242' } });
    await prisma.postTarget.update({ where: { id: checkable.id }, data: { updatedAt: new Date() } });
    responses = [
      { status: 200, body: { id: '1000_4242', is_published: true, created_time: '2026-09-01T11:00:05+0000' } },
    ];

    await jobs.runNativeReconcile({ now, logger });
    await jobs.runNativeReconcile({ now, logger });

    const after = await prisma.postTarget.findUniqueOrThrow({ where: { id: checkable.id } });
    expect(after.status).toBe('published');
  });
});
