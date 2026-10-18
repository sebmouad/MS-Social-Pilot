import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, type Prisma } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const state = vi.hoisted(() => ({ prisma: null as unknown as PrismaClient, targetId: '', publishingMedia: { kinds: ['image', 'video'], maxImages: null, maxVideos: 1, mixedKinds: false, linkWithMedia: false, imageAltText: true } }));
vi.mock('../src/server/data', () => ({ get prisma() { return state.prisma; } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => ({
  'publishing.operationTimeoutMs': 60000, 'publishing.operationMaxWaitMs': 2000, 'publishing.transactionTimeoutMs': 15000,
  'publishing.transactionMaxWaitMs': 5000, 'publishing.maxTargetsPerOperation': 5000, 'publishing.identifierMaxCharacters': 200,
  'publishing.maxMessageCharacters': 10000, 'publishing.maxImportRows': 100, 'publishing.maxImportBytes': 1000000,
  'publishing.maxTargetsPerPost': 20, 'publishing.maxRemoteMediaPerPost': 4, 'publishing.maxImageAltCharacters': 500,
  'publishing.collab.versionRetention': 50,
  'data.workspaceOperationTimeoutMs': 300000, 'data.workspaceOperationLockWaitMs': 30000,
}[key]) }));
vi.mock('../src/modules/publishing/server/access', () => ({ authorizePublishing: async (actor: unknown) => ({ actor, role: 'owner', permissions: {}, entitlements: {} }) }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({ modules: { publishing: true } }), hasPlatformCapability: () => true }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async () => ({ publish: {}, publishFirstComment: {}, supportsTargetKind: () => true, publishingMedia: state.publishingMedia, localImageUpload: null }) }));
vi.mock('../src/server/platforms/resource-visibility', () => ({ selectedResourceConnectionWhere: async () => ({ selected: true }) }));
vi.mock('../src/modules/publishing/server/read-scope', () => ({
  selectedPublishingTargetIds: async (_workspaceId: string, _entitlements: unknown, allowed?: readonly string[]) => allowed ? [...allowed] : [state.targetId],
  publishingPostVisibilityWhere: (workspaceId: string, ids: readonly string[]) => ({ workspaceId, targets: { some: { targetId: { in: [...ids] } }, every: { targetId: { in: [...ids] } } } }),
}));

import { duplicatePost } from '../src/modules/publishing/server/duplicate';

