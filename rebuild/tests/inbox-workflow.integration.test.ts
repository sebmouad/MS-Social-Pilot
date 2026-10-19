import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const database = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  memberChannelIds: [] as string[],
  allChannels: false,
  failNextAudit: false,
}));

vi.mock('../src/server/data', () => ({ get prisma() { return database.prisma; } }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({ inbox: true }), canUseFeature: () => true, hasPlatformCapability: (_entitlements: unknown, provider: string) => provider === 'facebook' }));
vi.mock('../src/server/permissions/loader', () => ({
  loadPermissions: async () => ({ pageScope: database.allChannels ? { all: true, ids: [] } : { all: false, ids: database.memberChannelIds } }),
}));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/modules/inbox/server/providers', () => ({
  inboxProviders: async () => ['facebook'],
  inboxTargetWhere: async (workspaceId: string, allowedTargetIds?: readonly string[], allowedProviders?: readonly string[]) => ({
    workspaceId, enabled: true, type: 'page',
    socialAccount: { is: { workspaceId, invalidatedAt: null, provider: { in: (allowedProviders ?? ['facebook']).filter(provider => provider === 'facebook') } } },
    ...(allowedTargetIds === undefined ? {} : { id: { in: [...allowedTargetIds] } }),
  }),
}));
vi.mock('../src/server/data-control/guard', () => ({
  assertWorkspaceNotPurging: async (workspaceId: string) => {
    const purge = await database.prisma.workspaceDataPurge.findUnique({ where: { workspaceId }, select: { status: true } });
    if (purge && purge.status !== 'completed') throw new Error('Workspace purge in progress');
  },
  withWorkspaceOperation: async (_workspaceId: string, operation: () => Promise<unknown>) => operation(),
}));

import { setInboxResolved } from '@/modules/inbox/server/actions';

