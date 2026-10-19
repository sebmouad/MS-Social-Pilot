import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';
import type { PublishingFormatDescriptor } from '../src/platforms/types';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  adapter: null as unknown as { publish: ReturnType<typeof vi.fn>; publishFirstComment: ReturnType<typeof vi.fn>; getRemoteStatus: ReturnType<typeof vi.fn>; classifyPublishingFailure: ReturnType<typeof vi.fn>; supportsTargetKind: ReturnType<typeof vi.fn>; canUseCredential: ReturnType<typeof vi.fn>; statusPolicyFingerprint: string; publishingFormats: readonly PublishingFormatDescriptor[]; defaultPublishingFormatId: string },
  targetId: '',
  grantAllowed: true,
}));

vi.mock('../src/server/data', () => ({ get prisma() { return integration.prisma; } }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => ({
    'publishing.operationTimeoutMs': 60000, 'publishing.operationMaxWaitMs': 2000,
    'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000,
    'publishing.maxTargetsPerOperation': 5000, 'publishing.identifierMaxCharacters': 200,
    'publishing.publicationHistoryLimit': 100, 'publishing.publicationUrlMaxCharacters': 2048,
    'publishing.maxMessageCharacters': 10000, 'publishing.maxRemoteMediaPerPost': 4,
    'publishing.maxImageAltCharacters': 500, 'data.workspaceOperationTimeoutMs': 300000,
    'data.workspaceOperationLockWaitMs': 30000, 'data.deleteTransactionTimeoutMs': 300000,
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
vi.mock('../src/modules/publishing/server/read-scope', () => ({
  selectedPublishingTargetIds: async (_workspaceId: string, _entitlements: unknown, allowed?: readonly string[]) => allowed ? [...allowed] : [integration.targetId],
  publishingPostVisibilityWhere: (workspaceId: string, ids: readonly string[], authorId?: string) => ({
    workspaceId,
    targets: { some: { targetId: { in: [...ids] } }, every: { targetId: { in: [...ids] } } },
    ...(authorId ? { authorId } : {}),
  }),
}));

import { publishPost, syncPostStatus } from '../src/server/publishing/lifecycle';
import { projectPublicationInOperation, publishDestinationInOperation, recordPublicationOutcome, recordPublicationOutcomeInTransaction } from '../src/modules/publishing/server/publication';
import { deleteWorkspaceData } from '../src/server/data-control';

type Fixture = {
  prefix: string; workspaceId: string; userId: string; socialAccountId: string; targetId: string;
  postId: string; postTargetId: string; actor: { userId: string; workspaceId: string; allowedTargetIds: string[] };
};

describe.skipIf(!databaseUrl)('publication journal on isolated PostgreSQL', () => {
  let client: PrismaClient;
  let observer: PrismaClient;
  const fixtures: Fixture[] = [];

  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Publication database integration writes require an isolated loopback _preview database.');
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
    integration.adapter.getRemoteStatus.mockReset();
    integration.adapter.classifyPublishingFailure.mockReset();
    integration.adapter.supportsTargetKind.mockReset().mockReturnValue(true);
    for (const fixture of fixtures.splice(0)) await cleanup(fixture);
  });
  beforeEach(() => resetAdapter());
  afterAll(async () => {
    integration.prisma = client;
    await observer?.$disconnect();
    await client?.$disconnect();
  });

  function resetAdapter() {
    integration.grantAllowed = true;
    integration.adapter = {
      canUseCredential: vi.fn(() => integration.grantAllowed),
      publish: vi.fn(async () => ({ state: 'published', remoteId: `provider-post-${randomUUID()}`, url: 'https://example.test/post' })),
      publishFirstComment: vi.fn(async () => ({ remoteId: 'provider-comment' })),
      getRemoteStatus: vi.fn(async () => ({ state: 'published' as const, remoteId: 'provider-status-id', targetId: 'provider-target-id', publishedAt: new Date() })),
      statusPolicyFingerprint: 'synthetic-policy-v1',
      classifyPublishingFailure: vi.fn(() => 'uncertain'),
      supportsTargetKind: vi.fn(() => true),
      publishingFormats: [{ id: 'post', label: 'Post', media: { kinds: ['image', 'video'], maxImages: null, maxVideos: null, mixedKinds: false, linkWithMedia: false, imageAltText: true }, firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } }],
      defaultPublishingFormatId: 'post',
    };
  }

  async function createFixture(provider = 'facebook'): Promise<Fixture> {
    const prefix = `preview_publication_${randomUUID().replaceAll('-', '')}`;
    const now = new Date();
    const fixture: Fixture = {
      prefix, workspaceId: `${prefix}_workspace`, userId: `${prefix}_user`, socialAccountId: `${prefix}_social`,
      targetId: `${prefix}_target`, postId: `${prefix}_post`, postTargetId: `${prefix}_post_target`,
      actor: { userId: `${prefix}_user`, workspaceId: `${prefix}_workspace`, allowedTargetIds: [`${prefix}_target`] },
    };
    fixtures.push(fixture);
    integration.targetId = fixture.targetId;
    try {
      await client.user.create({ data: { id: fixture.userId, email: `${prefix}@example.test`, name: 'Synthetic publication actor', passwordHash: 'unusable' } });
      await client.workspace.create({ data: { id: fixture.workspaceId, name: 'Publication fixture', slug: fixture.workspaceId, timezone: 'UTC' } });
      await client.membership.create({ data: { id: `${prefix}_membership`, userId: fixture.userId, workspaceId: fixture.workspaceId, role: 'owner' } });
      await client.socialAccount.create({ data: {
        id: fixture.socialAccountId, workspaceId: fixture.workspaceId, provider, providerUserId: `${prefix}_provider`,
        name: 'Synthetic publication source', accessToken: 'synthetic-token', scopes: '',
      } });
      await client.target.create({ data: {
        id: fixture.targetId, workspaceId: fixture.workspaceId, socialAccountId: fixture.socialAccountId, type: 'page',
        providerId: `${prefix}_provider_page`, name: 'Synthetic publication destination', accessToken: 'synthetic-token',
        enabled: true, canPublish: true, createdAt: now,
      } });
      await client.post.create({ data: {
        id: fixture.postId, workspaceId: fixture.workspaceId, authorId: fixture.userId, message: 'Synthetic publication post',
        firstComment: null, media: [], status: 'draft', scheduledAt: null, publishedAt: null, createdAt: now, updatedAt: now,
      } });
      await client.postTarget.create({ data: { id: fixture.postTargetId, postId: fixture.postId, targetId: fixture.targetId, status: 'pending' } });
      return fixture;
    } catch (error) {
      await cleanup(fixture);
      throw error;
    }
  }

  async function cleanup(fixture: Fixture) {
    await client.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId' = ${fixture.workspaceId}`;
    await client.$executeRaw`DELETE FROM rebuild_publication_attempts WHERE "workspaceId" = ${fixture.workspaceId}`;
    await client.postTarget.deleteMany({ where: { id: fixture.postTargetId } });
    await client.post.deleteMany({ where: { id: fixture.postId } });
    await client.target.deleteMany({ where: { id: fixture.targetId } });
    await client.socialAccount.deleteMany({ where: { id: fixture.socialAccountId } });
    await client.membership.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await client.workspace.deleteMany({ where: { id: fixture.workspaceId } });
    await client.user.deleteMany({ where: { id: fixture.userId } });
  }

  function failProjectionAudit(fixture: Fixture) {
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
              get(transaction, propertyName) {
                const value = Reflect.get(transaction, propertyName, transaction) as unknown;
                if (propertyName !== '$executeRaw' || typeof value !== 'function') return value;
                return (...args: unknown[]) => {
                  const templateValues = args.slice(1);
                  if (templateValues.includes('publishing.target_published')) throw new Error(`synthetic projection audit fault for ${fixture.prefix}`);
                  return (value as (...values: unknown[]) => unknown).apply(transaction, args);
                };
              },
            }) as PrismaClient;
            return (work as (transaction: PrismaClient) => Promise<unknown>)(wrapped);
          }, options);
        };
      },
    }) as PrismaClient;
  }

  it('passes the stored opaque format unchanged through the guarded publication service', async () => {
    const f=await createFixture();
    await client.post.update({where:{id:f.postId},data:{format:'synthetic-opaque-format'}});
    integration.adapter.publishingFormats = [...integration.adapter.publishingFormats, { id: 'synthetic-opaque-format', label: 'Synthetic format', media: { kinds: ['image', 'video'], maxImages: null, maxVideos: null, mixedKinds: false, linkWithMedia: false, imageAltText: true }, firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } }];
    integration.adapter.publish.mockResolvedValue({state:'published',remoteId:'synthetic-format-receipt',url:null});
    await publishPost(f.actor,f.postId);
    expect(integration.adapter.publish).toHaveBeenCalledWith(expect.objectContaining({formatId:'synthetic-opaque-format'}));
  });
  it('commits and exposes intent before dispatch, then excludes duplicate concurrent dispatch', async () => {
    const fixture = await createFixture();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    integration.adapter.publish.mockImplementation(async (request: { operationId?: string }) => {
      expect(request.operationId).toEqual(expect.any(String));
      const attempts = await observer.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`;
      expect(attempts).toEqual([{ state: 'started' }]);
      expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true } }))
        .toEqual({ status: 'processing', remotePostId: null });
      enter();
      await blocked;
      return { state: 'published', remoteId: 'provider-post-concurrent', url: null };
    });
    const first = publishPost(fixture.actor, fixture.postId);
    try {
      await entered;
      await expect(publishPost(fixture.actor, fixture.postId)).rejects.toMatchObject({ code: 'conflict' });
      expect(integration.adapter.publish).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    await expect(first).resolves.toMatchObject({ published: 1, needsReconciliation: 0 });
    expect(await observer.$queryRaw<Array<{ state: string; remotePostId: string | null }>>`SELECT state, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
      .toEqual([{ state: 'projected', remotePostId: 'provider-post-concurrent' }]);
  });

  it('retains a durable receipt when projection fails and resumes locally without another provider create', async () => {
    const fixture = await createFixture();
    integration.adapter.publish.mockResolvedValue({ state: 'published', remoteId: 'provider-post-recoverable', url: 'https://example.test/receipt' });
    failProjectionAudit(fixture);
    try {
      await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ published: 0, needsReconciliation: 1 });
      integration.prisma = client;
      expect(await observer.$queryRaw<Array<{ state: string; remotePostId: string | null }>>`SELECT state, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
        .toEqual([{ state: 'receipt_recorded', remotePostId: 'provider-post-recoverable' }]);
      expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true } }))
        .toEqual({ status: 'processing', remotePostId: null });

      const [attempt] = await observer.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`;
      await expect(projectPublicationInOperation(fixture.actor, attempt.id, new AbortController().signal)).resolves.toBe(true);
      expect(await observer.$queryRaw<Array<{ state: string; remotePostId: string | null }>>`SELECT state, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
        .toEqual([{ state: 'projected', remotePostId: 'provider-post-recoverable' }]);
      expect(integration.adapter.publish).toHaveBeenCalledTimes(1);
    } finally {
      integration.prisma = client;
    }
  });

  it('keeps ambiguous failures uncertain, lets only explicit provider rejection release a retry, and requires absence attestation before an explicit new attempt', async () => {
    const fixture = await createFixture();
    integration.adapter.publish.mockRejectedValueOnce(new Error('synthetic transport loss'));
    integration.adapter.classifyPublishingFailure.mockReturnValueOnce('uncertain');
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ needsReconciliation: 1 });
    const [uncertain] = await observer.$queryRaw<Array<{ id: string; state: string }>>`SELECT id, state FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`;
    expect(uncertain.state).toBe('uncertain');
    await expect(publishPost(fixture.actor, fixture.postId)).rejects.toMatchObject({ code: 'conflict' });
    expect(integration.adapter.publish).toHaveBeenCalledTimes(1);

    await recordPublicationOutcome(fixture.actor, {
      postId: fixture.postId, operationId: uncertain.id, outcome: 'ABSENT', confirmation: `RECORD PUBLICATION ${uncertain.id} ABSENT`, verifiedExternally: true,
    });
    expect(await observer.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId} AND id=${uncertain.id}`)
      .toEqual([{ state: 'attested_absent' }]);
    await expect(client.$transaction(tx => recordPublicationOutcomeInTransaction(tx, fixture.userId, {
      workspaceId: fixture.workspaceId, operationId: uncertain.id, outcome: 'PUBLISHED', remotePostId: 'late-provider-receipt',
    }))).rejects.toMatchObject({ code: 'conflict' });
    expect(await observer.$queryRaw<Array<{ state: string; remotePostId: string | null }>>`SELECT state, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId} AND id=${uncertain.id}`)
      .toEqual([{ state: 'attested_absent', remotePostId: null }]);

    integration.adapter.publish.mockResolvedValueOnce({ state: 'published', remoteId: 'provider-post-after-absence', url: null });
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ published: 1, needsReconciliation: 0 });
    expect(integration.adapter.publish).toHaveBeenCalledTimes(2);
    expect(await observer.$queryRaw<Array<{ state: string; remotePostId: string | null }>>`SELECT state, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId} ORDER BY "createdAt", id`)
      .toMatchObject([{ state: 'attested_absent', remotePostId: null }, { state: 'projected', remotePostId: 'provider-post-after-absence' }]);
  });

  it('records an explicit adapter rejection as rejected and permits the next deliberate call', async () => {
    const fixture = await createFixture();
    integration.adapter.publish.mockRejectedValueOnce(new Error('synthetic definitive rejection'))
      .mockResolvedValueOnce({ state: 'published', remoteId: 'provider-post-retry', url: null });
    integration.adapter.classifyPublishingFailure.mockReturnValueOnce('rejected');
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ failed: 1, needsReconciliation: 0 });
    expect(await observer.$queryRaw<Array<{ state: string; reason: string }>>`SELECT state, reason FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
      .toEqual([{ state: 'rejected', reason: 'provider_rejected' }]);
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ published: 1 });
    expect(integration.adapter.publish).toHaveBeenCalledTimes(2);
  });

  it('holds an explicitly submitted provider receipt without projecting it or retrying the create', async () => {
    const fixture = await createFixture();
    integration.adapter.publish.mockResolvedValue({ state: 'submitted', remoteId: 'provider-submitted-1', url: 'https://example.test/submitted/1' });

    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ published: 0, needsReconciliation: 1 });
    expect(await observer.$queryRaw<Array<{ state: string; reason: string; remotePostId: string; remoteUrl: string; receiptAt: Date | null }>>`
      SELECT state, reason, "remotePostId", "remoteUrl", "receiptAt" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
      .toMatchObject([{ state: 'submitted', reason: 'provider_submission', remotePostId: 'provider-submitted-1', remoteUrl: 'https://example.test/submitted/1' }]);
    expect((await observer.$queryRaw<Array<{ receiptAt: Date | null }>>`SELECT "receiptAt" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)[0].receiptAt).toBeInstanceOf(Date);
    expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true, publishedAt: true } }))
      .toEqual({ status: 'processing', remotePostId: null, publishedAt: null });

    await expect(publishPost(fixture.actor, fixture.postId)).rejects.toMatchObject({ code: 'conflict' });
    expect(integration.adapter.publish).toHaveBeenCalledTimes(1);

    const missingState = await createFixture();
    integration.adapter.publish.mockReset().mockResolvedValue({ remoteId: 'provider-missing-state', url: null });
    await expect(publishPost(missingState.actor, missingState.postId)).resolves.toMatchObject({ published: 0, needsReconciliation: 1 });
    expect(await observer.$queryRaw<Array<{ state: string; reason: string; remotePostId: string }>>`
      SELECT state, reason, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${missingState.workspaceId}`)
      .toEqual([{ state: 'submitted', reason: 'provider_submission', remotePostId: 'provider-missing-state' }]);
    expect(await observer.postTarget.findUnique({ where: { id: missingState.postTargetId }, select: { status: true, remotePostId: true, publishedAt: true } }))
      .toEqual({ status: 'processing', remotePostId: null, publishedAt: null });

  });

  it('retains an unknown explicit provider output as held submitted evidence, while an invalid receipt fails closed', async () => {
    const fixture = await createFixture();
    integration.adapter.publish.mockResolvedValue({ state: 'queued', remoteId: 'provider-unknown-state', url: null });
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ published: 0, needsReconciliation: 1 });
    expect(await observer.$queryRaw<Array<{ state: string; reason: string; remotePostId: string }>>`
      SELECT state, reason, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
      .toEqual([{ state: 'submitted', reason: 'provider_submission', remotePostId: 'provider-unknown-state' }]);
    expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true, publishedAt: true } }))
      .toEqual({ status: 'processing', remotePostId: null, publishedAt: null });

    const invalid = await createFixture();
    integration.adapter.publish.mockReset().mockResolvedValue({ state: 'published', remoteId: 'x'.repeat(201), url: null });
    await expect(publishPost(invalid.actor, invalid.postId)).resolves.toMatchObject({ published: 0, needsReconciliation: 1 });
    expect(await observer.$queryRaw<Array<{ state: string; reason: string | null; remotePostId: string | null }>>`
      SELECT state, reason, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${invalid.workspaceId}`)
      .toEqual([{ state: 'started', reason: null, remotePostId: null }]);
    expect(await observer.postTarget.findUnique({ where: { id: invalid.postTargetId }, select: { status: true, remotePostId: true, publishedAt: true } }))
      .toEqual({ status: 'processing', remotePostId: null, publishedAt: null });
  });

  it('reconciles a matching submitted receipt through one status GET without repeating create or first comment', async () => {
    const fixture = await createFixture('synthetic');
    const remoteId = 'provider-status-confirmed';
    const providerTargetId = `${fixture.prefix}_provider_page`;
    const observedAt = new Date('2026-10-19T12:34:56.000Z');
    await client.post.update({ where: { id: fixture.postId }, data: { firstComment: 'Synthetic first comment' } });
    integration.adapter.publish.mockResolvedValue({ state: 'submitted', remoteId, url: 'https://example.test/submitted-status' });
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ published: 0, needsReconciliation: 1 });
    integration.adapter.getRemoteStatus.mockResolvedValue({ state: 'published', remoteId, targetId: providerTargetId, publishedAt: observedAt });

    await expect(syncPostStatus(fixture.actor, fixture.postId)).resolves.toMatchObject({ synced: 1 });
    expect(integration.adapter.getRemoteStatus).toHaveBeenCalledTimes(1);
    expect(integration.adapter.publish).toHaveBeenCalledTimes(1);
    expect(integration.adapter.publishFirstComment).not.toHaveBeenCalled();
    expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true, remoteUrl: true, publishedAt: true } }))
      .toEqual({ status: 'published', remotePostId: remoteId, remoteUrl: 'https://example.test/submitted-status', publishedAt: observedAt });
    expect(await observer.$queryRaw<Array<{ state: string; remotePostId: string }>>`
      SELECT state, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
      .toEqual([{ state: 'projected', remotePostId: remoteId }]);

    await expect(syncPostStatus(fixture.actor, fixture.postId)).resolves.toBeDefined();
    expect(integration.adapter.getRemoteStatus).toHaveBeenCalledTimes(2);
    expect(integration.adapter.publish).toHaveBeenCalledTimes(1);
    expect(integration.adapter.publishFirstComment).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'missing-remote-id', 'wrong-remote-id', 'wrong-target-id'] as const)(
    'keeps a submitted receipt held when provider status is %s', async resultKind => {
      const fixture = await createFixture('synthetic');
      const remoteId = 'provider-status-expected';
      const providerTargetId = `${fixture.prefix}_provider_page`;
      integration.adapter.publish.mockResolvedValue({ state: 'submitted', remoteId, url: null });
      await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ needsReconciliation: 1 });
      const result = resultKind === 'unknown' ? { state: 'unknown' }
        : resultKind === 'missing-remote-id' ? { state: 'published', targetId: providerTargetId }
          : resultKind === 'wrong-remote-id' ? { state: 'published', remoteId: 'provider-status-other', targetId: providerTargetId }
            : { state: 'published', remoteId, targetId: 'different-provider-target' };
      integration.adapter.getRemoteStatus.mockResolvedValue(result);

      await expect(syncPostStatus(fixture.actor, fixture.postId)).resolves.toMatchObject({ synced: 0 });
      expect(await observer.$queryRaw<Array<{ state: string; remotePostId: string }>>`
        SELECT state, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
        .toEqual([{ state: 'submitted', remotePostId: remoteId }]);
      expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true, publishedAt: true } }))
        .toEqual({ status: 'processing', remotePostId: null, publishedAt: null });
      expect(integration.adapter.publish).toHaveBeenCalledTimes(1);
      expect(integration.adapter.getRemoteStatus).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['grant', 'token', 'policy'] as const)('refuses submitted-receipt reconciliation if %s changes during the status GET', async change => {
    const fixture = await createFixture('synthetic');
    const remoteId = 'provider-status-recheck';
    integration.adapter.publish.mockResolvedValue({ state: 'submitted', remoteId, url: null });
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ needsReconciliation: 1 });
    integration.adapter.getRemoteStatus.mockImplementationOnce(async () => {
      if (change === 'grant') integration.grantAllowed = false;
      if (change === 'token') await client.target.update({ where: { id: fixture.targetId }, data: { accessToken: 'synthetic-token-rotated-during-get' } });
      if (change === 'policy') integration.adapter.statusPolicyFingerprint = 'synthetic-policy-changed-during-get';
      return { state: 'published', remoteId, targetId: `${fixture.prefix}_provider_page`, publishedAt: new Date() };
    });

    await expect(syncPostStatus(fixture.actor, fixture.postId)).rejects.toMatchObject({ code: 'conflict' });
    expect(await observer.$queryRaw<Array<{ state: string; remotePostId: string }>>`
      SELECT state, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
      .toEqual([{ state: 'submitted', remotePostId: remoteId }]);
    expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true, publishedAt: true } }))
      .toEqual({ status: 'processing', remotePostId: null, publishedAt: null });
    expect(integration.adapter.publish).toHaveBeenCalledTimes(1);
    expect(integration.adapter.getRemoteStatus).toHaveBeenCalledTimes(1);
  });

  it('rolls back both parent receipt resolution and target projection on audit failure, then retries status only', async () => {
    const fixture = await createFixture('synthetic');
    const remoteId = 'provider-status-audit-retry';
    integration.adapter.publish.mockResolvedValue({ state: 'submitted', remoteId, url: 'https://example.test/submitted-audit-retry' });
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ needsReconciliation: 1 });
    integration.adapter.getRemoteStatus.mockResolvedValue({ state: 'published', remoteId, targetId: `${fixture.prefix}_provider_page`, publishedAt: new Date() });
    failProjectionAudit(fixture);
    try {
      await expect(syncPostStatus(fixture.actor, fixture.postId)).rejects.toThrow();
    } finally {
      integration.prisma = client;
    }
    expect(await observer.$queryRaw<Array<{ state: string; remotePostId: string; reason: string }>>`
      SELECT state, "remotePostId", reason FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
      .toEqual([{ state: 'submitted', remotePostId: remoteId, reason: 'provider_submission' }]);
    expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true, publishedAt: true } }))
      .toEqual({ status: 'processing', remotePostId: null, publishedAt: null });

    await expect(syncPostStatus(fixture.actor, fixture.postId)).resolves.toMatchObject({ synced: 1 });
    expect(integration.adapter.getRemoteStatus).toHaveBeenCalledTimes(2);
    expect(integration.adapter.publish).toHaveBeenCalledTimes(1);
    expect(await observer.$queryRaw<Array<{ state: string; remotePostId: string }>>`
      SELECT state, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
      .toEqual([{ state: 'projected', remotePostId: remoteId }]);
  });

  it('keeps a usable receipt when its returned URL is unsafe, and records an abort after dispatch as submitted evidence', async () => {
    const unsafeUrl = await createFixture();
    integration.adapter.publish.mockResolvedValue({ state: 'published', remoteId: 'provider-unsafe-url-id', url: 'https://user:pass@example.test/post' });
    await expect(publishPost(unsafeUrl.actor, unsafeUrl.postId)).resolves.toMatchObject({ published: 0, needsReconciliation: 1 });
    expect(await observer.$queryRaw<Array<{ state: string; reason: string; remotePostId: string; remoteUrl: string | null }>>`
      SELECT state, reason, "remotePostId", "remoteUrl" FROM rebuild_publication_attempts WHERE "workspaceId"=${unsafeUrl.workspaceId}`)
      .toEqual([{ state: 'submitted', reason: 'provider_submission', remotePostId: 'provider-unsafe-url-id', remoteUrl: null }]);
    expect(await observer.postTarget.findUnique({ where: { id: unsafeUrl.postTargetId }, select: { status: true, remotePostId: true, publishedAt: true } }))
      .toEqual({ status: 'processing', remotePostId: null, publishedAt: null });

    const aborted = await createFixture('synthetic');
    const controller = new AbortController();
    await expect(publishDestinationInOperation({ actor: aborted.actor, signal: controller.signal }, {
      postId: aborted.postId, postTargetId: aborted.postTargetId, targetId: aborted.targetId, provider: 'synthetic', expectedStatus: 'pending',
      dispatch: async () => { controller.abort(); return { state: 'published', remoteId: 'provider-receipt-after-abort', url: null }; },
      classifyFailure: () => 'uncertain',
    })).resolves.toBe('needs_review');
    expect(await observer.$queryRaw<Array<{ state: string; reason: string; remotePostId: string }>>`
      SELECT state, reason, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${aborted.workspaceId}`)
      .toEqual([{ state: 'submitted', reason: 'provider_submission', remotePostId: 'provider-receipt-after-abort' }]);
    expect(await observer.postTarget.findUnique({ where: { id: aborted.postTargetId }, select: { status: true, remotePostId: true, publishedAt: true } }))
      .toEqual({ status: 'processing', remotePostId: null, publishedAt: null });
  });

  it('preserves the original submitted URL and receipt timestamp when a manager attests the same identity', async () => {
    const fixture = await createFixture('synthetic');
    integration.adapter.publish.mockResolvedValue({ state: 'submitted', remoteId: 'provider-attested-id', url: 'https://example.test/original-receipt' });
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ needsReconciliation: 1 });
    const [before] = await observer.$queryRaw<Array<{ receiptAt: Date; remoteUrl: string }>>`
      SELECT "receiptAt", "remoteUrl" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`;

    const [attempt] = await observer.$queryRaw<Array<{ id: string }>>`SELECT id FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`;
    await client.$transaction(tx => recordPublicationOutcomeInTransaction(tx, fixture.userId, {
      workspaceId: fixture.workspaceId, operationId: attempt.id, outcome: 'PUBLISHED', remotePostId: 'provider-attested-id', remoteUrl: 'https://example.test/operator-claimed-url',
    }));
    const [after] = await observer.$queryRaw<Array<{ state: string; remoteUrl: string; receiptAt: Date; attestedAt: Date }>>`
      SELECT state, "remoteUrl", "receiptAt", "attestedAt" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`;
    expect(after).toMatchObject({ state: 'receipt_recorded', remoteUrl: before.remoteUrl, receiptAt: before.receiptAt });
    expect(after.attestedAt).toBeInstanceOf(Date);

    await expect(projectPublicationInOperation(fixture.actor, attempt.id, new AbortController().signal)).resolves.toBe(true);
    expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true, remoteUrl: true, publishedAt: true } }))
      .toEqual({ status: 'published', remotePostId: 'provider-attested-id', remoteUrl: before.remoteUrl, publishedAt: after.attestedAt });
  });

  it('retains a colliding provider receipt without linking or overwriting the existing post', async () => {
    const fixture = await createFixture('synthetic');
    const shadowPostId = `${fixture.prefix}_shadow_post`;
    const shadowPostTargetId = `${fixture.prefix}_shadow_post_target`;
    const collisionId = 'provider-already-linked';
    try {
      await client.post.create({ data: {
        id: shadowPostId, workspaceId: fixture.workspaceId, authorId: fixture.userId, message: 'Synthetic already-linked publication',
        firstComment: null, media: [], status: 'published', scheduledAt: null, publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      } });
      await client.postTarget.create({ data: {
        id: shadowPostTargetId, postId: shadowPostId, targetId: fixture.targetId, status: 'published', remotePostId: collisionId,
        remoteUrl: 'https://example.test/already-linked', publishedAt: new Date(),
      } });
      integration.adapter.publish.mockResolvedValue({ state: 'published', remoteId: collisionId, url: 'https://example.test/new-copy' });
      await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ published: 0, needsReconciliation: 1 });
      const [attempt] = await observer.$queryRaw<Array<{ id: string; state: string; reason: string; remotePostId: string }>>`
        SELECT id, state, reason, "remotePostId" FROM rebuild_publication_attempts
        WHERE "workspaceId"=${fixture.workspaceId} AND "postTargetId"=${fixture.postTargetId}`;
      expect(attempt).toMatchObject({ state: 'submitted', reason: 'provider_submission', remotePostId: collisionId });
      expect(await observer.$queryRaw<Array<{ identityConflict: boolean }>>`
        SELECT detail->>'identityConflict'='true' AS "identityConflict" FROM root_activities
        WHERE action='publishing.publication_submitted' AND detail->>'operationId'=${attempt.id}`)
        .toEqual([{ identityConflict: true }]);
      await expect(client.$transaction(tx => recordPublicationOutcomeInTransaction(tx, fixture.userId, {
        workspaceId: fixture.workspaceId, operationId: attempt.id, outcome: 'PUBLISHED', remotePostId: collisionId,
      }))).rejects.toMatchObject({ code: 'conflict' });
      await expect(projectPublicationInOperation(fixture.actor, attempt.id, new AbortController().signal))
        .rejects.toMatchObject({ code: 'conflict' });
      expect(await observer.postTarget.findUnique({ where: { id: shadowPostTargetId }, select: { status: true, remotePostId: true, remoteUrl: true } }))
        .toEqual({ status: 'published', remotePostId: collisionId, remoteUrl: 'https://example.test/already-linked' });
      expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true } }))
        .toEqual({ status: 'processing', remotePostId: null });
    } finally {
      await client.postTarget.deleteMany({ where: { id: shadowPostTargetId } });
      await client.post.deleteMany({ where: { id: shadowPostId } });
    }
  });

  it('persists an uncertain outcome when dispatch aborts and throws', async () => {
    const fixture = await createFixture('synthetic');
    const controller = new AbortController();
    await expect(publishDestinationInOperation({ actor: fixture.actor, signal: controller.signal }, {
      postId: fixture.postId, postTargetId: fixture.postTargetId, targetId: fixture.targetId, provider: 'synthetic', expectedStatus: 'pending',
      dispatch: async () => { controller.abort(); throw new Error('synthetic cancellation after dispatch'); },
      classifyFailure: () => 'uncertain',
    })).resolves.toBe('needs_review');
    expect(await observer.$queryRaw<Array<{ state: string; reason: string; remotePostId: string | null }>>`
      SELECT state, reason, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
      .toEqual([{ state: 'uncertain', reason: 'outcome_unknown', remotePostId: null }]);
    expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true, publishedAt: true } }))
      .toEqual({ status: 'processing', remotePostId: null, publishedAt: null });
  });

  it('blocks actual workspace database erasure while a submitted receipt remains unresolved', async () => {
    const fixture = await createFixture();
    integration.adapter.publish.mockResolvedValue({ state: 'submitted', remoteId: 'provider-submitted-erasure', url: null });
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ needsReconciliation: 1 });
    await expect(deleteWorkspaceData(fixture.actor, 'DELETE'))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(await observer.post.findUnique({ where: { id: fixture.postId }, select: { id: true } })).toEqual({ id: fixture.postId });
    expect(await observer.$queryRaw<Array<{ state: string }>>`SELECT state FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
      .toEqual([{ state: 'submitted' }]);
  });
  it.each(['missing-grant', 'expired', 'revoked', 'missing-token'])('does not create intent or dispatch with %s credentials', async condition => {
    const fixture = await createFixture();
    if (condition === 'missing-grant') integration.grantAllowed = false;
    if (condition === 'expired') await client.socialAccount.update({ where: { id: fixture.socialAccountId }, data: { tokenExpiresAt: new Date(0) } });
    if (condition === 'revoked') await client.socialAccount.update({ where: { id: fixture.socialAccountId }, data: { invalidatedAt: new Date() } });
    if (condition === 'missing-token') await client.target.update({ where: { id: fixture.targetId }, data: { accessToken: null } });
    const result = await publishPost(fixture.actor, fixture.postId);
    expect(result).toMatchObject({ published: 0, failed: 1, needsReconciliation: 0 });
    expect(await client.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`).toEqual([{ count: BigInt(0) }]);
    expect(await client.postTarget.findUnique({ where: { id: fixture.postTargetId }, select: { status: true, remotePostId: true } })).toEqual({ status: 'failed', remotePostId: null });
    expect(integration.adapter.publish).not.toHaveBeenCalled();
  });

});
