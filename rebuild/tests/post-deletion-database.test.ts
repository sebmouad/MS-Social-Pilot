import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  adapter: null as unknown as { deleteRemote: ReturnType<typeof vi.fn>; canUseCredential: ReturnType<typeof vi.fn> },
}));

vi.mock('../src/server/data', () => ({ get prisma() { return integration.prisma; } }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => ({
    'publishing.operationTimeoutMs': 60000, 'publishing.operationMaxWaitMs': 2000,
    'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000,
    'publishing.maxTargetsPerOperation': 5000, 'publishing.identifierMaxCharacters': 200,
    'publishing.deletionMaxAliases': 1000, 'data.workspaceOperationTimeoutMs': 300000,
    'data.workspaceOperationLockWaitMs': 30000,
  }[key]),
}));
vi.mock('../src/modules/publishing/server/access', () => ({
  authorizePublishing: async (actor: { userId: string; workspaceId: string; allowedTargetIds?: readonly string[] }) => ({ actor, role: 'owner', permissions: {}, entitlements: {} }),
}));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: (value: string) => value }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async () => integration.adapter }));

import { deletePost } from '../src/server/publishing/lifecycle';
import { finishPostDeletion, getPostDeletion, recordPostDeletionOutcome } from '../src/modules/publishing/server/deletion';

type Fixture = {
  prefix: string; workspaceId: string; userId: string; socialAccountId: string; targetIds: string[];
  postIds: string[]; postTargetIds: string[]; actor: { userId: string; workspaceId: string; allowedTargetIds: string[] };
};

