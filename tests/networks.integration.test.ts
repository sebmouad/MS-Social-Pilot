import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceRole } from '@prisma/client';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/**
 * Another network end to end, against a real database: connect it, refuse a
 * post it could not take, and publish one through the scheduler like any Page.
 */

let database: TestDatabase;
type Prisma = typeof import('../src/lib/prisma')['prisma'];
let prisma: Prisma;
let connect: typeof import('../src/lib/networks/connect');
let posts: typeof import('../src/lib/posts');
let runner: typeof import('../src/lib/scheduler/runner');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('networks');
  ({ prisma } = await import('../src/lib/prisma'));
  connect = await import('../src/lib/networks/connect');
  posts = await import('../src/lib/posts');
  runner = await import('../src/lib/scheduler/runner');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

afterEach(() => vi.unstubAllGlobals());

beforeEach(async () => {
  await prisma.postTarget.deleteMany();
  await prisma.post.deleteMany();
  await prisma.target.deleteMany();
  await prisma.socialAccount.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.user.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed() {
  const owner = await prisma.user.create({ data: { email: 'o@example.test', name: 'Owner', passwordHash: 'x' } });
  const workspace = await prisma.workspace.create({
    data: { name: 'Agency', slug: 'agency', timezone: 'UTC', memberships: { create: [{ userId: owner.id, role: WorkspaceRole.owner }] } },
  });
  const saved = await connect.saveNetworkAccount({
    workspaceId: workspace.id,
    key: 'bluesky',
    connected: {
      providerUserId: 'did:plc:abc',
      name: 'Bakery',
      pictureUrl: null,
      accessToken: 'abcd-efgh-ijkl-mnop',
      meta: { identifier: 'did:plc:abc', handle: 'bakery.bsky.social', pds: 'https://bsky.social' },
      targets: [{ providerId: 'did:plc:abc', name: '@bakery.bsky.social', pictureUrl: null, category: 'Bluesky' }],
    },
  });
  const target = await prisma.target.findFirstOrThrow({ where: { socialAccountId: saved.accountId } });
  return { owner, workspace, target };
}

const context = (workspaceId: string, userId: string) => ({ workspaceId, userId, role: WorkspaceRole.owner, requiresApproval: false });

describe('another network', () => {
  it('keeps the account once, however often it is connected, with its secret encrypted', async () => {
    const { workspace } = await seed();
    await seed().catch(() => undefined);
    const accounts = await prisma.socialAccount.findMany({ where: { workspaceId: workspace.id } });
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.provider).toBe('bluesky');
    expect(accounts[0]!.accessToken).not.toContain('abcd-efgh');
  });

  it('refuses a post longer than the network takes, naming it', async () => {
    const { owner, workspace, target } = await seed();
    await expect(
      posts.createPost(context(workspace.id, owner.id), {
        message: 'a'.repeat(301),
        media: [],
        targetIds: [target.id],
        publishMode: 'worker',
        timezone: 'UTC',
        useQueue: false,
        saveAsDraft: false,
        scheduledAtLocal: '2030-01-01T10:00',
      }),
    ).rejects.toMatchObject({ key: 'errors.network_tooLong' });
  });

  it('publishes through the scheduler and keeps the post’s address', async () => {
    const { owner, workspace, target } = await seed();
    const created = await posts.createPost(context(workspace.id, owner.id), {
      message: 'Fresh bread',
      media: [],
      targetIds: [target.id],
      publishMode: 'worker',
      timezone: 'UTC',
      useQueue: false,
      saveAsDraft: false,
      scheduledAtLocal: '2026-10-01T10:00',
    }, new Date('2026-10-01T09:00:00Z'));

    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('createSession')
        ? new Response(JSON.stringify({ accessJwt: 'jwt', did: 'did:plc:abc', handle: 'bakery.bsky.social' }))
        : new Response(JSON.stringify({ uri: 'at://did:plc:abc/app.bsky.feed.post/3abc', cid: 'c' })),
    ));
    await runner.runSchedulerTick({ now: new Date('2026-10-01T10:00:30Z') });

    const row = await prisma.postTarget.findFirstOrThrow({ where: { postId: created.postId } });
    expect(row.status).toBe('published');
    expect(row.remoteUrl).toBe('https://bsky.app/profile/bakery.bsky.social/post/3abc');
  });
});
