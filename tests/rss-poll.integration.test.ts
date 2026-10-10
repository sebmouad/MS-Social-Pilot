import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalStatus, PostStatus, WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Turning feed entries into posts.
 *
 * The parsing is covered in rss.test.ts; this is the half that writes rows,
 * and the half where a mistake is permanent. An entry recorded as seen but
 * never posted is never retried, and a slot handed out twice puts two posts on
 * a client's Page in the same minute.
 */

let database: TestDatabase;

type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let poll: typeof import('../src/lib/rss/poll');

/** A Thursday. Every queue slot below is 09:00 UTC, so the next is Friday's. */
const now = new Date('2026-10-01T10:00:00Z');
const firstSlot = new Date('2026-10-02T09:00:00Z');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('rss_poll');

  ({ prisma } = await import('../src/lib/prisma'));
  poll = await import('../src/lib/rss/poll');
  // The fetch is stubbed; the address check in front of it still resolves
  // the feed's host, which must not need a network either.
  const safeFetch = await import('../src/lib/safe-fetch');
  safeFetch.setResolverForTests(async () => ['93.184.216.34']);
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS refuse_boom ON posts');
  await prisma.emailLog.deleteMany();
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.feedItem.deleteMany();
  await prisma.feedSource.deleteMany();
  await prisma.queueSlot.deleteMany();
  await prisma.target.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Item {
  guid: string;
  title: string;
}

