import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';
import type { PublishingFormatDescriptor } from '../src/platforms/types';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  adapter: null as unknown as { publishFirstComment: ReturnType<typeof vi.fn>; classifyPublishingFailure: ReturnType<typeof vi.fn>; supportsTargetKind: ReturnType<typeof vi.fn>; canUseCredential: ReturnType<typeof vi.fn>; publishingFormats: readonly PublishingFormatDescriptor[] },
  targetId: '',
  grantAllowed: true,
  jobAllowed: true,
  operationTimeoutMs: 60000,
}));

vi.mock('../src/server/data', () => ({ get prisma() { return integration.prisma; } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => ({
  'publishing.operationTimeoutMs': integration.operationTimeoutMs, 'publishing.operationMaxWaitMs': 2000,
  'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000,
  'publishing.maxTargetsPerOperation': 5000, 'publishing.identifierMaxCharacters': 200,
  'publishing.maxFirstCommentDelayMinutes': 10080,
  'data.workspaceOperationTimeoutMs': 300000,
}[key]) }));
vi.mock('../src/modules/publishing/server/access', () => ({
  authorizePublishing: async (actor: { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] }) => ({ actor, role: 'editor', permissions: {}, entitlements: {} }),
}));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('../src/server/jobs/access', () => ({ assertWorkspaceJobAccess: async () => { if (!integration.jobAllowed) throw new Error('synthetic workspace job access denied'); } }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async () => integration.adapter }));
vi.mock('../src/modules/publishing/server/read-scope', () => ({
  selectedPublishingTargetIds: async (_workspaceId: string, _entitlements: unknown, allowed?: readonly string[]) => allowed ? [...allowed] : [integration.targetId],
  publishingPostVisibilityWhere: (workspaceId: string, ids: readonly string[], authorId?: string) => ({ workspaceId, targets: { some: { targetId: { in: [...ids] } }, every: { targetId: { in: [...ids] } } }, ...(authorId ? { authorId } : {}) }),
}));

import { sendDueFirstComment } from '../src/modules/publishing/server/first-comment';

type Fixture = { prefix: string; workspaceId: string; userId: string; socialAccountId: string; targetId: string; postId: string; postTargetId: string; actor: { userId: string; workspaceId: string; allowedTargetIds: string[] } };

