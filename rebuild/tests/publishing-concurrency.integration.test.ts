import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  publish: null as null | ((signal?: AbortSignal) => Promise<{ remoteId: string; url: string | null }>),
  publishCalls: 0,
}));

vi.mock('../src/server/data', () => ({ get prisma() { return integration.prisma; } }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => ({
    'publishing.operationTimeoutMs': 60000,
    'publishing.operationMaxWaitMs': 2000,
    'publishing.transactionTimeoutMs': 15000,
    'publishing.transactionMaxWaitMs': 5000,
    'publishing.maxTargetsPerPost': 100,
    'publishing.maxTargetsPerOperation': 5000,
    'publishing.identifierMaxCharacters': 200,
    'publishing.maxMessageCharacters': 10000,
    'publishing.maxRemoteMediaPerPost': 4,
    'publishing.maxImageAltCharacters': 500,
    'publishing.collab.versionRetention': 50,
    'data.workspaceOperationTimeoutMs': 300000,
    'data.workspaceOperationLockWaitMs': 30000,
  }[key]),
}));
vi.mock('../src/modules/publishing/server/access', () => ({
  authorizePublishing: async (actor: { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] }) => ({
    actor,
    role: 'editor',
    permissions: {},
    entitlements: {},
  }),
}));
vi.mock('../src/server/entitlements', () => ({
  loadEntitlements: async () => ({}),
  hasPlatformCapability: () => true,
}));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
vi.mock('../src/server/platforms/registry', () => ({
  platformFor: async () => ({
    publish: async (request: { signal?: AbortSignal }) => {
      integration.publishCalls += 1;
      if (!integration.publish) throw new Error('No controlled publishing outcome was configured.');
      return integration.publish(request.signal);
    },
    publishingFormats: [{ id:'post',label:'Example format',media:{kinds:[],maxImages:0,maxVideos:0,mixedKinds:false,linkWithMedia:false,imageAltText:false},firstComment:true,remoteStatus:true,remoteDelete:true,scheduling:{application:true,native:false}}],
    supportsTargetKind: () => true,
  }),
}));

import { disconnectSocialAccount } from '../src/server/connection-mutations';
import { cancelScheduledPost, deletePost, publishPost, updatePost } from '../src/server/publishing/lifecycle';

type Fixture = {
  prefix: string;
  workspaceId: string;
  userId: string;
  socialAccountId: string;
  targetId: string;
  postId: string;
  postTargetId: string;
  scheduledAt: Date;
  actor: { userId: string; workspaceId: string; allowedTargetIds: string[] };
};

