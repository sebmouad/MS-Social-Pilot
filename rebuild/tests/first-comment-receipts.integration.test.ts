import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '../src/lib/operation-error';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  jobAccess: vi.fn(async () => {}),
  adapter: null as unknown as { publish: ReturnType<typeof vi.fn>; publishFirstComment: ReturnType<typeof vi.fn>; classifyPublishingFailure: ReturnType<typeof vi.fn>; supportsTargetKind: ReturnType<typeof vi.fn>; publishingMedia: { kinds: readonly ('image' | 'video')[]; maxImages: number | null; maxVideos: number | null; mixedKinds: boolean; linkWithMedia: boolean; imageAltText: boolean }; publishingFormats: readonly unknown[]; defaultPublishingFormatId: string },
}));

vi.mock('../src/server/jobs/access', () => ({ assertWorkspaceJobAccess: integration.jobAccess }));
vi.mock('../src/server/data', () => ({ get prisma() { return integration.prisma; } }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => ({
    'publishing.operationTimeoutMs': 60000, 'publishing.operationMaxWaitMs': 2000,
    'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000,
    'publishing.maxTargetsPerOperation': 5000, 'publishing.identifierMaxCharacters': 200, 'publishing.maxFirstCommentDelayMinutes': 10080,
    'publishing.maxMessageCharacters': 10000, 'publishing.maxRemoteMediaPerPost': 4,
    'publishing.maxImageAltCharacters': 500, 'data.workspaceOperationTimeoutMs': 300000,
    'data.workspaceOperationLockWaitMs': 30000,
  }[key]),
}));
vi.mock('../src/modules/publishing/server/access', () => ({
  authorizePublishing: async (actor: { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] }) => ({
    actor, role: 'editor', permissions: {}, entitlements: {},
  }),
}));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async () => integration.adapter }));

import { publishPost } from '@/modules/publishing/server/lifecycle';
import { recordFirstCommentOutcome, sendFirstComment } from '../src/modules/publishing/server/first-comment';

type Fixture = {
  prefix: string; workspaceId: string; userId: string; socialAccountId: string; targetId: string;
  postId: string; postTargetId: string; actor: { userId: string; workspaceId: string; allowedTargetIds: string[] };
};

