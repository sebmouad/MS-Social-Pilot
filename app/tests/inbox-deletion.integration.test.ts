import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, type Prisma } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const integration = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  allowedChannelIds: [] as string[],
  authFailure: false,
  dispatch: null as null | (() => Promise<void>),
  prepareCount: 0,
  failNextAudit: false,
}));

vi.mock('../src/server/data', () => ({ get prisma() { return integration.prisma; } }));
vi.mock('../src/modules/inbox/server/access', () => ({
  authorizeInbox: async (_actor: unknown, _constraints: unknown, _mode: unknown) => {
    if (integration.authFailure) throw Object.assign(new Error('Current Inbox grant denied'), { code: 'unauthorized' });
    return {
      channels: integration.allowedChannelIds.map(id => ({ id, name: id })),
      channelIds: [...integration.allowedChannelIds],
      timeZone: 'UTC',
    };
  },
}));
vi.mock('../src/server/platforms/registry', () => ({
  platformInbox: async () => ({
    prepareDeleteComment: async () => {
      integration.prepareCount += 1;
      const dispatch = integration.dispatch;
      if (!dispatch) throw new Error('No controlled dispatch was configured.');
      return dispatch;
    },
  }),
}));

import { deleteInboxCommentDurably, finishInboxDeletion, getInboxDeletion } from '../src/modules/inbox/server/deletion';
import { inboxCommentSuppressed, orderInboxCommentBatch } from '../src/modules/inbox/server/comment-guard';

type Fixture = {
  prefix: string;
  workspaceId: string;
  foreignWorkspaceId: string;
  userId: string;
  targetId: string;
  foreignTargetId: string;
  itemIds: string[];
  replyIds: string[];
  remoteId: string;
  actor: { userId: string; workspaceId: string };
};