describe.skipIf(!databaseUrl)('durable post deletion on isolated PostgreSQL', () => {
  let client: PrismaClient;
  let observer: PrismaClient;
  const fixtures: Fixture[] = [];

  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Post-deletion integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    observer = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    integration.prisma = client;
    resetAdapter();
  });

  beforeEach(() => resetAdapter());
  afterEach(async () => {
    integration.prisma = client;
    integration.adapter.deleteRemote.mockReset();
    integration.adapter.canUseCredential.mockReset().mockReturnValue(true);
    for (const fixture of fixtures.splice(0)) await cleanup(fixture);
  });
  afterAll(async () => { integration.prisma = client; await observer?.$disconnect(); await client?.$disconnect(); });

  function resetAdapter() {
    integration.adapter = {
      deleteRemote: vi.fn(async () => undefined),
      canUseCredential: vi.fn(() => true),
    };
  }

  async function createFixture(options: { destinations?: number; aliases?: number; unconnected?: boolean } = {}): Promise<Fixture> {
    const prefix = `preview_post_delete_${randomUUID().replaceAll('-', '')}`;
    const now = new Date();
    const fixture: Fixture = {
      prefix, workspaceId: `${prefix}_workspace`, userId: `${prefix}_user`, socialAccountId: `${prefix}_social`,
      targetIds: Array.from({ length: options.unconnected ? 0 : options.destinations ?? 1 }, (_, index) => `${prefix}_target_${index}`),
      postIds: Array.from({ length: (options.aliases ?? 0) + 1 }, (_, index) => `${prefix}_post_${index}`),
      postTargetIds: Array.from({ length: ((options.aliases ?? 0) + 1) * (options.destinations ?? 1) }, (_, index) => `${prefix}_post_target_${index}`),
      actor: { userId: `${prefix}_user`, workspaceId: `${prefix}_workspace`, allowedTargetIds: [] },
    };
    fixture.actor.allowedTargetIds = fixture.targetIds;
    fixtures.push(fixture);
    try {
      await client.user.create({ data: { id: fixture.userId, email: `${prefix}@example.test`, name: 'Synthetic deletion actor', passwordHash: 'unusable' } });
      await client.workspace.create({ data: { id: fixture.workspaceId, name: 'Post deletion fixture', slug: fixture.workspaceId, timezone: 'UTC' } });
      await client.membership.create({ data: { id: `${prefix}_membership`, userId: fixture.userId, workspaceId: fixture.workspaceId, role: 'owner' } });
      await client.socialAccount.create({ data: {
        id: fixture.socialAccountId, workspaceId: fixture.workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`,
        name: 'Synthetic source', accessToken: 'synthetic-token', scopes: '',
      } });
      for (let index = 0; index < fixture.targetIds.length; index++) await client.target.create({ data: {
        id: fixture.targetIds[index]!, workspaceId: fixture.workspaceId, socialAccountId: fixture.socialAccountId,
        type: 'page', providerId: `${prefix}_provider_page_${index}`, name: `Synthetic destination ${index + 1}`,
        accessToken: 'synthetic-token', enabled: true, canPublish: true, createdAt: now,
      } });
      let targetCursor = 0;
      for (let postIndex = 0; postIndex < fixture.postIds.length; postIndex++) {
        const postId = fixture.postIds[postIndex]!;
        await client.post.create({ data: {
          id: postId, workspaceId: fixture.workspaceId, authorId: fixture.userId, message: `Synthetic deletion post ${postIndex}`,
          firstComment: null, media: [], status: 'published', scheduledAt: null, publishedAt: now, createdAt: now, updatedAt: now,
        } });
        for (let targetIndex = 0; targetIndex < fixture.targetIds.length; targetIndex++) {
          const id = fixture.postTargetIds[targetCursor++]!;
          await client.postTarget.create({ data: {
            id, postId, targetId: fixture.targetIds[targetIndex]!, status: 'published', remotePostId: `provider-post-${targetIndex}`,
            publishedAt: now,
          } });
        }
      }
      return fixture;
    } catch (error) { await cleanup(fixture); throw error; }
  }

  async function cleanup(fixture: Fixture) {
    await client.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId' = ${fixture.workspaceId}`;
    await client.$executeRaw`DELETE FROM rebuild_post_deletions WHERE "workspaceId" = ${fixture.workspaceId}`;
    await client.postTarget.deleteMany({ where: { id: { in: fixture.postTargetIds } } });
    await client.post.deleteMany({ where: { id: { in: fixture.postIds } } });
    await client.target.deleteMany({ where: { id: { in: fixture.targetIds } } });
    await client.socialAccount.deleteMany({ where: { id: fixture.socialAccountId } });
    await client.membership.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await client.workspace.deleteMany({ where: { id: fixture.workspaceId } });
    await client.user.deleteMany({ where: { id: fixture.userId } });
  }

  it('keeps an uncertain remote attempt non-repeatable and blocks local cleanup', async () => {
    const fixture = await createFixture();
    integration.adapter.deleteRemote.mockRejectedValueOnce(new Error('synthetic transport ambiguity'));
    const first = await deletePost(fixture.actor, fixture.postIds[0]!, true);
    expect(first).toMatchObject({ state: 'needs_review', localConfirmed: false, operations: [{ state: 'uncertain', remoteConfirmed: false }] });
    const status = await getPostDeletion(fixture.actor, { postId: fixture.postIds[0]! });
    expect(status.operations[0]?.operationId).toBe(first.operations[0]?.operationId);
    await expect(deletePost(fixture.actor, fixture.postIds[0]!, true)).resolves.toMatchObject({ state: 'needs_review' });
    expect(integration.adapter.deleteRemote).toHaveBeenCalledTimes(1);
    expect(await observer.post.findUnique({ where: { id: fixture.postIds[0] } })).not.toBeNull();
  });

  it('keeps the committed started receipt if persisting provider acceptance fails', async () => {
    const fixture = await createFixture();
    const base = client;
    let rejected = false;
    integration.prisma = new Proxy(base, {
      get(target, property) {
        if (property !== '$transaction') {
          const value = Reflect.get(target, property, target) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (work: (tx: unknown) => Promise<unknown>, options?: object) => base.$transaction(async tx => {
          const wrapped = new Proxy(tx, {
            get(transaction, key) {
              if (key !== '$executeRaw') return Reflect.get(transaction, key, transaction) as unknown;
              return (strings: TemplateStringsArray, ...values: unknown[]) => {
                const query = strings.join('?');
                if (!rejected && query.includes("SET state = 'remote_confirmed'")) { rejected = true; throw new Error('synthetic receipt commit failure'); }
                return (Reflect.get(transaction, key, transaction) as (...args: unknown[]) => unknown).apply(transaction, [strings, ...values]);
              };
            },
          });
          return work(wrapped);
        }, options);
      },
    }) as PrismaClient;
    integration.adapter.deleteRemote.mockResolvedValue(undefined);
    const first = await deletePost(fixture.actor, fixture.postIds[0]!, true);
    integration.prisma = client;
    expect(first).toMatchObject({ state: 'needs_review', localConfirmed: false, operations: [{ state: 'started' }] });
    expect(await observer.post.findUnique({ where: { id: fixture.postIds[0] } })).not.toBeNull();
    await deletePost(fixture.actor, fixture.postIds[0]!, true);
    expect(integration.adapter.deleteRemote).toHaveBeenCalledTimes(1);
  });

  it('requires an exact external attestation, then finishes locally without another provider request', async () => {
    const fixture = await createFixture();
    integration.adapter.deleteRemote.mockRejectedValueOnce(new Error('synthetic timeout'));
    const uncertain = await deletePost(fixture.actor, fixture.postIds[0]!, true);
    const operationId = uncertain.operations[0]!.operationId;
    await expect(recordPostDeletionOutcome(fixture.actor, { postId: fixture.postIds[0]!, operationId, outcome: 'deleted', confirmation: 'wrong', verifiedOnPlatform: true })).rejects.toThrow();
    const recorded = await recordPostDeletionOutcome(fixture.actor, { postId: fixture.postIds[0]!, operationId, outcome: 'deleted', confirmation: `RECORD POST DELETION ${operationId} DELETED`, verifiedOnPlatform: true });
    expect(recorded).toMatchObject({ state: 'local_pending', localConfirmed: false, operations: [{ state: 'remote_confirmed' }] });
    const finished = await finishPostDeletion(fixture.actor, { postId: fixture.postIds[0]!, confirmation: `FINISH POST DELETION ${fixture.postIds[0]}` });
    expect(finished).toMatchObject({ state: 'completed', localConfirmed: true });
    expect(await observer.post.findUnique({ where: { id: fixture.postIds[0] } })).toBeNull();
    expect(integration.adapter.deleteRemote).toHaveBeenCalledTimes(1);
  });

  it('clears a confirmed remote identity across local aliases while retaining the other local post', async () => {
    const fixture = await createFixture({ aliases: 1 });
    const deleted = await deletePost(fixture.actor, fixture.postIds[0]!, true);
    expect(deleted).toMatchObject({ state: 'completed', localConfirmed: true });
    expect(await observer.post.findUnique({ where: { id: fixture.postIds[0] } })).toBeNull();
    const retained = await observer.post.findUnique({ where: { id: fixture.postIds[1] }, include: { targets: true } });
    expect(retained).not.toBeNull();
    expect(retained?.targets[0]).toMatchObject({ status: 'cancelled', remotePostId: null, remoteUrl: null });
    expect(integration.adapter.deleteRemote).toHaveBeenCalledTimes(1);
  });

  it('preserves partial multi-destination receipts and never retries the uncertain destination', async () => {
    const fixture = await createFixture({ destinations: 2 });
    integration.adapter.deleteRemote.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('second destination timed out'));
    const receipt = await deletePost(fixture.actor, fixture.postIds[0]!, true);
    expect(receipt).toMatchObject({ state: 'needs_review', localConfirmed: false, remoteDeletionRequested: true });
    expect(receipt.operations.map(operation => operation.state).sort()).toEqual(['remote_confirmed', 'uncertain'].sort());
    await deletePost(fixture.actor, fixture.postIds[0]!, true);
    expect(integration.adapter.deleteRemote).toHaveBeenCalledTimes(2);
    expect(await observer.post.findUnique({ where: { id: fixture.postIds[0] } })).not.toBeNull();
  });

  it('finishes a confirmed tombstone after the original local post is already gone', async () => {
    const fixture = await createFixture();
    integration.adapter.deleteRemote.mockRejectedValueOnce(new Error('synthetic timeout'));
    const uncertain = await deletePost(fixture.actor, fixture.postIds[0]!, true);
    const operationId = uncertain.operations[0]!.operationId;
    await observer.postTarget.deleteMany({ where: { postId: fixture.postIds[0] } });
    await observer.post.deleteMany({ where: { id: fixture.postIds[0] } });
    await recordPostDeletionOutcome(fixture.actor, { postId: fixture.postIds[0]!, operationId, outcome: 'deleted', confirmation: `RECORD POST DELETION ${operationId} DELETED`, verifiedOnPlatform: true });
    const finished = await finishPostDeletion(fixture.actor, { postId: fixture.postIds[0]!, confirmation: `FINISH POST DELETION ${fixture.postIds[0]}` });
    expect(finished).toMatchObject({ state: 'completed', localConfirmed: true, operations: [{ state: 'completed', remoteConfirmed: true }] });
    expect(integration.adapter.deleteRemote).toHaveBeenCalledTimes(1);
  });

  it('restricts unconnected local posts to their author when destination scope is constrained', async () => {
    const fixture = await createFixture({ unconnected: true });
    const authorRead = await getPostDeletion({ ...fixture.actor, allowedTargetIds: [] }, { postId: fixture.postIds[0]! });
    expect(authorRead).toMatchObject({ state: 'none', localConfirmed: false, operations: [] });
    await expect(getPostDeletion({ ...fixture.actor, userId: `${fixture.prefix}_other_user`, allowedTargetIds: [] }, { postId: fixture.postIds[0]! })).rejects.toThrow();
  });

  it('enforces workspace and destination scope, and never contacts a provider for local-only deletion', async () => {
    const fixture = await createFixture();
    await expect(getPostDeletion({ ...fixture.actor, workspaceId: `${fixture.prefix}_other_workspace` }, { postId: fixture.postIds[0]! })).rejects.toThrow();
    await expect(getPostDeletion({ ...fixture.actor, allowedTargetIds: [] }, { postId: fixture.postIds[0]! })).rejects.toThrow();
    const local = await deletePost(fixture.actor, fixture.postIds[0]!, false);
    expect(local).toMatchObject({ state: 'completed', localConfirmed: true, remoteDeletionRequested: false, operations: [] });
    expect(integration.adapter.deleteRemote).not.toHaveBeenCalled();
  });
  it('commits intent before dispatch and serializes concurrent requests', async () => {
    const fixture = await createFixture();
    let release!: () => void;
    let entered!: () => void;
    const dispatchEntered = new Promise<void>(resolve => { entered = resolve; });
    const dispatchRelease = new Promise<void>(resolve => { release = resolve; });
    integration.adapter.deleteRemote.mockImplementationOnce(async () => {
      const rows = await observer.rebuildPostDeletion.findMany({ where: { workspaceId: fixture.workspaceId } });
      expect(rows).toHaveLength(1); expect(rows[0]?.state).toBe('started');
      entered(); await dispatchRelease;
    });
    const first = deletePost(fixture.actor, fixture.postIds[0]!, true);
    try {
      await dispatchEntered;
      await expect(deletePost(fixture.actor, fixture.postIds[0]!, true)).rejects.toMatchObject({ code: 'conflict' });
    } finally { release(); }
    expect(await first).toMatchObject({ localConfirmed: true });
    expect(integration.adapter.deleteRemote).toHaveBeenCalledTimes(1);
  });

  it('retains rejected history and requires a separate request after NOT DELETED', async () => {
    const fixture = await createFixture();
    integration.adapter.deleteRemote.mockRejectedValueOnce(new Error('unconfirmed'));
    const first = await deletePost(fixture.actor, fixture.postIds[0]!, true);
    const operationId = first.operations[0]!.operationId;
    const recorded = await recordPostDeletionOutcome(fixture.actor, { postId: fixture.postIds[0]!, operationId, outcome: 'not_deleted', confirmation: `RECORD POST DELETION ${operationId} NOT DELETED`, verifiedOnPlatform: true });
    expect(recorded).toMatchObject({ state: 'none', localConfirmed: false });
    expect(integration.adapter.deleteRemote).toHaveBeenCalledTimes(1);
    const second = await deletePost(fixture.actor, fixture.postIds[0]!, true);
    expect(second.localConfirmed).toBe(true);
    expect(second.operations.map(row => row.state).sort()).toEqual(['completed', 'rejected']);
    expect(new Set(second.operations.map(row => row.operationId)).size).toBe(2);
    expect(integration.adapter.deleteRemote).toHaveBeenCalledTimes(2);
  });

  it('preflights every fresh destination before committing intent or dispatching', async () => {
    const fixture = await createFixture({ destinations: 2 });
    await client.target.update({ where: { id: fixture.targetIds[1] }, data: { enabled: false } });
    await expect(deletePost(fixture.actor, fixture.postIds[0]!, true)).rejects.toThrow();
    expect(integration.adapter.deleteRemote).not.toHaveBeenCalled();
    expect(await observer.rebuildPostDeletion.count({ where: { workspaceId: fixture.workspaceId } })).toBe(0);
  });

  it('retains confirmed evidence when atomic local cleanup/audit rolls back', async () => {
    const fixture = await createFixture();
    let failed = false;
    integration.prisma = new Proxy(client, { get(target, property) {
      if (property !== '$transaction') {
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (work: (tx: unknown) => Promise<unknown>, options?: object) => client.$transaction(async tx => work(new Proxy(tx, { get(transaction, key) {
        if (key !== '$executeRaw') return Reflect.get(transaction, key, transaction) as unknown;
        return (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (!failed && values.includes('publishing.post_deleted')) { failed = true; throw new Error('synthetic local audit failure'); }
          return (Reflect.get(transaction, key, transaction) as (...args: unknown[]) => unknown).apply(transaction, [strings, ...values]);
        };
      } })), options);
    } }) as PrismaClient;
    const receipt = await deletePost(fixture.actor, fixture.postIds[0]!, true);
    integration.prisma = client;
    expect(receipt).toMatchObject({ state: 'local_pending', localConfirmed: false, operations: [{ state: 'remote_confirmed' }] });
    expect(await observer.postTarget.findUnique({ where: { id: fixture.postTargetIds[0] } })).toMatchObject({ status: 'published', remotePostId: 'provider-post-0' });
    expect(await finishPostDeletion(fixture.actor, { postId: fixture.postIds[0]!, confirmation: `FINISH POST DELETION ${fixture.postIds[0]}` })).toMatchObject({ localConfirmed: true });
    expect(integration.adapter.deleteRemote).toHaveBeenCalledTimes(1);
  });

});