describe.skipIf(!databaseUrl)('Inbox workflow atomicity against PostgreSQL', () => {
  let client: PrismaClient;

  beforeAll(() => {
    const url = new URL(databaseUrl!);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !decodeURIComponent(url.pathname).endsWith('_preview') || ['host', 'hostaddr', 'socket'].some(key => url.searchParams.has(key))) {
      throw new Error('Integration writes require an isolated loopback _preview database.');
    }
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });
  afterAll(async () => { await client?.$disconnect(); });

  it('rolls back failed audit writes and commits local state with matching audit rows', async () => {
    const id = `preview_inbox_workflow_${randomUUID().replaceAll('-', '')}`;
    const workspaceId = id;
    const otherWorkspaceId = `${id}_other`;
    const userId = `${id}_user`;
    const disabledUserId = `${id}_disabled`;
    const socialId = `${id}_social`;
    const otherSocialId = `${id}_other_social`;
    const targetIds = { primary: `${id}_channel_a`, narrow: `${id}_channel_b`, foreign: `${id}_channel_c` };
    const conversationId = `${id}_conversation`;
    const postId = `${id}_post`;
    const postTargetId = `${id}_post_target`;
    const commentId = `${id}_comment`;
    const now = new Date('2026-10-16T12:00:00.000Z');
    const actor = { userId, workspaceId };
    const rollback = new Error('Rollback Inbox workflow probe');

    try {
      await client.$transaction(async outer => {
        const wrappedTx = new Proxy(outer as unknown as PrismaClient, {
          get(target, property) {
            if (property === '$transaction') return async (callback: (tx: PrismaClient) => Promise<unknown>) => {
              const savepoint = `inbox_sp_${randomUUID().replaceAll('-', '')}`;
              await target.$executeRawUnsafe(`SAVEPOINT "${savepoint}"`);
              try {
                const result = await callback(wrappedTx);
                await target.$executeRawUnsafe(`RELEASE SAVEPOINT "${savepoint}"`);
                return result;
              } catch (error) {
                await target.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
                await target.$executeRawUnsafe(`RELEASE SAVEPOINT "${savepoint}"`);
                throw error;
              }
            };
            if (property === '$executeRaw') return (strings: TemplateStringsArray, ...values: unknown[]) => {
              if (database.failNextAudit && strings.join('').includes('INSERT INTO root_activities')) {
                database.failNextAudit = false;
                throw new Error('Injected Inbox audit failure');
              }
              return Reflect.get(target, property, target).call(target, strings, ...values);
            };
            return Reflect.get(target, property, target);
          },
        });
        database.prisma = wrappedTx;
        database.memberChannelIds = [targetIds.primary];
        database.allChannels = false;
        await outer.user.createMany({ data: [
          { id: userId, email: `${id}@example.test`, name: 'Workflow actor', passwordHash: 'unusable' },
          { id: disabledUserId, email: `${id}_disabled@example.test`, name: 'Disabled workflow actor', passwordHash: 'unusable', disabledAt: now },
        ] });
        await outer.workspace.createMany({ data: [
          { id: workspaceId, name: 'Inbox workflow fixture', slug: id, timezone: 'UTC' },
          { id: otherWorkspaceId, name: 'Other Inbox workflow fixture', slug: `${id}_other`, timezone: 'UTC' },
        ] });
        await outer.membership.create({ data: { id: `${id}_membership`, userId, workspaceId, role: 'owner' } });
        await outer.socialAccount.createMany({ data: [
          { id: socialId, workspaceId, provider: 'facebook', providerUserId: `${id}_provider`, name: 'Expired source', accessToken: 'expired-test-token', tokenExpiresAt: new Date(now.getTime() - 60_000), scopes: '' },
          { id: otherSocialId, workspaceId: otherWorkspaceId, provider: 'facebook', providerUserId: `${id}_other_provider`, name: 'Foreign source', accessToken: '', scopes: '' },
        ] });
        await outer.target.createMany({ data: [
          { id: targetIds.primary, workspaceId, socialAccountId: socialId, type: 'page', providerId: `${id}_provider_page_a`, name: 'Primary selected channel', enabled: true, canPublish: true, createdAt: now },
          { id: targetIds.narrow, workspaceId, socialAccountId: socialId, type: 'page', providerId: `${id}_provider_page_b`, name: 'Other selected channel', enabled: true, canPublish: true, createdAt: now },
          { id: targetIds.foreign, workspaceId: otherWorkspaceId, socialAccountId: otherSocialId, type: 'page', providerId: `${id}_foreign_page`, name: 'Foreign channel', enabled: true, canPublish: true, createdAt: now },
        ] });
        await outer.post.create({ data: { id: postId, workspaceId, authorId: userId, message: 'Fixture post', status: 'published', createdAt: now, updatedAt: now } });
        await outer.postTarget.create({ data: { id: postTargetId, postId, targetId: targetIds.primary, status: 'published' } });
        await outer.conversation.create({ data: { id: conversationId, targetId: targetIds.primary, remoteId: conversationId, snippet: 'Stored message', updatedTime: now, fetchedAt: now } });
        await outer.postComment.create({ data: { id: commentId, postTargetId, remoteId: commentId, message: 'Stored comment', createdTime: now, fetchedAt: now, firstSeenAt: now } });
        await outer.conversation.create({ data: { id: `${id}_foreign_conversation`, targetId: targetIds.foreign, remoteId: `${id}_foreign_conversation`, snippet: 'Foreign workspace', updatedTime: now, fetchedAt: now } });

        database.failNextAudit = true;
        await expect(setInboxResolved(actor, { kind: 'message', id: conversationId, resolved: true })).rejects.toThrow('Injected Inbox audit failure');
        expect((await outer.conversation.findUniqueOrThrow({ where: { id: conversationId } })).resolvedAt).toBeNull();
        let auditRows = await outer.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${userId} AND detail->>'workspaceId' = ${workspaceId}`;
        expect(Number(auditRows[0]?.count)).toBe(0);

        await expect(setInboxResolved(actor, { kind: 'message', id: conversationId, resolved: true })).resolves.toMatchObject({ ok: true, kind: 'message', id: conversationId, resolved: true });
        expect((await outer.conversation.findUniqueOrThrow({ where: { id: conversationId } })).resolvedAt).toBeInstanceOf(Date);
        await expect(setInboxResolved(actor, { kind: 'message', id: conversationId, resolved: false })).resolves.toMatchObject({ ok: true, resolved: false });
        expect((await outer.conversation.findUniqueOrThrow({ where: { id: conversationId } })).resolvedAt).toBeNull();
        await expect(setInboxResolved(actor, { kind: 'comment', id: commentId, resolved: true })).resolves.toMatchObject({ ok: true, kind: 'comment', id: commentId, resolved: true });
        expect((await outer.postComment.findUniqueOrThrow({ where: { id: commentId } })).resolvedAt).toBeInstanceOf(Date);
        await expect(setInboxResolved(actor, { kind: 'comment', id: commentId, resolved: false })).resolves.toMatchObject({ ok: true, resolved: false });
        expect((await outer.postComment.findUniqueOrThrow({ where: { id: commentId } })).resolvedAt).toBeNull();

        database.allChannels = true;
        await expect(setInboxResolved(actor, { kind: 'message', id: conversationId, resolved: true }, { allowedChannelIds: [targetIds.narrow] }))
          .rejects.toMatchObject({ code: 'not_found' });
        database.allChannels = false;
        await expect(setInboxResolved(actor, { kind: 'message', id: conversationId, resolved: true }, { allowedChannelIds: [targetIds.narrow] }))
          .rejects.toMatchObject({ code: 'not_found' });
        await expect(setInboxResolved(actor, { kind: 'message', id: `${id}_foreign_conversation`, resolved: true }))
          .rejects.toMatchObject({ code: 'not_found' });
        await expect(setInboxResolved({ userId: disabledUserId, workspaceId }, { kind: 'message', id: conversationId, resolved: true }))
          .rejects.toMatchObject({ code: 'unauthorized' });

        auditRows = await outer.$queryRaw<Array<{ count: bigint; action: string; detail: unknown }>>`SELECT COUNT(*) AS count, MIN(action) AS action, MIN(detail->>'targetId') AS "targetId" FROM root_activities WHERE "actorId" = ${userId} AND detail->>'workspaceId' = ${workspaceId}`;
        expect(Number(auditRows[0]?.count)).toBe(4);
        const actions = await outer.$queryRaw<Array<{ action: string; targetId: string }>>`SELECT action, detail->>'targetId' AS "targetId" FROM root_activities WHERE "actorId" = ${userId} AND detail->>'workspaceId' = ${workspaceId} ORDER BY action`;
        expect(actions.map(row => row.action)).toEqual([
          'inbox.comment_reopened', 'inbox.comment_resolved', 'inbox.conversation_reopened', 'inbox.conversation_resolved',
        ]);
        expect(actions.every(row => row.targetId === targetIds.primary)).toBe(true);
        throw rollback;
      }, { timeout: 60000 });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      database.prisma = client;
      database.memberChannelIds = [];
      database.allChannels = false;
      database.failNextAudit = false;
    }

    const [users, workspaces, conversations, comments, audits] = await Promise.all([
      client.user.count({ where: { id: { startsWith: id } } }),
      client.workspace.count({ where: { id: { startsWith: id } } }),
      client.conversation.count({ where: { id: { startsWith: id } } }),
      client.postComment.count({ where: { id: { startsWith: id } } }),
      client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM root_activities WHERE "actorId" = ${userId}`,
    ]);
    expect({ users, workspaces, conversations, comments, audits: Number(audits[0]?.count) }).toEqual({ users: 0, workspaces: 0, conversations: 0, comments: 0, audits: 0 });
  });
});