describe.skipIf(!databaseUrl)('automatic first comments on isolated PostgreSQL', () => {
  let client: PrismaClient;
  let observer: PrismaClient;
  const fixtures: Fixture[] = [];

  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.port !== '55432' ||
      !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) throw new Error('First-comment integration requires an isolated loopback _preview database.');
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    observer = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    integration.prisma = client;
    resetAdapter();
  });

  beforeEach(() => resetAdapter());
  afterEach(async () => {
    integration.prisma = client;
    integration.adapter.publishFirstComment.mockReset();
    integration.adapter.classifyPublishingFailure.mockReset();
    integration.adapter.supportsTargetKind.mockReset().mockReturnValue(true);
    for (const fixture of fixtures.splice(0)) await cleanup(fixture);
  });
  afterAll(async () => { integration.prisma = client; await observer?.$disconnect(); await client?.$disconnect(); });

  function resetAdapter() {
    integration.grantAllowed = true;
    integration.jobAllowed = true;
    integration.operationTimeoutMs = 60000;
    integration.adapter = {
      canUseCredential: vi.fn(() => integration.grantAllowed),
      publishFirstComment: vi.fn(async () => ({ remoteId: `provider-comment-${randomUUID()}` })),
      classifyPublishingFailure: vi.fn(() => 'uncertain'),
      supportsTargetKind: vi.fn(() => true),
      publishingFormats: [{ id: 'post', label: 'Post', media: { kinds: ['image', 'video'], maxImages: null, maxVideos: null, mixedKinds: false, linkWithMedia: false, imageAltText: true }, firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } }],
    };
  }

  async function createFixture(options: { delay?: number; formatId?: string; firstComment?: string } = {}): Promise<Fixture> {
    const prefix = `preview_first_comment_${randomUUID().replaceAll('-', '')}`, now = new Date(), publishedAt = new Date(Date.now() - 10 * 60_000);
    const fixture: Fixture = { prefix, workspaceId: `${prefix}_workspace`, userId: `${prefix}_user`, socialAccountId: `${prefix}_social`, targetId: `${prefix}_target`, postId: `${prefix}_post`, postTargetId: `${prefix}_post_target`, actor: { userId: `${prefix}_user`, workspaceId: `${prefix}_workspace`, allowedTargetIds: [`${prefix}_target`] } };
    fixtures.push(fixture);
    integration.targetId = fixture.targetId;
    try {
      await client.user.create({ data: { id: fixture.userId, email: `${prefix}@example.test`, name: 'Synthetic first-comment actor', passwordHash: 'unusable' } });
      await client.workspace.create({ data: { id: fixture.workspaceId, name: 'First-comment fixture', slug: fixture.workspaceId, timezone: 'UTC' } });
      await client.membership.create({ data: { id: `${prefix}_membership`, userId: fixture.userId, workspaceId: fixture.workspaceId, role: 'owner' } });
      await client.socialAccount.create({ data: { id: fixture.socialAccountId, workspaceId: fixture.workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`, name: 'Synthetic source', accessToken: 'synthetic-token', scopes: '' } });
      await client.target.create({ data: { id: fixture.targetId, workspaceId: fixture.workspaceId, socialAccountId: fixture.socialAccountId, type: 'page', providerId: `${prefix}_page`, name: 'Synthetic destination', accessToken: 'synthetic-token', enabled: true, canPublish: true, createdAt: now } });
      await client.post.create({ data: { id: fixture.postId, workspaceId: fixture.workspaceId, authorId: fixture.userId, message: 'Synthetic published post', format: 'post', firstComment: options.firstComment ?? 'Synthetic first comment', media: [], status: 'published', scheduledAt: null, publishedAt, createdAt: now, updatedAt: now } });
      await client.postTarget.create({ data: { id: fixture.postTargetId, postId: fixture.postId, targetId: fixture.targetId, formatId: options.formatId ?? 'post', status: 'published', remotePostId: `${prefix}_remote`, publishedAt } });
      if (options.delay !== undefined) await client.$executeRaw`UPDATE posts SET "firstCommentDelayMinutes"=${options.delay} WHERE id=${fixture.postId} AND "workspaceId"=${fixture.workspaceId}`;
      return fixture;
    } catch (error) { await cleanup(fixture); throw error; }
  }

  async function cleanup(fixture: Fixture) {
    await client.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId'=${fixture.workspaceId}`;
    await client.postTarget.deleteMany({ where: { id: fixture.postTargetId } });
    await client.post.deleteMany({ where: { id: fixture.postId } });
    await client.target.deleteMany({ where: { id: fixture.targetId } });
    await client.socialAccount.deleteMany({ where: { id: fixture.socialAccountId } });
    await client.membership.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await client.workspace.deleteMany({ where: { id: fixture.workspaceId } });
    await client.user.deleteMany({ where: { id: fixture.userId } });
  }

  async function commentState(fixture: Fixture) {
    return observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { firstCommentId: true, firstCommentAt: true, firstCommentError: true } });
  }

  it('sends only when the target publication delay is due and does not resend its stored receipt', async () => {
    const future = await createFixture({ delay: 5 });
    const publishedAt = (await observer.postTarget.findUniqueOrThrow({ where: { id: future.postTargetId }, select: { publishedAt: true } })).publishedAt!;
    const early = await sendDueFirstComment(future.actor, { postId: future.postId, postTargetId: future.postTargetId }, new Date(publishedAt.getTime() + 4 * 60_000));
    expect(early.state).toBe('scheduled');
    expect(integration.adapter.publishFirstComment).not.toHaveBeenCalled();

    const due = await sendDueFirstComment(future.actor, { postId: future.postId, postTargetId: future.postTargetId }, new Date(publishedAt.getTime() + 5 * 60_000));
    const firstReceipt = await commentState(future);
    expect(due.state).toBe('sent');
    expect(firstReceipt?.firstCommentId).toMatch(/^provider-comment-/);
    const repeat = await sendDueFirstComment(future.actor, { postId: future.postId, postTargetId: future.postTargetId }, new Date(publishedAt.getTime() + 6 * 60_000));
    expect(repeat.state).toBe('sent');
    expect(integration.adapter.publishFirstComment).toHaveBeenCalledTimes(1);
    expect((await commentState(future))?.firstCommentId).toBe(firstReceipt?.firstCommentId);
  });

  it('retains a valid provider receipt if cancellation arrives during dispatch', async () => {
    const fixture = await createFixture();
    integration.operationTimeoutMs = 250;
    let dispatchSignal: AbortSignal | undefined;
    integration.adapter.publishFirstComment.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
      dispatchSignal = signal;
      await new Promise(resolve => setTimeout(resolve, 350));
      const remoteId = `${fixture.prefix}_comment_receipt`;
      return { remoteId };
    });
    try {
      await expect(sendDueFirstComment(fixture.actor, { postId: fixture.postId, postTargetId: fixture.postTargetId }, new Date())).rejects.toThrow();
      expect(dispatchSignal?.aborted).toBe(true);
      expect((await commentState(fixture))?.firstCommentId).toBe(`${fixture.prefix}_comment_receipt`);
      expect(integration.adapter.publishFirstComment).toHaveBeenCalledTimes(1);
    } finally { integration.operationTimeoutMs = 60000; }
  });

  it('holds ambiguous outcomes without retry and leaves definitive rejection manual-only', async () => {
    const ambiguous = await createFixture();
    integration.adapter.publishFirstComment.mockRejectedValueOnce(new Error('synthetic response lost'));
    integration.adapter.classifyPublishingFailure.mockReturnValueOnce('uncertain');
    expect((await sendDueFirstComment(ambiguous.actor, { postId: ambiguous.postId, postTargetId: ambiguous.postTargetId }, new Date())).state).toBe('needs_review');
    expect((await sendDueFirstComment(ambiguous.actor, { postId: ambiguous.postId, postTargetId: ambiguous.postTargetId }, new Date())).state).toBe('needs_review');
    expect(integration.adapter.publishFirstComment).toHaveBeenCalledTimes(1);
    expect((await commentState(ambiguous))?.firstCommentAt).toBeInstanceOf(Date);

    const rejected = await createFixture();
    integration.adapter.publishFirstComment.mockClear();
    integration.adapter.publishFirstComment.mockRejectedValueOnce(new Error('synthetic provider rejection'));
    integration.adapter.classifyPublishingFailure.mockReturnValueOnce('rejected');
    expect((await sendDueFirstComment(rejected.actor, { postId: rejected.postId, postTargetId: rejected.postTargetId }, new Date())).state).toBe('ready');
    expect((await commentState(rejected))?.firstCommentError).toBe('rebuild:first_comment_rejected');
    await expect(sendDueFirstComment(rejected.actor, { postId: rejected.postId, postTargetId: rejected.postTargetId }, new Date())).rejects.toThrow();
    expect(integration.adapter.publishFirstComment).toHaveBeenCalledTimes(1);
  });

  it('treats a malformed resolved receipt as uncertain even when the failure classifier says rejected', async () => {
    const fixture = await createFixture();
    integration.adapter.publishFirstComment.mockResolvedValueOnce({ remoteId: '' });
    integration.adapter.classifyPublishingFailure.mockReturnValue('rejected');
    expect((await sendDueFirstComment(fixture.actor, { postId: fixture.postId, postTargetId: fixture.postTargetId }, new Date())).state).toBe('needs_review');
    expect((await commentState(fixture))?.firstCommentError).toBe('rebuild:first_comment_uncertain');
    expect((await sendDueFirstComment(fixture.actor, { postId: fixture.postId, postTargetId: fixture.postTargetId }, new Date())).state).toBe('needs_review');
    expect(integration.adapter.publishFirstComment).toHaveBeenCalledTimes(1);
  });

  it('does not dispatch when the destination is outside current selection or its format rejects first comments', async () => {
    const unselected = await createFixture();
    unselected.actor.allowedTargetIds = [];
    await expect(sendDueFirstComment(unselected.actor, { postId: unselected.postId, postTargetId: unselected.postTargetId }, new Date())).rejects.toThrow();
    expect(integration.adapter.publishFirstComment).not.toHaveBeenCalled();

    const unsupported = await createFixture({ formatId: 'opaque-format' });
    integration.adapter.publishingFormats = [{ ...integration.adapter.publishingFormats[0]!, id: 'opaque-format', firstComment: false }];
    await expect(sendDueFirstComment(unsupported.actor, { postId: unsupported.postId, postTargetId: unsupported.postTargetId }, new Date())).rejects.toThrow();
    expect(integration.adapter.publishFirstComment).not.toHaveBeenCalled();
  });

  it('rechecks the current provider grant before claiming the automatic send', async () => {
    const fixture = await createFixture();
    integration.adapter.canUseCredential.mockReturnValueOnce(true).mockReturnValueOnce(false);
    await expect(sendDueFirstComment(fixture.actor, { postId: fixture.postId, postTargetId: fixture.postTargetId }, new Date())).rejects.toThrow();
    expect(integration.adapter.canUseCredential).toHaveBeenCalledTimes(2);
    expect(integration.adapter.publishFirstComment).not.toHaveBeenCalled();
    expect((await commentState(fixture))?.firstCommentAt).toBeNull();
  });

  it('blocks automatic dispatch when current workspace job access has been revoked', async () => {
    const fixture = await createFixture();
    integration.jobAllowed = false;
    await expect(sendDueFirstComment(fixture.actor, { postId: fixture.postId, postTargetId: fixture.postTargetId }, new Date())).rejects.toThrow();
    expect(integration.adapter.publishFirstComment).not.toHaveBeenCalled();
    expect((await commentState(fixture))?.firstCommentAt).toBeNull();
  });
});
