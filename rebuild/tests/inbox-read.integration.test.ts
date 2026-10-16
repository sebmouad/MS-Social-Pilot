import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const database = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  memberChannelIds: [] as string[],
}));
vi.mock('../src/server/data', () => ({ get prisma() { return database.prisma; } }));
vi.mock('../src/server/entitlements', () => ({
  loadEntitlements: async () => ({ inbox: true }),
  canUseFeature: () => true,
}));
vi.mock('../src/server/permissions/loader', () => ({
  loadPermissions: async () => ({ pageScope: { all: false, ids: database.memberChannelIds } }),
}));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => ({
    'inbox.listPageSize': 2,
    'inbox.threadPageSize': 2,
    'inbox.searchMaxCharacters': 200,
    'inbox.cursorMaxCharacters': 4096,
    'platforms.facebook.enabled': true,
  }[key]),
}));

import { readInboxList, readInboxThread } from '../src/modules/inbox/server/read';

describe.skipIf(!databaseUrl)('Inbox read services against PostgreSQL', () => {
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

  it('covers scoped merged activity, stable cursors, literal search, and complete paged histories in a rolled-back fixture', async () => {
    const id = `preview_inbox_read_${randomUUID().replaceAll('-', '')}`;
    const workspaceId = id;
    const otherWorkspaceId = `${id}_other`;
    const userId = `${id}_user`;
    const disabledUserId = `${id}_disabled`;
    const socialId = `${id}_social`;
    const targetIds = { primary: `${id}_channel_a`, member: `${id}_channel_b`, outsideMember: `${id}_channel_c`, disabled: `${id}_channel_d`, foreign: `${id}_channel_e` };
    const conversationId = `${id}_thread`;
    const commentPostId = `${id}_post`;
    const commentPostTargetId = `${id}_post_target`;
    const commentRootId = `${id}_comment_root`;
    const otherConversationId = `${id}_other_thread`;
    const foreignConversationId = `${id}_foreign_thread`;
    const rollback = new Error('Rollback Inbox read probe');
    const now = new Date('2026-10-15T12:00:00.000Z');
    const listKeys: Array<{ id: string; kind: 'message' | 'comment'; time: Date }> = [];
    const actor = { userId, workspaceId };

    try {
      await client.$transaction(async tx => {
        database.prisma = tx as unknown as PrismaClient;
        database.memberChannelIds = [targetIds.primary, targetIds.member];
        await tx.user.createMany({ data: [
          { id: userId, email: `${id}@example.test`, name: 'Inbox reader', passwordHash: 'unusable' },
          { id: disabledUserId, email: `${id}_disabled@example.test`, name: 'Disabled reader', passwordHash: 'unusable', disabledAt: now },
        ] });
        await tx.workspace.createMany({ data: [
          { id: workspaceId, name: 'Inbox read fixture', slug: id, timezone: 'Africa/Casablanca' },
          { id: otherWorkspaceId, name: 'Other inbox fixture', slug: `${id}-other`, timezone: 'UTC' },
        ] });
        await tx.membership.create({ data: { id: `${id}_membership`, userId, workspaceId, role: 'viewer' } });
        await tx.socialAccount.create({ data: {
          id: socialId, workspaceId, provider: 'facebook', providerUserId: `${id}_provider`, name: 'Fixture Facebook', accessToken: 'unusable', scopes: '',
        } });
        await tx.socialAccount.create({ data: {
          id: `${id}_other_social`, workspaceId: otherWorkspaceId, provider: 'facebook', providerUserId: `${id}_other_provider`, name: 'Other Facebook', accessToken: 'unusable', scopes: '',
        } });
        await tx.target.createMany({ data: [
          ...Object.entries(targetIds).filter(([key]) => key !== 'foreign').map(([key, targetId]) => ({
            id: targetId, workspaceId, socialAccountId: socialId, type: 'page' as const, providerId: `${id}_provider_${key}`,
            name: `Fixture ${key}`, enabled: key !== 'disabled', canPublish: true, createdAt: now,
          })),
          { id: targetIds.foreign, workspaceId: otherWorkspaceId, socialAccountId: `${id}_other_social`, type: 'page', providerId: `${id}_other_provider_page`, name: 'Other workspace', enabled: true, canPublish: true, createdAt: now },
        ] });

        const baseConversationRows = Array.from({ length: 28 }, (_, index) => {
          const convId = `${id}_list_message_${String(index).padStart(2, '0')}`;
          listKeys.push({ id: convId, kind: 'message', time: now });
          return { id: convId, targetId: targetIds.primary, remoteId: convId, snippet: `message ${index}`, unreadCount: 0, messageCount: 1, updatedTime: now, fetchedAt: now };
        });
        const baseCommentRows = Array.from({ length: 28 }, (_, index) => {
          const commentId = `${id}_list_comment_${String(index).padStart(2, '0')}`;
          listKeys.push({ id: commentId, kind: 'comment', time: now });
          return { id: commentId, postTargetId: commentPostTargetId, remoteId: commentId, message: `comment ${index}`, fromName: 'Visitor', fromId: `${id}_visitor`, createdTime: now, fetchedAt: now, firstSeenAt: now };
        });
        await tx.post.create({ data: { id: commentPostId, workspaceId, authorId: userId, message: 'Fixture post context', status: 'published', createdAt: now, updatedAt: now } });
        await tx.postTarget.create({ data: { id: commentPostTargetId, postId: commentPostId, targetId: targetIds.primary, status: 'published' } });
        await tx.conversation.createMany({ data: baseConversationRows });
        await tx.postComment.createMany({ data: baseCommentRows });

        // Status, visibility, and parent filters must be applied before counting or paging.
        await tx.conversation.createMany({ data: [
          { id: `${id}_resolved_thread`, targetId: targetIds.primary, remoteId: `${id}_resolved_thread`, snippet: 'resolved', updatedTime: now, fetchedAt: now, resolvedAt: now },
          { id: `${id}_scope_outside_member`, targetId: targetIds.outsideMember, remoteId: `${id}_scope_outside_member`, snippet: 'outside member scope', updatedTime: now, fetchedAt: now },
          { id: `${id}_scope_disabled`, targetId: targetIds.disabled, remoteId: `${id}_scope_disabled`, snippet: 'disabled channel', updatedTime: now, fetchedAt: now },
        ] });
        await tx.postComment.createMany({ data: [
          { id: `${id}_resolved_comment`, postTargetId: commentPostTargetId, remoteId: `${id}_resolved_comment`, message: 'resolved comment', createdTime: now, fetchedAt: now, firstSeenAt: now, resolvedAt: now },
          { id: `${id}_hidden_comment`, postTargetId: commentPostTargetId, remoteId: `${id}_hidden_comment`, message: 'hidden comment', createdTime: now, fetchedAt: now, firstSeenAt: now, isHidden: true },
          { id: commentRootId, postTargetId: commentPostTargetId, remoteId: commentRootId, message: 'parent comment', createdTime: now, fetchedAt: now, firstSeenAt: now },
          { id: `${id}_child_comment`, postTargetId: commentPostTargetId, remoteId: `${id}_child_comment`, parentRemoteId: commentRootId, message: 'child comment', createdTime: now, fetchedAt: now, firstSeenAt: now },
        ] });
        listKeys.push({ id: commentRootId, kind: 'comment', time: now });
        const literal = `%_\\`;
        const searchThreadId = `${id}_literal_thread`;
        const searchCommentId = `${id}_literal_comment`;
        listKeys.push({ id: searchThreadId, kind: 'message', time: new Date(now.getTime() - 1000) });
        listKeys.push({ id: searchCommentId, kind: 'comment', time: new Date(now.getTime() - 2000) });
        await tx.conversation.create({ data: { id: searchThreadId, targetId: targetIds.primary, remoteId: searchThreadId, snippet: `literal ${literal} snippet`, updatedTime: new Date(now.getTime() - 1000), fetchedAt: now } });
        await tx.conversationMessage.create({ data: { id: `${id}_literal_message`, conversationId: searchThreadId, remoteId: `${id}_literal_message`, message: 'matching message body', fromName: 'Visitor', fromId: `${id}_visitor`, createdTime: new Date(now.getTime() - 1000) } });
        await tx.postComment.create({ data: { id: searchCommentId, postTargetId: commentPostTargetId, remoteId: searchCommentId, message: `literal ${literal} comment`, createdTime: new Date(now.getTime() - 2000), fetchedAt: now, firstSeenAt: now } });

        await tx.conversation.create({ data: { id: conversationId, targetId: targetIds.primary, remoteId: conversationId, snippet: 'large conversation', updatedTime: now, fetchedAt: now } });
        listKeys.push({ id: conversationId, kind: 'message', time: now });
        const historyMessages = Array.from({ length: 305 }, (_, index) => ({
          id: `${id}_history_${String(index).padStart(3, '0')}`,
          conversationId,
          remoteId: `${id}_history_${String(index).padStart(3, '0')}`,
          fromName: index === 302 ? 'Newest visitor' : index >= 303 ? 'Fixture Page' : 'Visitor',
          fromId: index === 302 ? `${id}_visitor` : index >= 303 ? `${id}_provider_primary` : `${id}_visitor`,
          sentById: index >= 303 ? userId : null,
          message: `history ${index}`,
          createdTime: new Date(now.getTime() + index * 1000),
          firstSeenAt: now,
        }));
        await tx.conversationMessage.createMany({ data: historyMessages });

        const replyRows = Array.from({ length: 7 }, (_, index) => ({
          id: `${id}_reply_${index}`,
          postTargetId: commentPostTargetId,
          remoteId: `${id}_reply_${index}`,
          parentRemoteId: commentRootId,
          message: `reply ${index}`,
          fromName: index >= 5 ? 'Fixture Page' : 'Visitor',
          fromId: index >= 5 ? `${id}_provider_primary` : `${id}_visitor`,
          sentById: index >= 5 ? userId : null,
          createdTime: new Date(now.getTime() + index * 1000),
          fetchedAt: now,
          firstSeenAt: now,
        }));
        await tx.postComment.createMany({ data: replyRows });
        await tx.conversation.create({ data: { id: otherConversationId, targetId: targetIds.outsideMember, remoteId: otherConversationId, snippet: 'outside member', updatedTime: now, fetchedAt: now } });
        await tx.conversation.create({ data: { id: foreignConversationId, targetId: targetIds.foreign, remoteId: foreignConversationId, snippet: 'other workspace', updatedTime: now, fetchedAt: now } });

        const allowed = await readInboxList(actor, {}, { allowedChannelIds: [targetIds.primary, targetIds.outsideMember, targetIds.disabled] });
        expect(allowed.channels.map(channel => channel.id)).toEqual([targetIds.primary]);
        expect(allowed.total).toBe(60);
        expect(allowed.items).toHaveLength(2);
        expect(allowed.items.every(item => item.target.id === targetIds.primary)).toBe(true);
        expect(allowed.items.some(item => item.id === commentRootId || item.id === `${id}_child_comment`)).toBe(false);

        const expected = [...listKeys].sort((a, b) => b.time.getTime() - a.time.getTime()
          || (a.kind < b.kind ? 1 : a.kind > b.kind ? -1 : 0)
          || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
        const visited: string[] = [];
        let page = allowed;
        let secondPage: Awaited<ReturnType<typeof readInboxList>> | null = null;
        let pageNumber = 0;
        while (true) {
          visited.push(...page.items.map(item => item.key));
          if (pageNumber === 1) secondPage = page;
          if (!page.olderCursor) break;
          page = await readInboxList(actor, { cursor: page.olderCursor }, { allowedChannelIds: [targetIds.primary, targetIds.outsideMember, targetIds.disabled] });
          pageNumber++;
        }
        expect(visited).toEqual(expected.map(item => `${item.kind}:${item.id}`));
        expect(new Set(visited).size).toBe(60);
        const firstAgain = await readInboxList(actor, { cursor: secondPage!.newerCursor! }, { allowedChannelIds: [targetIds.primary, targetIds.outsideMember, targetIds.disabled] });
        expect(firstAgain.items.map(item => item.key)).toEqual(visited.slice(0, 2));

        const literals = await readInboxList(actor, { q: literal }, { allowedChannelIds: [targetIds.primary] });
        expect(literals.total).toBe(2);
        expect(new Set(literals.items.map(item => item.id))).toEqual(new Set([searchThreadId, searchCommentId]));
        const allComments = await readInboxList(actor, { kind: 'comment', state: 'all', hidden: 'all' }, { allowedChannelIds: [targetIds.primary] });
        const allCommentItems = [...allComments.items];
        let commentsPage = allComments;
        while (commentsPage.olderCursor) {
          commentsPage = await readInboxList(actor, { kind: 'comment', state: 'all', hidden: 'all', cursor: commentsPage.olderCursor }, { allowedChannelIds: [targetIds.primary] });
          allCommentItems.push(...commentsPage.items);
        }
        expect(allCommentItems.some(item => item.id === `${id}_hidden_comment`)).toBe(true);
        expect(allCommentItems.some(item => item.id === `${id}_resolved_comment`)).toBe(true);
        expect(allCommentItems.some(item => item.id === `${id}_child_comment`)).toBe(false);
        expect(allCommentItems.some(item => item.id === `${id}_list_comment_00`)).toBe(true);
        await expect(readInboxList(actor, { cursor: allowed.olderCursor, kind: 'comment' }, { allowedChannelIds: [targetIds.primary, targetIds.outsideMember, targetIds.disabled] }))
          .rejects.toMatchObject({ code: 'invalid_request' });

        const newest = await readInboxThread(actor, { key: `message:${conversationId}` }, { allowedChannelIds: [targetIds.primary] });
        expect(newest.history).toMatchObject({ total: 305, shown: 2, limit: 2 });
        expect(newest.thread.entries.map(entry => entry.text)).toEqual(['history 303', 'history 304']);
        expect(newest.thread.lastInbound).toEqual({ fromId: `${id}_visitor`, createdTime: new Date(now.getTime() + 302_000) });
        const earlier = await readInboxThread(actor, { key: `message:${conversationId}`, cursor: newest.history.olderCursor! }, { allowedChannelIds: [targetIds.primary] });
        expect(earlier.thread.entries.map(entry => entry.text)).toEqual(['history 301', 'history 302']);
        const newer = await readInboxThread(actor, { key: `message:${conversationId}`, cursor: earlier.history.newerCursor! }, { allowedChannelIds: [targetIds.primary] });
        expect(newer.thread.entries.map(entry => entry.text)).toEqual(['history 303', 'history 304']);

        const commentNewest = await readInboxThread(actor, { key: `comment:${commentRootId}` }, { allowedChannelIds: [targetIds.primary] });
        expect(commentNewest.history).toMatchObject({ total: 8, shown: 2 });
        expect(commentNewest.thread.entries.map(entry => entry.id)).toEqual([commentRootId, `${id}_reply_5`, `${id}_reply_6`]);
        const commentEarlier = await readInboxThread(actor, { key: `comment:${commentRootId}`, cursor: commentNewest.history.olderCursor! }, { allowedChannelIds: [targetIds.primary] });
        expect(commentEarlier.thread.entries.map(entry => entry.id)).toEqual([commentRootId, `${id}_reply_3`, `${id}_reply_4`]);
        const commentLatest = await readInboxThread(actor, { key: `comment:${commentRootId}`, cursor: commentEarlier.history.newerCursor! }, { allowedChannelIds: [targetIds.primary] });
        expect(commentLatest.thread.entries.map(entry => entry.id)).toEqual(commentNewest.thread.entries.map(entry => entry.id));

        await expect(readInboxThread(actor, { key: `message:${otherConversationId}` }, { allowedChannelIds: [targetIds.primary] })).rejects.toMatchObject({ code: 'not_found' });
        await expect(readInboxThread(actor, { key: `message:${foreignConversationId}` }, { allowedChannelIds: [targetIds.primary] })).rejects.toMatchObject({ code: 'not_found' });
        await expect(readInboxThread({ userId: disabledUserId, workspaceId }, { key: `message:${conversationId}` }, { allowedChannelIds: [targetIds.primary] })).rejects.toMatchObject({ code: 'unauthorized' });
        throw rollback;
      }, { timeout: 60000 });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      database.prisma = client;
      database.memberChannelIds = [];
    }

    const [users, workspaces, conversations, comments] = await Promise.all([
      client.user.count({ where: { id: { startsWith: id } } }),
      client.workspace.count({ where: { id: { startsWith: id } } }),
      client.conversation.count({ where: { id: { startsWith: id } } }),
      client.postComment.count({ where: { id: { startsWith: id } } }),
    ]);
    expect({ users, workspaces, conversations, comments }).toEqual({ users: 0, workspaces: 0, conversations: 0, comments: 0 });
  });
});
