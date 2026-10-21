import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ query: vi.fn(), conversation: vi.fn(), comment: vi.fn(), messages: vi.fn(), comments: vi.fn(), access: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: {
  $queryRaw: state.query,
  conversation: { findFirst: state.conversation }, postComment: { findFirst: state.comment, findMany: state.comments },
  conversationMessage: { findMany: state.messages, findFirst: async () => null },
} }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: state.access }));
vi.mock('@/modules/inbox/server/service-copy', () => ({ inboxServiceText: async () => 'Unavailable' }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => ({ 'inbox.listPageSize': 25, 'inbox.threadPageSize': 50, 'inbox.searchMaxCharacters': 200, 'inbox.cursorMaxCharacters': 4096, 'inbox.bulkMaxItems': 50 })[key] }));
import { readInboxThread } from '@/modules/inbox/server/read';

const actor = { userId: 'user', workspaceId: 'workspace' };
const target = { id: 'channel', name: 'Channel', providerId: 'channel-remote', socialAccount: { provider: 'example' } };
const respondedAt = new Date('2026-10-20T12:00:00Z');
const metadata = { attachments: [{ type: 'image', url: 'https://example.test/photo' }], authorPictureUrl: 'https://example.test/avatar' };
beforeEach(() => {
  vi.clearAllMocks();
  state.access.mockResolvedValue({ channelIds: ['channel'], channels: [], timeZone: 'UTC' });
  state.conversation.mockResolvedValue(null);
  state.comment.mockResolvedValue(null);
  state.messages.mockResolvedValue([]);
  state.comments.mockResolvedValue([]);
});

describe('shared Inbox thread metadata read model', () => {
  it('exposes stored participants/folder/labels and message metadata with original Page response time', async () => {
    const conversationMetadata = { participants: [{ id: 'visitor', name: 'Sam', pictureUrl: 'https://example.test/avatar' }], labels: [], folder: 'inbox' };
    state.conversation.mockResolvedValue({ id: 'conversation', remoteId: 'remote-thread', resolvedAt: null, target });
    state.messages.mockResolvedValue([{ id: 'message', remoteId: 'remote-message', message: null, fromName: 'Page', fromId: 'channel-remote', sentById: null, createdTime: respondedAt }]);
    state.query.mockImplementation(async (query: { sql: string }) => {
      if (query.sql.includes('"inboxMetadata" AS metadata')) return [{ id: query.sql.includes('FROM conversation_messages') ? 'message' : 'conversation', metadata: query.sql.includes('FROM conversation_messages') ? metadata : conversationMetadata }];
      if (query.sql.includes('COUNT(*)')) return [{ count: BigInt(1) }];
      return [{ id: 'message', kind: 'message', time: respondedAt }];
    });

    const result = await readInboxThread(actor, { key: 'message:conversation' });

    expect(result.thread).toMatchObject({ remoteId: 'remote-thread', metadata: conversationMetadata });
    expect(result.thread.entries[0]).toMatchObject({ remoteId: 'remote-message', authorId: 'channel-remote', fromChannel: true, time: respondedAt, metadata, text: '' });
    expect(state.access).toHaveBeenCalledWith(actor, {});
  });

  it('keeps the true remote parent when the local page flattens a missing intermediate comment', async () => {
    const opening = { id: 'opening', remoteId: 'remote-opening', postTargetId: 'post-target', message: 'Question', fromName: 'Sam', fromId: 'visitor', sentById: null, createdTime: new Date('2026-10-20T11:00:00Z'), resolvedAt: null, isHidden: false, postTarget: { target, post: { message: 'Post' } } };
    state.comment.mockResolvedValue(opening);
    state.comments.mockResolvedValue([{ id: 'reply', remoteId: 'remote-reply', parentRemoteId: 'intermediate-off-page', message: 'Answer', fromId: 'channel-remote', fromName: 'Channel', sentById: null, createdTime: respondedAt, isHidden: false }]);
    state.query.mockImplementation(async (query: { sql: string; values: unknown[] }) => {
      if (query.sql.includes('"inboxMetadata" AS metadata')) return [{ id: query.values[0], metadata: { permalink: 'https://example.test/comment', reactions: [{ type: 'LIKE', count: 2 }], threadId: 'remote-opening' } }];
      if (query.sql.includes('COUNT(*)')) return [{ count: BigInt(1) }];
      return [{ id: 'reply', kind: 'comment', time: respondedAt }];
    });

    const { thread } = await readInboxThread(actor, { key: 'comment:opening' });

    expect(thread.entries[1]).toMatchObject({ parentId: 'opening', parentRemoteId: 'intermediate-off-page', remoteId: 'remote-reply', authorId: 'channel-remote', fromChannel: true, time: respondedAt, metadata: { threadId: 'remote-opening' } });
    expect(thread.entries[0]?.metadata).toMatchObject({ reactions: [{ type: 'LIKE', count: 2 }], permalink: 'https://example.test/comment' });
  });

  it('refuses unavailable scope before querying metadata', async () => {
    state.access.mockResolvedValue({ channelIds: [], channels: [], timeZone: 'UTC' });
    await expect(readInboxThread(actor, { key: 'message:conversation' })).rejects.toMatchObject({ code: 'not_found' });
    expect(state.query).not.toHaveBeenCalled();
  });
});
