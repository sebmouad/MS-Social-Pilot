import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const workerMocks = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  maxItems: 10,
  maxDelay: 10080,
  send: vi.fn(),
  access: vi.fn(),
}));

vi.mock('../src/server/data', () => ({ get prisma() { return workerMocks.prisma; } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => ({
  'sync.maxItemsPerJob': workerMocks.maxItems,
  'publishing.maxFirstCommentDelayMinutes': workerMocks.maxDelay,
}[key]) }));
vi.mock('../src/modules/publishing/server/first-comment', () => ({ sendDueFirstComment: workerMocks.send }));
vi.mock('../src/server/jobs/access', () => ({ assertWorkspaceJobAccess: workerMocks.access }));

import { runDueFirstComments } from '../src/modules/publishing/server/first-comment-jobs';

type Fixture = { prefix: string; workspaceId: string; userId: string; socialAccountId: string; targetId: string; postId: string; postTargetId: string };

describe.skipIf(!databaseUrl)('due first-comment worker on isolated PostgreSQL', () => {
  let client: PrismaClient;
  let originalCursor: { value: unknown; encrypted: boolean; updatedAt: Date } | null = null;
  const fixtures: Fixture[] = [];
  const cursorKey = 'publishing.firstCommentCursor';

  beforeAll(async () => {
    if (process.env.DATABASE_URL !== databaseUrl) throw new Error('First-comment worker integration requires DATABASE_URL to exactly match REBUILD_PREVIEW_DATABASE_URL.');
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('First-comment worker integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    workerMocks.prisma = client;
    originalCursor = await client.appSetting.findUnique({ where: { key: cursorKey }, select: { value: true, encrypted: true, updatedAt: true } });
  });

  beforeEach(async () => {
    workerMocks.prisma = client;
    workerMocks.maxItems = 10;
    workerMocks.maxDelay = 10080;
    workerMocks.send.mockReset().mockResolvedValue({ state: 'sent' });
    workerMocks.access.mockReset().mockResolvedValue(undefined);
    await setCursor('');
  });

  afterEach(async () => {
    workerMocks.prisma = client;
    for (const f of fixtures.splice(0)) await cleanup(f);
    await setCursor('');
  });

  afterAll(async () => {
    if (!client) return;
    if (originalCursor) await client.appSetting.upsert({ where: { key: cursorKey }, create: { key: cursorKey, ...originalCursor, value: originalCursor.value as Prisma.InputJsonValue }, update: { ...originalCursor, value: originalCursor.value as Prisma.InputJsonValue } });
    else await client.appSetting.deleteMany({ where: { key: cursorKey } });
    await client.$disconnect();
  });

  async function setCursor(value: string) {
    await client.appSetting.upsert({ where: { key: cursorKey }, create: { key: cursorKey, value, encrypted: false, updatedAt: new Date() }, update: { value, encrypted: false, updatedAt: new Date() } });
  }

  async function createFixture(options: { publishedAt?: Date; delay?: number; authorSuffix?: string; firstComment?: string | null; firstCommentId?: string | null; firstCommentAt?: Date | null; firstCommentError?: string | null } = {}): Promise<Fixture> {
    const prefix = `preview_first_comment_${randomUUID().replaceAll('-', '')}`;
    const workspaceId = `${prefix}_workspace`;
    const userId = `${prefix}_${options.authorSuffix ?? 'author'}`;
    const socialAccountId = `${prefix}_social`;
    const targetId = `${prefix}_target`;
    const postId = `${prefix}_post`;
    const postTargetId = `${prefix}_post_target`;
    const now = options.publishedAt ?? new Date('2026-10-19T11:00:00.000Z');
    const f = { prefix, workspaceId, userId, socialAccountId, targetId, postId, postTargetId };
    fixtures.push(f);
    try {
      await client.user.create({ data: { id: userId, email: `${prefix}@example.test`, name: 'Synthetic first-comment author', passwordHash: 'unusable' } });
      await client.workspace.create({ data: { id: workspaceId, name: 'First-comment worker fixture', slug: workspaceId, timezone: 'UTC' } });
      await client.socialAccount.create({ data: { id: socialAccountId, workspaceId, provider: 'synthetic-provider', providerUserId: `${prefix}_provider`, name: 'Synthetic provider connection', accessToken: 'synthetic-token', scopes: '' } });
      await client.target.create({ data: { id: targetId, workspaceId, socialAccountId, type: 'page', providerId: `${prefix}_remote_target`, name: 'Synthetic destination', accessToken: 'synthetic-token', enabled: true, canPublish: true, createdAt: now } });
      await client.post.create({ data: { id: postId, workspaceId, authorId: userId, message: 'Synthetic published post', firstComment: options.firstComment === undefined ? 'Saved comment' : options.firstComment, format: 'post', media: [], status: 'published', publishedAt: now, createdAt: now, updatedAt: now } });
      await client.postTarget.create({ data: { id: postTargetId, postId, targetId, status: 'published', remotePostId: `${prefix}_remote_post`, firstCommentId: options.firstCommentId ?? null, firstCommentAt: options.firstCommentAt ?? null, firstCommentError: options.firstCommentError ?? null, publishedAt: now } });
      await client.$executeRaw`UPDATE posts SET "firstCommentDelayMinutes"=${options.delay ?? 0} WHERE id=${postId} AND "workspaceId"=${workspaceId}`;
      return f;
    } catch (error) {
      await cleanup(f);
      fixtures.splice(fixtures.indexOf(f), 1);
      throw error;
    }
  }

  async function cleanup(f: Fixture) {
    await client.postTarget.deleteMany({ where: { id: f.postTargetId } });
    await client.post.deleteMany({ where: { id: f.postId } });
    await client.target.deleteMany({ where: { id: f.targetId } });
    await client.socialAccount.deleteMany({ where: { id: f.socialAccountId } });
    await client.workspace.deleteMany({ where: { id: f.workspaceId } });
    await client.user.deleteMany({ where: { id: f.userId } });
  }

  it('scans bounded eligible targets and calls the shared service as each original post author', async () => {
    const now = new Date('2026-10-19T12:00:00.000Z');
    const first = await createFixture({ publishedAt: new Date('2026-10-19T11:00:00.000Z'), authorSuffix: 'first-author' });
    const second = await createFixture({ publishedAt: new Date('2026-10-19T11:01:00.000Z'), authorSuffix: 'second-author' });
    await createFixture({ publishedAt: new Date('2026-10-19T11:45:00.000Z'), delay: 30, authorSuffix: 'not-yet-due' });
    await createFixture({ publishedAt: new Date('2026-10-19T11:00:00.000Z'), delay: 10081, authorSuffix: 'over-policy-limit' });
    await createFixture({ publishedAt: new Date('2026-10-19T11:00:00.000Z'), authorSuffix: 'already-sent', firstCommentId: 'remote-comment' });
    workerMocks.maxItems = 1;

    await expect(runDueFirstComments(now)).resolves.toEqual({ examined: 1, sent: 1, held: 0, skipped: 0, failed: 0 });
    expect(workerMocks.send).toHaveBeenCalledTimes(1);
    expect(workerMocks.send).toHaveBeenCalledWith({ userId: first.userId, workspaceId: first.workspaceId }, { postId: first.postId, postTargetId: first.postTargetId }, now);
    expect(workerMocks.access).toHaveBeenCalledWith(first.workspaceId, { provider: 'synthetic-provider', anyFeatureOf: ['publishing/posts'] });
    await expect(runDueFirstComments(now)).resolves.toEqual({ examined: 1, sent: 1, held: 0, skipped: 0, failed: 0 });
    expect(workerMocks.send).toHaveBeenCalledTimes(2);
    expect(workerMocks.send).toHaveBeenLastCalledWith({ userId: second.userId, workspaceId: second.workspaceId }, { postId: second.postId, postTargetId: second.postTargetId }, now);
  });

  it('reports sent, held, skipped, and failures without retrying uncertain records', async () => {
    const base = new Date('2026-10-19T11:00:00.000Z');
    const fixturesForOutcomes = await Promise.all(['sent', 'held', 'skipped', 'failed'].map((suffix, index) => createFixture({ publishedAt: new Date(base.getTime() + index * 1000), authorSuffix: suffix })));
    workerMocks.send.mockImplementation(async (actor: { userId: string }) => {
      if (actor.userId.endsWith('_held')) return { state: 'needs_review' };
      if (actor.userId.endsWith('_skipped')) return { state: 'ready' };
      if (actor.userId.endsWith('_failed')) throw new Error('synthetic shared-service failure');
      return { state: 'sent' };
    });
    await expect(runDueFirstComments(new Date('2026-10-19T12:00:00.000Z'))).resolves.toEqual({ examined: 4, sent: 1, held: 1, skipped: 1, failed: 1 });
    expect(workerMocks.send).toHaveBeenCalledTimes(fixturesForOutcomes.length);
  });
});