describe.skipIf(!databaseUrl)('first-comment receipt safety on isolated PostgreSQL', () => {
  let client: PrismaClient;
  let observer: PrismaClient;
  const fixtures: Fixture[] = [];

  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('First-comment integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    observer = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    integration.prisma = client;
    resetAdapter();
  });

  afterEach(async () => {
    integration.prisma = client;
    integration.adapter.publish.mockReset();
    integration.adapter.publishFirstComment.mockReset();
    integration.adapter.classifyPublishingFailure.mockReset();
    integration.adapter.supportsTargetKind.mockReset().mockReturnValue(true);
    for (const fixture of fixtures.splice(0)) await cleanup(fixture);
  });

  beforeEach(() => { integration.jobAccess.mockReset().mockResolvedValue(undefined); resetAdapter(); });

  afterAll(async () => {
    integration.prisma = client;
    await observer?.$disconnect();
    await client?.$disconnect();
  });

  function resetAdapter() {
    integration.adapter = {
      publish: vi.fn(async () => ({ state: 'published', remoteId: 'provider-post', url: null })),
      publishFirstComment: vi.fn(async () => ({ remoteId: 'provider-comment' })),
      classifyPublishingFailure: vi.fn(() => 'uncertain'),
      supportsTargetKind: vi.fn(() => true),
      publishingMedia: { kinds: ['image', 'video'], maxImages: 4, maxVideos: 4, mixedKinds: true, linkWithMedia: true, imageAltText: true },
      publishingFormats: [{ id: 'post', label: 'Post', media: { kinds: ['image', 'video'], maxImages: 4, maxVideos: 4, mixedKinds: true, linkWithMedia: true, imageAltText: true }, firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } }],
      defaultPublishingFormatId: 'post',
    };
  }

  async function createFixture(options: { published?: boolean; withComment?: boolean } = {}): Promise<Fixture> {
    const prefix = `preview_first_comment_${randomUUID().replaceAll('-', '')}`;
    const now = new Date();
    const fixture: Fixture = {
      prefix, workspaceId: `${prefix}_workspace`, userId: `${prefix}_user`, socialAccountId: `${prefix}_social`,
      targetId: `${prefix}_target`, postId: `${prefix}_post`, postTargetId: `${prefix}_post_target`,
      actor: { userId: `${prefix}_user`, workspaceId: `${prefix}_workspace`, allowedTargetIds: [`${prefix}_target`] },
    };
    fixtures.push(fixture);
    try {
      await client.user.create({ data: { id: fixture.userId, email: `${prefix}@example.test`, name: 'Synthetic receipt actor', passwordHash: 'unusable' } });
      await client.workspace.create({ data: { id: fixture.workspaceId, name: 'First-comment fixture', slug: fixture.workspaceId, timezone: 'UTC' } });
      await client.membership.create({ data: { id: `${prefix}_membership`, userId: fixture.userId, workspaceId: fixture.workspaceId, role: 'owner' } });
      await client.socialAccount.create({ data: {
        id: fixture.socialAccountId, workspaceId: fixture.workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`,
        name: 'Synthetic source', accessToken: 'synthetic-token', scopes: '',
      } });
      await client.target.create({ data: {
        id: fixture.targetId, workspaceId: fixture.workspaceId, socialAccountId: fixture.socialAccountId, type: 'page',
        providerId: `${prefix}_provider_page`, name: 'Synthetic destination', accessToken: 'synthetic-token',
        enabled: true, canPublish: true, createdAt: now,
      } });
      await client.post.create({ data: {
        id: fixture.postId, workspaceId: fixture.workspaceId, authorId: fixture.userId, message: 'Synthetic receipt post',
        format: 'post', firstComment: options.withComment === false ? null : 'Synthetic first comment', media: [], status: options.published ? 'published' : 'draft',
        scheduledAt: null, publishedAt: options.published ? now : null, createdAt: now, updatedAt: now,
      } });
      await client.postTarget.create({ data: {
        id: fixture.postTargetId, postId: fixture.postId, targetId: fixture.targetId,
        status: options.published ? 'published' : 'pending', remotePostId: options.published ? 'provider-post' : null,
        publishedAt: options.published ? now : null,
      } });
      return fixture;
    } catch (error) {
      await cleanup(fixture);
      throw error;
    }
  }

  async function cleanup(fixture: Fixture) {
    await client.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId' = ${fixture.workspaceId}`;
    await client.postTarget.deleteMany({ where: { id: fixture.postTargetId } });
    await client.post.deleteMany({ where: { id: fixture.postId } });
    await client.target.deleteMany({ where: { id: fixture.targetId } });
    await client.socialAccount.deleteMany({ where: { id: fixture.socialAccountId } });
    await client.membership.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await client.workspace.deleteMany({ where: { id: fixture.workspaceId } });
    await client.user.deleteMany({ where: { id: fixture.userId } });
  }

  function failReceiptWrite(fixture: Fixture, kind: 'post' | 'comment') {
    const base = client;
    integration.prisma = new Proxy(base, {
      get(target, property) {
        if (property !== '$transaction') {
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (work: ((tx: PrismaClient) => Promise<unknown>) | unknown, options?: object) => {
          if (typeof work !== 'function') return (base.$transaction as unknown as (arg: unknown, options?: object) => Promise<unknown>)(work, options);
          return base.$transaction(async tx => {
            const wrapped = new Proxy(tx, {
              get(transaction, model) {
                const delegate = Reflect.get(transaction, model, transaction) as unknown;
                if (model !== 'postTarget' || !delegate) return delegate;
                return new Proxy(delegate as object, {
                  get(modelDelegate, method) {
                    const operation = Reflect.get(modelDelegate, method, modelDelegate) as unknown;
                    if (typeof operation !== 'function' || (method !== 'update' && method !== 'updateMany')) return operation;
                    return (args: { where?: { id?: string }; data?: { status?: string; remotePostId?: string | null; firstCommentId?: string | null } }) => {
                      const targetsFixture = args.where?.id === fixture.postTargetId;
                      const isReceiptWrite = kind === 'post'
                        ? args.data?.status === 'published' && Boolean(args.data.remotePostId)
                        : Boolean(args.data?.firstCommentId);
                      if (targetsFixture && isReceiptWrite) throw new Error(`synthetic ${kind} receipt persistence failure`);
                      return (operation as (args: unknown) => unknown).call(modelDelegate, args);
                    };
                  },
                });
              },
            }) as PrismaClient;
            return (work as (transaction: PrismaClient) => Promise<unknown>)(wrapped);
          }, options);
        };
      },
    }) as PrismaClient;
  }

  it('requires current owner job access for an inline comment after scheduled publication', async () => {
    const fixture = await createFixture();
    const scheduledAt = new Date(Date.now() - 60_000);
    await client.post.update({ where: { id: fixture.postId }, data: { status: 'scheduled', scheduledAt } });
    integration.jobAccess.mockRejectedValue(new OperationError('forbidden', 'Automatic workspace access is unavailable.'));
    const result = await publishPost(fixture.actor, fixture.postId, scheduledAt);
    expect(result.published).toBe(1);
    expect(integration.jobAccess).toHaveBeenCalled();
    expect(integration.adapter.publishFirstComment).not.toHaveBeenCalled();
    const target = await client.postTarget.findUnique({ where: { id: fixture.postTargetId } });
    expect(target).toMatchObject({ status: 'published', firstCommentId: null, firstCommentAt: null });
  });

  it('commits the post receipt before comment dispatch and never repeats an ambiguous comment', async () => {
    const fixture = await createFixture();
    integration.adapter.publishFirstComment.mockImplementation(async () => {
      expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true } }))
        .toEqual({ status: 'published', remotePostId: 'provider-post' });
      throw new Error('ambiguous transport failure');
    });
    integration.adapter.classifyPublishingFailure.mockReturnValue('uncertain');

    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ published: 1, needsReconciliation: 0, firstCommentsNeedingReview: 1 });
    const afterFirstAttempt = await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true, firstCommentId: true, firstCommentAt: true, firstCommentError: true } });
    expect(afterFirstAttempt).toMatchObject({ status: 'published', remotePostId: 'provider-post', firstCommentId: null, firstCommentError: 'rebuild:first_comment_uncertain' });
    expect(afterFirstAttempt?.firstCommentAt).toBeInstanceOf(Date);
    await expect(sendFirstComment(fixture.actor, { postId: fixture.postId, postTargetId: fixture.postTargetId })).resolves.toMatchObject({ state: 'needs_review' });
    expect(integration.adapter.publish).toHaveBeenCalledTimes(1);
    expect(integration.adapter.publishFirstComment).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a rejected first comment from an uncertain publication outcome', async () => {
    const fixture = await createFixture();
    integration.adapter.publishFirstComment.mockRejectedValueOnce(new Error('explicit provider refusal'));
    integration.adapter.classifyPublishingFailure.mockReturnValue('rejected');
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ published: 1, failed: 0, needsReconciliation: 0, firstCommentsNeedingReview: 0, firstCommentsNotSent: 1 });
    expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true } })).toEqual({ status: 'published', remotePostId: 'provider-post' });
  });

  it('releases an explicit provider rejection for one deliberate retry, then records success once', async () => {
    const fixture = await createFixture({ published: true });
    integration.adapter.publishFirstComment.mockRejectedValueOnce(new Error('explicit provider refusal'))
      .mockResolvedValue({ remoteId: 'provider-comment' });
    integration.adapter.classifyPublishingFailure.mockReturnValue('rejected');

    await expect(sendFirstComment(fixture.actor, { postId: fixture.postId, postTargetId: fixture.postTargetId })).resolves.toMatchObject({ state: 'ready' });
    expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { firstCommentId: true, firstCommentAt: true, firstCommentError: true } }))
      .toEqual({ firstCommentId: null, firstCommentAt: null, firstCommentError: 'rebuild:first_comment_rejected' });
    await expect(sendFirstComment(fixture.actor, { postId: fixture.postId, postTargetId: fixture.postTargetId })).resolves.toMatchObject({ state: 'sent' });
    await expect(sendFirstComment(fixture.actor, { postId: fixture.postId, postTargetId: fixture.postTargetId })).resolves.toMatchObject({ state: 'sent' });
    expect(integration.adapter.publishFirstComment).toHaveBeenCalledTimes(2);
    expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { firstCommentId: true, firstCommentError: true } }))
      .toEqual({ firstCommentId: 'provider-comment', firstCommentError: null });
  });

  it('keeps the committed attempt claim if the provider accepted but the comment receipt write fails', async () => {
    const fixture = await createFixture({ published: true });
    failReceiptWrite(fixture, 'comment');
    integration.adapter.publishFirstComment.mockResolvedValue({ remoteId: 'provider-comment-accepted' });

    await expect(sendFirstComment(fixture.actor, { postId: fixture.postId, postTargetId: fixture.postTargetId })).resolves.toMatchObject({ state: 'needs_review' });
    integration.prisma = client;
    const row = await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true, firstCommentId: true, firstCommentAt: true } });
    expect(row).toMatchObject({ status: 'published', remotePostId: 'provider-post', firstCommentId: null });
    expect(row?.firstCommentAt).toBeInstanceOf(Date);
    await expect(sendFirstComment(fixture.actor, { postId: fixture.postId, postTargetId: fixture.postTargetId })).resolves.toMatchObject({ state: 'needs_review' });
    expect(integration.adapter.publishFirstComment).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch a comment when the post receipt cannot be persisted', async () => {
    const fixture = await createFixture();
    failReceiptWrite(fixture, 'post');
    integration.adapter.publish.mockResolvedValue({ state: 'published', remoteId: 'provider-post', url: null });

    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ published: 0, needsReconciliation: 1, firstCommentsNeedingReview: 0 });
    integration.prisma = client;
    expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true, firstCommentId: true } }))
      .toEqual({ status: 'processing', remotePostId: null, firstCommentId: null });
    expect(integration.adapter.publishFirstComment).not.toHaveBeenCalled();
  });

  it('treats missing or invalid provider identifiers as unresolved and keeps retry blocked', async () => {
    const postFixture = await createFixture();
    integration.adapter.publish.mockResolvedValue({ state: 'published', remoteId: '   ', url: null });
    await expect(publishPost(postFixture.actor, postFixture.postId)).resolves.toMatchObject({ published: 0, needsReconciliation: 1 });
    expect(await observer.postTarget.findUnique({ where: { id: postFixture.postTargetId }, select: { status: true, remotePostId: true } }))
      .toEqual({ status: 'processing', remotePostId: null });
    expect(integration.adapter.publishFirstComment).not.toHaveBeenCalled();

    const commentFixture = await createFixture({ published: true });
    integration.adapter.publishFirstComment.mockResolvedValue({ remoteId: '   ' });
    integration.adapter.classifyPublishingFailure.mockReturnValue('uncertain');
    await expect(sendFirstComment(commentFixture.actor, { postId: commentFixture.postId, postTargetId: commentFixture.postTargetId })).resolves.toMatchObject({ state: 'needs_review' });
    expect(await observer.postTarget.findUnique({ where: { id: commentFixture.postTargetId }, select: { firstCommentId: true, firstCommentAt: true, firstCommentError: true } }))
      .toMatchObject({ firstCommentId: null, firstCommentError: 'rebuild:first_comment_uncertain' });
  });

  it('requires exact human confirmation to record sent or not-sent without another provider call', async () => {
    const sentFixture = await createFixture({ published: true });
    const notSentFixture = await createFixture({ published: true });
    const attemptAt = new Date();
    await client.postTarget.updateMany({ where: { id: { in: [sentFixture.postTargetId, notSentFixture.postTargetId] } }, data: { firstCommentAt: attemptAt, firstCommentError: 'rebuild:first_comment_uncertain' } });
    await expect(recordFirstCommentOutcome(sentFixture.actor, {
      postId: sentFixture.postId, postTargetId: sentFixture.postTargetId, outcome: 'sent', remoteId: 'manual-remote-comment', confirmation: 'wrong',
    })).rejects.toMatchObject({ code: 'invalid_request' });

    await expect(recordFirstCommentOutcome(sentFixture.actor, {
      postId: sentFixture.postId, postTargetId: sentFixture.postTargetId, outcome: 'sent', remoteId: 'manual-remote-comment',
      confirmation: `RECORD FIRST COMMENT ${sentFixture.postTargetId} SENT`,
    })).resolves.toMatchObject({ state: 'sent' });
    await expect(recordFirstCommentOutcome(notSentFixture.actor, {
      postId: notSentFixture.postId, postTargetId: notSentFixture.postTargetId, outcome: 'not_sent',
      confirmation: `RECORD FIRST COMMENT ${notSentFixture.postTargetId} NOT SENT`,
    })).resolves.toMatchObject({ state: 'ready' });
    expect(await observer.postTarget.findUnique({ where: { id: sentFixture.postTargetId }, select: { firstCommentId: true, firstCommentError: true } }))
      .toEqual({ firstCommentId: 'manual-remote-comment', firstCommentError: null });
    expect(await observer.postTarget.findUnique({ where: { id: notSentFixture.postTargetId }, select: { firstCommentId: true, firstCommentAt: true, firstCommentError: true } }))
      .toEqual({ firstCommentId: null, firstCommentAt: null, firstCommentError: null });
    const audits = await observer.$queryRaw<Array<{ action: string; detail: { outcome?: string; verification?: string } }>>`
      SELECT action, detail FROM root_activities WHERE detail->>'workspaceId' IN (${sentFixture.workspaceId}, ${notSentFixture.workspaceId})`;
    expect(audits.filter(audit => audit.action === 'publishing.first_comment_outcome_recorded').map(audit => audit.detail))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ outcome: 'sent', verification: 'external_human_attestation' }),
        expect.objectContaining({ outcome: 'not_sent', verification: 'external_human_attestation' }),
      ]));
    expect(integration.adapter.publishFirstComment).not.toHaveBeenCalled();
  });
});