describe.skipIf(!databaseUrl)('publishing operation concurrency on isolated PostgreSQL', () => {
  let client: PrismaClient;
  let observer: PrismaClient;

  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Publishing concurrency integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    observer = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    integration.prisma = client;
  });

  afterAll(async () => {
    integration.prisma = client;
    await observer?.$disconnect();
    await client?.$disconnect();
  });

  async function createFixture(): Promise<Fixture> {
    const prefix = `preview_publish_concurrency_${randomUUID().replaceAll('-', '')}`;
    const now = new Date();
    const scheduledAt = new Date(now.getTime() - 60_000);
    const fixture: Fixture = {
      prefix,
      workspaceId: `${prefix}_workspace`,
      userId: `${prefix}_user`,
      socialAccountId: `${prefix}_social`,
      targetId: `${prefix}_target`,
      postId: `${prefix}_post`,
      postTargetId: `${prefix}_post_target`,
      scheduledAt,
      actor: { userId: `${prefix}_user`, workspaceId: `${prefix}_workspace`, allowedTargetIds: [`${prefix}_target`] },
    };
    try {
      await client.user.create({ data: { id: fixture.userId, email: `${prefix}@example.test`, name: 'Publishing fixture actor', passwordHash: 'unusable' } });
      await client.workspace.create({ data: { id: fixture.workspaceId, name: 'Publishing concurrency fixture', slug: fixture.workspaceId, timezone: 'UTC' } });
      await client.membership.create({ data: { id: `${prefix}_membership`, userId: fixture.userId, workspaceId: fixture.workspaceId, role: 'owner' } });
      await client.socialAccount.create({ data: {
        id: fixture.socialAccountId, workspaceId: fixture.workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`,
        name: 'Synthetic publishing source', accessToken: 'synthetic-token', scopes: '',
      } });
      await client.target.create({ data: {
        id: fixture.targetId, workspaceId: fixture.workspaceId, socialAccountId: fixture.socialAccountId, type: 'page',
        providerId: `${prefix}_provider_page`, name: 'Synthetic publishing destination', accessToken: 'synthetic-token',
        enabled: true, canPublish: true, createdAt: now,
      } });
      await client.post.create({ data: {
        id: fixture.postId, workspaceId: fixture.workspaceId, authorId: fixture.userId, message: 'Synthetic concurrency post',
        firstComment: null, media: [], status: 'scheduled', scheduledAt, publishedAt: null, createdAt: now, updatedAt: now,
      } });
      await client.postTarget.create({ data: { id: fixture.postTargetId, postId: fixture.postId, targetId: fixture.targetId, status: 'pending' } });
      return fixture;
    } catch (error) {
      await cleanup(fixture);
      throw error;
    }
  }

  async function cleanup(fixture: Fixture) {
    await client.rebuildInboxDeletion.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await client.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId' = ${fixture.workspaceId}`;
    await client.postTarget.deleteMany({ where: { id: fixture.postTargetId } });
    await client.post.deleteMany({ where: { id: fixture.postId } });
    await client.target.deleteMany({ where: { id: fixture.targetId } });
    await client.socialAccount.deleteMany({ where: { id: fixture.socialAccountId } });
    await client.membership.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await client.workspace.deleteMany({ where: { id: fixture.workspaceId } });
    await client.user.deleteMany({ where: { id: fixture.userId } });
  }

  it('keeps publish exclusive against cancellation, editing, and local deletion until the provider result is stored', async () => {
    const fixture = await createFixture();
    let enteredProvider!: () => void;
    let releaseProvider!: () => void;
    const providerEntered = new Promise<void>(resolve => { enteredProvider = resolve; });
    const providerRelease = new Promise<void>(resolve => { releaseProvider = resolve; });
    let publishing: ReturnType<typeof publishPost> | undefined;
    integration.publishCalls = 0;
    integration.publish = async () => {
      enteredProvider();
      await providerRelease;
      return { remoteId: 'synthetic-remote-post', url: 'https://example.test/post' };
    };

    try {
      publishing = publishPost(fixture.actor, fixture.postId, fixture.scheduledAt);
      await providerEntered;
      const concurrent = await Promise.allSettled([
        cancelScheduledPost(fixture.actor, fixture.postId),
        updatePost(fixture.actor, { postId: fixture.postId, message: 'Changed during publishing', firstComment: '', targetIds: [fixture.targetId] }),
        deletePost(fixture.actor, fixture.postId, false),
        disconnectSocialAccount(fixture.actor, fixture.socialAccountId, 'delete', 'DELETE'),
      ]);
      expect(concurrent.map(result => result.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected']);
      for (const result of concurrent) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'conflict' });
      expect(await observer.post.count({ where: { id: fixture.postId } })).toBe(1);
      expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true } })).toEqual({ status: 'processing' });

      releaseProvider();
      await expect(publishing).resolves.toMatchObject({ published: 1, failed: 0, needsReconciliation: 0 });
      expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true } }))
        .toEqual({ status: 'published', remotePostId: 'synthetic-remote-post' });
      expect(await observer.post.findUnique({ where: { id: fixture.postId }, select: { status: true } })).toEqual({ status: 'published' });
      expect(integration.publishCalls).toBe(1);
    } finally {
      releaseProvider();
      await publishing?.catch(() => undefined);
      integration.publish = null;
      await cleanup(fixture);
    }
  });

  it('skips a stale due-schedule candidate after the queue item was cancelled', async () => {
    const fixture = await createFixture();
    integration.publishCalls = 0;
    integration.publish = async () => ({ remoteId: 'unexpected-remote-post', url: null });
    try {
      await expect(cancelScheduledPost(fixture.actor, fixture.postId)).resolves.toBeUndefined();
      await expect(publishPost(fixture.actor, fixture.postId, fixture.scheduledAt))
        .resolves.toMatchObject({ published: 0, failed: 0, needsReconciliation: 0, skipped: true });
      expect(integration.publishCalls).toBe(0);
      expect(await observer.post.findUnique({ where: { id: fixture.postId }, select: { status: true, scheduledAt: true } }))
        .toEqual({ status: 'draft', scheduledAt: null });
      expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true } }))
        .toEqual({ status: 'pending', remotePostId: null });
    } finally {
      integration.publish = null;
      await cleanup(fixture);
    }
  });
  it('keeps post/comment history while an Inbox deletion needs recovery', async () => {
    const fixture = await createFixture();
    try {
      await client.rebuildInboxDeletion.create({ data: { id: `${fixture.prefix}_inbox_intent`, workspaceId: fixture.workspaceId, targetId: fixture.targetId, provider: 'facebook', remoteId: 'fake-remote-comment', localItemId: 'fake-local-comment', actorId: fixture.userId, state: 'started' } });
      await expect(deletePost(fixture.actor, fixture.postId, false)).rejects.toMatchObject({ code: 'conflict' });
      expect(await observer.post.count({ where: { id: fixture.postId } })).toBe(1);
      expect(await observer.postTarget.count({ where: { id: fixture.postTargetId } })).toBe(1);
    } finally { await cleanup(fixture); }
  });

});