describe.skipIf(!databaseUrl)('durable Inbox comment deletion on isolated PostgreSQL', () => {
  let client: PrismaClient;
  let observer: PrismaClient;

  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Inbox deletion integration writes require an isolated loopback _preview database.');
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

  async function createFixture(aliasCount = 2): Promise<Fixture> {
    const prefix = `preview_inbox_delete_${randomUUID().replaceAll('-', '')}`;
    const now = new Date('2026-10-16T12:00:00.000Z');
    const fixture: Fixture = {
      prefix,
      workspaceId: `${prefix}_workspace`,
      foreignWorkspaceId: `${prefix}_foreign_workspace`,
      userId: `${prefix}_user`,
      targetId: `${prefix}_target`,
      foreignTargetId: `${prefix}_foreign_target`,
      itemIds: Array.from({ length: aliasCount }, (_, index) => `${prefix}_item_${index}`),
      replyIds: Array.from({ length: aliasCount }, (_, index) => `${prefix}_reply_${index}`),
      remoteId: `${prefix}_remote`,
      actor: { userId: `${prefix}_user`, workspaceId: `${prefix}_workspace` },
    };
    try {
      await client.user.create({ data: { id: fixture.userId, email: `${prefix}@example.test`, name: 'Deletion fixture actor', passwordHash: 'unusable' } });
      await client.workspace.createMany({ data: [
        { id: fixture.workspaceId, name: 'Inbox deletion fixture', slug: fixture.workspaceId, timezone: 'UTC' },
        { id: fixture.foreignWorkspaceId, name: 'Foreign Inbox deletion fixture', slug: fixture.foreignWorkspaceId, timezone: 'UTC' },
      ] });
      await client.membership.create({ data: { id: `${prefix}_membership`, userId: fixture.userId, workspaceId: fixture.workspaceId, role: 'owner' } });
      await client.socialAccount.createMany({ data: [
        { id: `${prefix}_social`, workspaceId: fixture.workspaceId, provider: 'facebook', providerUserId: `${prefix}_provider`, name: 'Deletion test source', accessToken: 'synthetic-test-token', scopes: '' },
        { id: `${prefix}_foreign_social`, workspaceId: fixture.foreignWorkspaceId, provider: 'facebook', providerUserId: `${prefix}_foreign_provider`, name: 'Foreign deletion test source', accessToken: '', scopes: '' },
      ] });
      await client.target.createMany({ data: [
        { id: fixture.targetId, workspaceId: fixture.workspaceId, socialAccountId: `${prefix}_social`, type: 'page', providerId: `${prefix}_provider_page`, name: 'Selected fixture channel', enabled: true, canPublish: true, createdAt: now },
        { id: fixture.foreignTargetId, workspaceId: fixture.foreignWorkspaceId, socialAccountId: `${prefix}_foreign_social`, type: 'page', providerId: `${prefix}_foreign_page`, name: 'Foreign fixture channel', enabled: true, canPublish: true, createdAt: now },
      ] });
      const posts = Array.from({ length: aliasCount + 1 }, (_, index) => ({
        id: `${prefix}_post_${index}`, workspaceId: fixture.workspaceId, authorId: fixture.userId,
        message: 'Synthetic deletion integration fixture', status: 'published' as const, createdAt: now, updatedAt: now,
      }));
      posts.push({ id: `${prefix}_foreign_post`, workspaceId: fixture.foreignWorkspaceId, authorId: fixture.userId, message: 'Synthetic foreign fixture', status: 'published', createdAt: now, updatedAt: now });
      await client.post.createMany({ data: posts });
      const postTargets = posts.map((post, index) => ({
        id: `${prefix}_post_target_${index}`, postId: post.id,
        targetId: post.id === `${prefix}_foreign_post` ? fixture.foreignTargetId : fixture.targetId,
        status: 'published' as const,
      }));
      await client.postTarget.createMany({ data: postTargets });
      await client.postComment.createMany({ data: [
        ...fixture.itemIds.map((id, index) => ({ id, postTargetId: `${prefix}_post_target_${index}`, remoteId: fixture.remoteId, message: 'Synthetic parent comment', createdTime: now, fetchedAt: now, firstSeenAt: now })),
        ...fixture.replyIds.map((id, index) => ({ id, postTargetId: `${prefix}_post_target_${index}`, remoteId: `${prefix}_reply_remote_${index}`, parentRemoteId: fixture.remoteId, message: 'Synthetic direct reply', createdTime: now, fetchedAt: now, firstSeenAt: now })),
        { id: `${prefix}_foreign_item`, postTargetId: `${prefix}_post_target_${aliasCount + 1}`, remoteId: `${prefix}_foreign_remote`, message: 'Synthetic foreign comment', createdTime: now, fetchedAt: now, firstSeenAt: now },
      ] });
      return fixture;
    } catch (error) {
      await cleanup(fixture);
      throw error;
    }
  }

  async function cleanup(fixture: Fixture) {
    await client.$executeRaw`DELETE FROM root_activities WHERE detail->>'workspaceId' = ${fixture.workspaceId}`;
    await client.$executeRaw`DELETE FROM rebuild_inbox_deletions WHERE "workspaceId" = ${fixture.workspaceId}`;
    await client.postComment.deleteMany({ where: { id: { startsWith: fixture.prefix } } });
    await client.postTarget.deleteMany({ where: { id: { startsWith: fixture.prefix } } });
    await client.post.deleteMany({ where: { id: { startsWith: fixture.prefix } } });
    await client.conversation.deleteMany({ where: { targetId: { in: [fixture.targetId, fixture.foreignTargetId] } } });
    await client.target.deleteMany({ where: { id: { in: [fixture.targetId, fixture.foreignTargetId] } } });
    await client.socialAccount.deleteMany({ where: { id: { startsWith: fixture.prefix } } });
    await client.membership.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await client.workspace.deleteMany({ where: { id: { in: [fixture.workspaceId, fixture.foreignWorkspaceId] } } });
    await client.user.deleteMany({ where: { id: fixture.userId } });
  }

  function prepare(fixture: Fixture, dispatch: () => Promise<void>) {
    integration.allowedChannelIds = [fixture.targetId];
    integration.authFailure = false;
    integration.dispatch = dispatch;
    integration.prepareCount = 0;
    integration.failNextAudit = false;
  }

  const deleteItem = (fixture: Fixture, id = fixture.itemIds[0]!) => deleteInboxCommentDurably(fixture.actor, {
    id, confirmation: `DELETE COMMENT ${id}`,
  });

  it('commits intent before dispatch and retains one uncertain claim across repeat and alias requests', async () => {
    const fixture = await createFixture();
    let calls = 0;
    prepare(fixture, async () => {
      calls += 1;
      const rows = await observer.$queryRaw<Array<{ state: string; localItemId: string }>>`SELECT state, "localItemId" FROM rebuild_inbox_deletions WHERE "workspaceId" = ${fixture.workspaceId}`;
      expect(rows).toEqual([{ state: 'started', localItemId: fixture.itemIds[0] }]);
      throw new Error('Synthetic lost response after provider dispatch.');
    });
    try {
      await expect(deleteItem(fixture)).resolves.toMatchObject({ ok: true, state: 'uncertain', remoteConfirmed: false, localConfirmed: false });
      await expect(deleteItem(fixture)).resolves.toMatchObject({ state: 'uncertain' });
      await expect(deleteItem(fixture, fixture.itemIds[1]!)).resolves.toMatchObject({ state: 'uncertain' });
      await expect(getInboxDeletion(fixture.actor, { itemId: fixture.itemIds[1]! })).resolves.toMatchObject({ operation: { itemId: fixture.itemIds[1], state: 'uncertain' } });
      const rows = await observer.$queryRaw<Array<{ state: string; reason: string; id: string }>>`SELECT state, reason, id FROM rebuild_inbox_deletions WHERE "workspaceId" = ${fixture.workspaceId}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: 'uncertain', reason: 'transport_unconfirmed' });
      expect(calls).toBe(1);
      expect(integration.prepareCount).toBe(1);
      const suppression = await client.$transaction(async tx => Promise.all([
        inboxCommentSuppressed(tx, fixture.workspaceId, fixture.targetId, fixture.remoteId),
        inboxCommentSuppressed(tx, fixture.workspaceId, fixture.targetId, `${fixture.prefix}_reply_remote_0`, fixture.remoteId),
        inboxCommentSuppressed(tx, fixture.workspaceId, fixture.targetId, `${fixture.prefix}_unrelated`),
      ]));
      expect(suppression).toEqual([true, true, false]);

      await expect(deleteItem(fixture, `${fixture.prefix}_foreign_item`)).rejects.toMatchObject({ code: 'not_found' });
      integration.allowedChannelIds = [];
      await expect(deleteItem(fixture)).rejects.toMatchObject({ code: 'not_found' });
      await expect(deleteItem(fixture, `${fixture.prefix}_foreign_item`)).rejects.toMatchObject({ code: 'not_found' });
      integration.authFailure = true;
      await expect(deleteItem(fixture)).rejects.toMatchObject({ code: 'unauthorized' });
      expect(calls).toBe(1);
    } finally {
      integration.allowedChannelIds = [];
      integration.authFailure = false;
      integration.dispatch = null;
      await cleanup(fixture);
    }
  });

  it('keeps remote confirmation when local cleanup audit rolls back, then finishes locally once', async () => {
    const fixture = await createFixture();
    let calls = 0;
    prepare(fixture, async () => { calls += 1; });
    await client.postComment.create({ data: { id: `${fixture.prefix}_grandchild`, postTargetId: `${fixture.prefix}_post_target_0`, remoteId: `${fixture.prefix}_grandchild_remote`, parentRemoteId: `${fixture.prefix}_reply_remote_0`, message: 'Synthetic nested reply', createdTime: new Date(), fetchedAt: new Date(), firstSeenAt: new Date() } });
    const wrapAuditFault = <T extends object>(database: T): T => new Proxy(database, {
      get(target, property) {
        if (property === '$transaction') {
          const transaction = (Reflect.get(target, property, target) as (...args: unknown[]) => Promise<unknown>).bind(target);
          return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, ...options: unknown[]) => transaction((tx: Prisma.TransactionClient) => callback(wrapAuditFault(tx)), ...options);
        }
        if (property === '$executeRaw') {
          const execute = (Reflect.get(target, property, target) as (...args: unknown[]) => unknown).bind(target);
          return (strings: TemplateStringsArray, ...values: unknown[]) => {
            if (integration.failNextAudit && strings.join('').includes('inbox.comment_deleted')) {
              integration.failNextAudit = false;
              throw new Error('Synthetic Inbox deletion audit failure.');
            }
            return execute(strings, ...values);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      integration.prisma = wrapAuditFault(client);
      integration.failNextAudit = true;
      const result = await deleteItem(fixture);
      expect(result).toMatchObject({ ok: true, state: 'remote_confirmed', remoteConfirmed: true, localConfirmed: false });
      const beforeRecovery = await observer.$queryRaw<Array<{ state: string; remoteConfirmedAt: Date | null; completedAt: Date | null }>>`SELECT state, "remoteConfirmedAt", "completedAt" FROM rebuild_inbox_deletions WHERE "workspaceId" = ${fixture.workspaceId}`;
      expect(beforeRecovery[0]).toMatchObject({ state: 'remote_confirmed', completedAt: null });
      expect(beforeRecovery[0]?.remoteConfirmedAt).toBeInstanceOf(Date);
      expect(await client.postComment.count({ where: { id: { in: [...fixture.itemIds, ...fixture.replyIds] } } })).toBe(fixture.itemIds.length + fixture.replyIds.length);
      integration.prisma = client;

      const recovered = await finishInboxDeletion(fixture.actor, { operationId: result.operationId, confirmation: `FINISH DELETION ${result.operationId}` });
      expect(recovered).toMatchObject({ ok: true, state: 'completed', remoteConfirmed: true, localConfirmed: true });
      await expect(finishInboxDeletion(fixture.actor, { operationId: result.operationId, confirmation: `FINISH DELETION ${result.operationId}` }))
        .resolves.toMatchObject({ state: 'completed' });
      expect(calls).toBe(1);
      expect(await client.postComment.count({ where: { id: { in: [...fixture.itemIds, ...fixture.replyIds] } } })).toBe(0);
      expect(await client.postComment.count({ where: { id: `${fixture.prefix}_grandchild` } })).toBe(0);
      await expect(getInboxDeletion(fixture.actor, { itemId: fixture.itemIds[1]! })).resolves.toMatchObject({ operation: { state: 'completed', itemId: fixture.itemIds[1], localConfirmed: true } });
      expect(await client.$transaction(tx => inboxCommentSuppressed(tx, fixture.workspaceId, fixture.targetId, `${fixture.prefix}_grandchild_remote`))).toBe(true);
      const lateStaleDescendants = await client.$transaction(async tx => {
        const items = orderInboxCommentBatch([{ id: 'late-grandchild', parentId: 'late-child' }, { id: 'late-child', parentId: fixture.remoteId }]);
        const suppressed: boolean[] = [];
        for (const item of items) suppressed.push(await inboxCommentSuppressed(tx, fixture.workspaceId, fixture.targetId, item.id, item.parentId));
        return suppressed;
      });
      expect(lateStaleDescendants).toEqual([true, true]);

      const audits = await observer.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${fixture.userId} AND detail->>'operationId' = ${result.operationId} AND action = 'inbox.comment_deleted'`;
      expect(Number(audits[0]?.count)).toBe(1);
      const row = await observer.$queryRaw<Array<{ state: string; completedAt: Date | null }>>`SELECT state, "completedAt" FROM rebuild_inbox_deletions WHERE id = ${result.operationId}`;
      expect(row[0]).toMatchObject({ state: 'completed' });
      expect(row[0]?.completedAt).toBeInstanceOf(Date);
    } finally {
      integration.prisma = client;
      integration.failNextAudit = false;
      integration.allowedChannelIds = [];
      integration.dispatch = null;
      await cleanup(fixture);
    }
  });

  it('serializes concurrent attempts so only the channel-lock winner dispatches', async () => {
    const fixture = await createFixture(1);
    let calls = 0;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    prepare(fixture, async () => { calls += 1; await blocked; });
    try {
      const first = deleteItem(fixture);
      for (let i = 0; i < 50 && calls === 0; i += 1) await new Promise(resolve => setTimeout(resolve, 20));
      expect(calls).toBe(1);
      const second = await Promise.allSettled([deleteItem(fixture)]);
      expect(second[0]?.status).toBe('rejected');
      if (second[0]?.status === 'rejected') expect(second[0].reason).toMatchObject({ code: 'conflict' });
      release();
      await expect(first).resolves.toMatchObject({ ok: true, state: 'completed' });
      expect(calls).toBe(1);
      expect(integration.prepareCount).toBe(1);
    } finally {
      release();
      integration.allowedChannelIds = [];
      integration.dispatch = null;
      await cleanup(fixture);
    }
  });
});