function rss(items: Item[]): string {
  const body = items
    .map(
      (item, index) => `<item>
        <guid>${item.guid}</guid>
        <title>${item.title}</title>
        <link>https://blog.example.com/${item.guid}</link>
        <pubDate>${new Date(Date.UTC(2026, 8, 1, 0, index)).toUTCString()}</pubDate>
      </item>`,
    )
    .join('\n');
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title>${body}</channel></rss>`;
}

function articles(count: number): Item[] {
  return Array.from({ length: count }, (_, index) => ({ guid: `article-${index}`, title: `Article ${index}` }));
}

/**
 * Serve the feed the way a real server would: 304 when the client's validator
 * still matches, the whole document otherwise.
 */
function serveFeed(items: Item[], etag = '"v1"') {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers['if-none-match'] === etag) return new Response(null, { status: 304 });
    return new Response(rss(items), { status: 200, headers: { etag } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function seed(options: { autoApprove?: boolean; queue?: boolean } = {}) {
  const suffix = randomBytes(3).toString('hex');
  const owner = await prisma.user.create({
    data: { email: `owner-${suffix}@example.com`, name: 'Owner', passwordHash: 'x' },
  });
  const workspace = await prisma.workspace.create({
    data: {
      name: 'Client',
      slug: `client-${suffix}`,
      timezone: 'UTC',
      memberships: { create: { userId: owner.id, role: WorkspaceRole.owner } },
    },
  });
  const target = await prisma.target.create({
    data: { workspaceId: workspace.id, type: 'page', providerId: '1000', name: 'Client Page' },
  });
  if (options.queue) {
    await prisma.queueSlot.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        workspaceId: workspace.id,
        dayOfWeek,
        hour: 9,
        minute: 0,
      })),
    });
  }
  const source = await prisma.feedSource.create({
    data: {
      workspaceId: workspace.id,
      name: 'Company blog',
      url: 'https://blog.example.com/feed.xml',
      targetIds: [target.id],
      autoApprove: options.autoApprove ?? true,
      ingestFrom: new Date('2026-01-01T00:00:00Z'),
    },
  });
  return { owner, workspace, target, source };
}

async function reload(id: string) {
  return prisma.feedSource.findUniqueOrThrow({ where: { id } });
}

describe('an entry whose post cannot be written', () => {
  it('is not recorded as seen, so the next poll tries it again', async () => {
    const { source } = await seed();
    serveFeed([{ guid: 'boom', title: 'boom' }]);

    // A real failure from the database, not a mock: the insert is refused.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION refuse_boom() RETURNS trigger AS $$
      BEGIN
        IF NEW.message LIKE 'boom%' THEN RAISE EXCEPTION 'refused'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER refuse_boom BEFORE INSERT ON posts FOR EACH ROW EXECUTE FUNCTION refuse_boom()',
    );

    const failed = await poll.pollSource(source, { now });
    expect(failed.status).toBe('error');
    expect(await prisma.feedItem.count()).toBe(0);

    await prisma.$executeRawUnsafe('DROP TRIGGER refuse_boom ON posts');

    const retried = await poll.pollSource(await reload(source.id), { now });
    expect(retried).toMatchObject({ status: 'ingested', created: 1 });
    expect(await prisma.post.count({ where: { sourceFeedItemId: { not: null } } })).toBe(1);
  });
});

describe('queue allocation', () => {
  it('waits for a composer holding the workspace lock, and does not take its slot', async () => {
    const { owner, workspace, source, target } = await seed({ queue: true });
    serveFeed([{ guid: 'one', title: 'One' }]);

    // Stand in for `createPost` mid-allocation: it holds the lock and has
    // chosen the next free slot, but has not written its post yet.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const holding = new Promise<void>((resolve) => (locked = resolve));

    const composer = prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspace.id}))`;
        locked();
        await gate;
        await tx.post.create({
          data: {
            workspaceId: workspace.id,
            authorId: owner.id,
            message: 'From the composer',
            status: PostStatus.scheduled,
            publishMode: 'worker',
            scheduledAt: firstSlot,
            timezone: 'UTC',
            // To the feed's own Page: a queue time is taken per Page, so only
            // a post to the same Page stands in the feed's way.
            targets: { create: [{ targetId: target.id }] },
          },
        });
      },
      { timeout: 20_000 },
    );
    await holding;

    let settled = false;
    const polled = poll.pollSource(source, { now }).finally(() => (settled = true));

    // Until the poll either finishes (no lock: the bug) or is seen waiting on
    // the advisory lock (the fix).
    for (let attempt = 0; attempt < 100 && !settled; attempt += 1) {
      const [row] = await prisma.$queryRaw<Array<{ waiting: bigint }>>`
        SELECT count(*) AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
      if (row && row.waiting > 0n) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    release();
    await composer;
    expect(await polled).toMatchObject({ status: 'ingested', created: 1 });

    const fromFeed = await prisma.post.findFirstOrThrow({ where: { sourceFeedItemId: { not: null } } });
    expect(fromFeed.scheduledAt).not.toEqual(firstSlot);
    expect(fromFeed.scheduledAt).toEqual(new Date('2026-10-03T09:00:00Z'));
  });

  it('spreads posts out when there is no queue, rather than stacking them', async () => {
    const { source } = await seed();
    serveFeed(articles(3));

    await poll.pollSource(source, { now });

    const times = (await prisma.post.findMany({ orderBy: { scheduledAt: 'asc' } })).map((post) =>
      post.scheduledAt!.getTime(),
    );
    expect(times).toHaveLength(3);
    expect(new Set(times).size).toBe(3);
    expect(times[0]).toBe(now.getTime() + 60 * 60 * 1000);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index]! - times[index - 1]!).toBeGreaterThanOrEqual(30 * 60 * 1000);
    }
  });
});

describe('fallbackTime', () => {
  it('is an hour out when nothing is booked near then', () => {
    expect(poll.fallbackTime(now, [])).toEqual(new Date(now.getTime() + 60 * 60 * 1000));
  });

  it('steps past bookings close to that hour', () => {
    const hour = now.getTime() + 60 * 60 * 1000;
    const taken = [new Date(hour), new Date(hour + 10 * 60 * 1000)];
    expect(poll.fallbackTime(now, taken)).toEqual(new Date(hour + 60 * 60 * 1000));
  });
});

describe('a feed with more new entries than one poll takes', () => {
  it('does not store its validators until the backlog is through', async () => {
    const { source } = await seed();
    const fetchMock = serveFeed(articles(12));

    const first = await poll.pollSource(source, { now });
    expect(first.created).toBe(10);
    // Stored now, the next request would be told "not modified" and the last
    // two would wait for the blog's next article.
    expect((await reload(source.id)).lastEtag).toBeNull();

    const second = await poll.pollSource(await reload(source.id), { now });
    expect(second).toMatchObject({ status: 'ingested', created: 2 });
    expect((await reload(source.id)).lastEtag).toBe('"v1"');

    const third = await poll.pollSource(await reload(source.id), { now });
    expect(third.status).toBe('unchanged');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('a feed that needs approval', () => {
  it('holds its posts for review and tells the reviewers, once per poll', async () => {
    const { owner, workspace, source } = await seed({ autoApprove: false });
    serveFeed(articles(3));

    await poll.pollSource(source, { now });

    const posts = await prisma.post.findMany();
    expect(posts).toHaveLength(3);
    for (const post of posts) {
      expect(post.status).toBe(PostStatus.pending_approval);
      expect(post.approvalStatus).toBe(ApprovalStatus.pending);
      expect(post.submittedAt).toEqual(now);
    }

    const emails = await prisma.emailLog.findMany({ where: { workspaceId: workspace.id } });
    expect(emails.map((email) => email.to)).toEqual([owner.email]);
    expect(emails[0]!.subject).toContain('Company blog');
  });

  it('sends nothing when the feed publishes without review', async () => {
    const { workspace, source } = await seed();
    serveFeed(articles(2));

    await poll.pollSource(source, { now });
    expect(await prisma.emailLog.count({ where: { workspaceId: workspace.id } })).toBe(0);
  });
});

describe('an entry with nothing to post', () => {
  it('is recorded, so it does not hold a place in every later poll', async () => {
    const { source } = await seed();
    await prisma.feedSource.update({ where: { id: source.id }, data: { messageTemplate: '{{description}}' } });
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item><guid>empty</guid></item></channel></rss>`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(xml, { status: 200 })));

    const result = await poll.pollSource(await reload(source.id), { now });
    expect(result).toMatchObject({ status: 'ingested', created: 0 });
    expect(await prisma.feedItem.count()).toBe(1);
    expect(await prisma.post.count()).toBe(0);
  });
});
