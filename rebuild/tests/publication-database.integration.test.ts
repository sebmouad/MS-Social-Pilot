import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';
import type { PublishingFormatDescriptor } from '../src/platforms/types';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  adapter: null as unknown as { publish: ReturnType<typeof vi.fn>; publishFirstComment: ReturnType<typeof vi.fn>; classifyPublishingFailure: ReturnType<typeof vi.fn>; supportsTargetKind: ReturnType<typeof vi.fn>; canUseCredential: ReturnType<typeof vi.fn>; publishingFormats: readonly PublishingFormatDescriptor[]; defaultPublishingFormatId: string },
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
vi.mock('../src/modules/publishing/server/read-scope', () => ({
  selectedPublishingTargetIds: async (_workspaceId: string, _entitlements: unknown, allowed?: readonly string[]) => allowed ? [...allowed] : [integration.targetId],
  publishingPostVisibilityWhere: (workspaceId: string, ids: readonly string[], authorId?: string) => ({
    workspaceId,
    targets: { some: { targetId: { in: [...ids] } }, every: { targetId: { in: [...ids] } } },
    ...(authorId ? { authorId } : {}),
  }),
}));

import { publishPost } from '../src/server/publishing/lifecycle';
import { projectPublicationInOperation, recordPublicationOutcome, recordPublicationOutcomeInTransaction } from '../src/modules/publishing/server/publication';

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
      publish: vi.fn(async () => ({ remoteId: `provider-post-${randomUUID()}`, url: 'https://example.test/post' })),
      publishFirstComment: vi.fn(async () => ({ remoteId: 'provider-comment' })),
      classifyPublishingFailure: vi.fn(() => 'uncertain'),
      supportsTargetKind: vi.fn(() => true),
      publishingFormats: [{ id: 'post', label: 'Post', media: { kinds: ['image', 'video'], maxImages: null, maxVideos: null, mixedKinds: false, linkWithMedia: false, imageAltText: true }, firstComment: true, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } }],
      defaultPublishingFormatId: 'post',
    };
  }

  async function createFixture(): Promise<Fixture> {
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
        id: fixture.socialAccountId, workspaceId: fixture.workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`,
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
    integration.adapter.publish.mockResolvedValue({remoteId:'synthetic-format-receipt',url:null});
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
      return { remoteId: 'provider-post-concurrent', url: null };
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
    integration.adapter.publish.mockResolvedValue({ remoteId: 'provider-post-recoverable', url: 'https://example.test/receipt' });
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

    integration.adapter.publish.mockResolvedValueOnce({ remoteId: 'provider-post-after-absence', url: null });
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ published: 1, needsReconciliation: 0 });
    expect(integration.adapter.publish).toHaveBeenCalledTimes(2);
    expect(await observer.$queryRaw<Array<{ state: string; remotePostId: string | null }>>`SELECT state, "remotePostId" FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId} ORDER BY "createdAt", id`)
      .toMatchObject([{ state: 'attested_absent', remotePostId: null }, { state: 'projected', remotePostId: 'provider-post-after-absence' }]);
  });

  it('records an explicit adapter rejection as rejected and permits the next deliberate call', async () => {
    const fixture = await createFixture();
    integration.adapter.publish.mockRejectedValueOnce(new Error('synthetic definitive rejection'))
      .mockResolvedValueOnce({ remoteId: 'provider-post-retry', url: null });
    integration.adapter.classifyPublishingFailure.mockReturnValueOnce('rejected');
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ failed: 1, needsReconciliation: 0 });
    expect(await observer.$queryRaw<Array<{ state: string; reason: string }>>`SELECT state, reason FROM rebuild_publication_attempts WHERE "workspaceId"=${fixture.workspaceId}`)
      .toEqual([{ state: 'rejected', reason: 'provider_rejected' }]);
    await expect(publishPost(fixture.actor, fixture.postId)).resolves.toMatchObject({ published: 1 });
    expect(integration.adapter.publish).toHaveBeenCalledTimes(2);
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