type Fixture = { workspaceId: string; userId: string; socialId: string; targetId: string; sourceId: string; actor: { userId: string; workspaceId: string; allowedTargetIds: string[] } };
function failTransactionSql(base: PrismaClient, needle: string, message: string): PrismaClient {
  return new Proxy(base, { get(target, prop) {
    if (prop !== '$transaction') { const value = Reflect.get(target, prop, target) as unknown; return typeof value === 'function' ? value.bind(target) : value; }
    return (work: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) => base.$transaction(async tx => {
      const wrapped = new Proxy(tx, { get(transaction, key) {
        if (key === '$executeRaw') return (...args: unknown[]) => {
          const sql = (args[0] as TemplateStringsArray).join('');
          if (sql.includes(needle)) throw new Error(message);
          const execute = Reflect.get(transaction, key, transaction) as (...values: unknown[]) => unknown;
          return execute.apply(transaction, args);
        };
        return Reflect.get(transaction, key, transaction);
      } }) as PrismaClient;
      return work(wrapped);
    }, options);
  } }) as PrismaClient;
}
describe.skipIf(!databaseUrl)('post duplication on isolated PostgreSQL', () => {
  let client: PrismaClient;
  const fixtures: Fixture[] = [];
  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) throw new Error('Post duplication integration writes require an isolated loopback _preview database.');
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } }); state.prisma = client;
  });
  afterEach(async () => { state.prisma = client; for (const f of fixtures.splice(0)) await cleanup(f); });
  afterAll(async () => { await client?.$disconnect(); });
  async function createFixture(): Promise<Fixture> {
    const p = `preview_post_duplicate_${randomUUID().replaceAll('-', '')}`; const now = new Date();
    const f: Fixture = { workspaceId: `${p}_w`, userId: `${p}_u`, socialId: `${p}_s`, targetId: `${p}_t`, sourceId: `${p}_p`, actor: { userId: `${p}_u`, workspaceId: `${p}_w`, allowedTargetIds: [`${p}_t`] } };
    fixtures.push(f); state.targetId = f.targetId;
    await client.user.create({ data: { id: f.userId, email: `${p}@example.test`, name: 'Synthetic duplicate actor', passwordHash: 'unusable' } });
    await client.workspace.create({ data: { id: f.workspaceId, name: 'Synthetic duplicate workspace', slug: f.workspaceId, timezone: 'UTC' } });
    await client.membership.create({ data: { id: `${p}_m`, userId: f.userId, workspaceId: f.workspaceId, role: 'owner' } });
    await client.socialAccount.create({ data: { id: f.socialId, workspaceId: f.workspaceId, provider: 'facebook', providerUserId: `${p}_provider`, name: 'Synthetic destination', accessToken: 'synthetic-token', scopes: '' } });
    await client.target.create({ data: { id: f.targetId, workspaceId: f.workspaceId, socialAccountId: f.socialId, type: 'page', providerId: `${p}_page`, name: 'Synthetic page', accessToken: 'synthetic-token', enabled: true, canPublish: true, createdAt: now } });
    await client.post.create({ data: { id: f.sourceId, workspaceId: f.workspaceId, authorId: f.userId, message: 'Synthetic source message', firstComment: 'Synthetic first comment', link: null, media: [{ kind: 'image', url: 'https://example.test/image.jpg', altText: 'Synthetic image' }], status: 'published', scheduledAt: null, publishedAt: now, createdAt: now, updatedAt: now,
      targets: { create: { id: `${p}_pt`, targetId: f.targetId, status: 'published', remotePostId: 'remote-secret', firstCommentId: 'comment-secret', firstCommentAt: now, firstCommentError: 'old error', publishedAt: now } } } });
    return f;
  }
  async function cleanup(f: Fixture) {
    await client.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId' = ${f.workspaceId}`;
    await client.postTarget.deleteMany({ where: { post: { workspaceId: f.workspaceId } } });
    await client.post.deleteMany({ where: { workspaceId: f.workspaceId } });
    await client.target.deleteMany({ where: { workspaceId: f.workspaceId } });
    await client.socialAccount.deleteMany({ where: { workspaceId: f.workspaceId } });
    await client.membership.deleteMany({ where: { workspaceId: f.workspaceId } });
    await client.workspace.deleteMany({ where: { id: f.workspaceId } });
    await client.user.deleteMany({ where: { id: f.userId } });
  }
  it('copies content into a clean pending draft, replays one receipt, and rolls back a failed audit', async () => {
    const f = await createFixture(); const requestId = randomUUID();
    const result = await duplicatePost(f.actor, { postId: f.sourceId, requestId, confirmation: `DUPLICATE POST ${f.sourceId}` });
    expect(result).toEqual({ sourcePostId: f.sourceId, postId: requestId, draftCreated: true, replayed: false });
    const copy = await client.post.findUniqueOrThrow({ where: { id: requestId }, include: { targets: { include: { comments: true } } } });
    expect(copy).toMatchObject({ message: 'Synthetic source message', firstComment: 'Synthetic first comment', media: [{ kind: 'image', url: 'https://example.test/image.jpg', altText: 'Synthetic image' }], status: 'draft', scheduledAt: null, publishedAt: null });
    expect(copy.targets).toHaveLength(1);
    expect(copy.targets[0]).toMatchObject({ targetId: f.targetId, status: 'pending', remotePostId: null, remoteUrl: null, firstCommentId: null, firstCommentAt: null, firstCommentError: null, publishedAt: null, comments: [] });
    await expect(duplicatePost(f.actor, { postId: f.sourceId, requestId, confirmation: `DUPLICATE POST ${f.sourceId}` })).resolves.toMatchObject({ replayed: true });
    expect(await client.post.count({ where: { workspaceId: f.workspaceId } })).toBe(2);
    expect(await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM post_versions WHERE "postId" = ${requestId}`).toEqual([{ count: BigInt(1) }]);

    const rollbackId = randomUUID();
    state.prisma = failTransactionSql(client, 'INSERT INTO root_activities', 'synthetic audit insertion failure');
    await expect(duplicatePost(f.actor, { postId: f.sourceId, requestId: rollbackId, confirmation: `DUPLICATE POST ${f.sourceId}` })).rejects.toThrow('synthetic audit insertion failure');
    state.prisma = client;
    expect(await client.post.findUnique({ where: { id: rollbackId } })).toBeNull();
    expect(await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM post_versions WHERE "postId" = ${rollbackId}`).toEqual([{ count: BigInt(0) }]);
    expect(await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE id = ${`duplicate:${rollbackId}`}`).toEqual([{ count: BigInt(0) }]);

    const historyRollbackId = randomUUID();
    state.prisma = failTransactionSql(client, 'INSERT INTO post_versions', 'synthetic history insertion failure');
    await expect(duplicatePost(f.actor, { postId: f.sourceId, requestId: historyRollbackId, confirmation: `DUPLICATE POST ${f.sourceId}` })).rejects.toThrow('synthetic history insertion failure');
    state.prisma = client;
    expect(await client.post.findUnique({ where: { id: historyRollbackId } })).toBeNull();
    expect(await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM post_versions WHERE "postId" = ${historyRollbackId}`).toEqual([{ count: BigInt(0) }]);
    expect(await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE id = ${`duplicate:${historyRollbackId}`}`).toEqual([{ count: BigInt(0) }]);
  });

  it('rejects an existing unrelated draft ID without overwriting it or claiming a receipt', async () => {
    const f = await createFixture(); const requestId = randomUUID();
    await client.post.create({ data: { id: requestId, workspaceId: f.workspaceId, authorId: f.userId, message: 'Unrelated existing draft', media: [], status: 'draft', createdAt: new Date(), updatedAt: new Date() } });
    await expect(duplicatePost(f.actor, { postId: f.sourceId, requestId, confirmation: `DUPLICATE POST ${f.sourceId}` })).rejects.toMatchObject({ code: 'conflict' });
    expect(await client.post.count({ where: { workspaceId: f.workspaceId } })).toBe(2);
    expect(await client.post.findUnique({ where: { id: requestId }, select: { message: true } })).toEqual({ message: 'Unrelated existing draft' });
    expect(await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE id = ${`duplicate:${requestId}`}`).toEqual([{ count: BigInt(0) }]);
  });

  it('rejects duplicating a link and media combination before inserting a draft or receipt', async () => {
    const f = await createFixture(); const requestId = randomUUID();
    await client.post.update({ where: { id: f.sourceId }, data: { link: 'https://example.test/story' } });
    await expect(duplicatePost(f.actor, { postId: f.sourceId, requestId, confirmation: `DUPLICATE POST ${f.sourceId}` }))
      .rejects.toMatchObject({ code: 'invalid_request', message: 'This destination cannot combine a link with media in one post.' });
    expect(await client.post.count({ where: { workspaceId: f.workspaceId } })).toBe(1);
    expect(await client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE id = ${`duplicate:${requestId}`}`).toEqual([{ count: BigInt(0) }]);
  });

  it('copies attachment-only content and rejects a first-comment-only source', async () => {
    const f = await createFixture();
    await client.post.update({ where: { id: f.sourceId }, data: { message: '   ', firstComment: null } });
    const mediaRequestId = randomUUID();
    await duplicatePost(f.actor, { postId: f.sourceId, requestId: mediaRequestId, confirmation: `DUPLICATE POST ${f.sourceId}` });
    expect(await client.post.findUnique({ where: { id: mediaRequestId }, select: { message: true, media: true } })).toMatchObject({ message: '', media: [{ kind: 'image' }] });

    await client.post.update({ where: { id: f.sourceId }, data: { media: [], link: 'https://example.test/story' } });
    const linkRequestId = randomUUID();
    await duplicatePost(f.actor, { postId: f.sourceId, requestId: linkRequestId, confirmation: `DUPLICATE POST ${f.sourceId}` });
    expect(await client.post.findUnique({ where: { id: linkRequestId }, select: { message: true, link: true } })).toEqual({ message: '', link: 'https://example.test/story' });

    await client.post.update({ where: { id: f.sourceId }, data: { link: null, firstComment: 'Only a comment' } });
    await expect(duplicatePost(f.actor, { postId: f.sourceId, requestId: randomUUID(), confirmation: `DUPLICATE POST ${f.sourceId}` })).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('denies cross-workspace and out-of-scope source IDs in PostgreSQL', async () => {
    const f = await createFixture();
    await expect(duplicatePost(f.actor, { postId: 'other-workspace-private-post', requestId: randomUUID(), confirmation: 'DUPLICATE POST other-workspace-private-post' })).rejects.toMatchObject({ code: 'not_found' });
    const scopedActor = { ...f.actor, allowedTargetIds: [] };
    await expect(duplicatePost(scopedActor, { postId: f.sourceId, requestId: randomUUID(), confirmation: `DUPLICATE POST ${f.sourceId}` })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await client.post.count({ where: { workspaceId: f.workspaceId } })).toBe(1);
  });
});
