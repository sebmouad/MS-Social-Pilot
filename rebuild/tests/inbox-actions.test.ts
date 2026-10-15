import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    membership: { findUnique: vi.fn() }, target: { findFirst: vi.fn(), findMany: vi.fn() }, conversation: { findFirst: vi.fn(), update: vi.fn() },
    conversationMessage: { create: vi.fn(), findFirst: vi.fn() }, postComment: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() }, $executeRaw: vi.fn(), $transaction: vi.fn(), postTarget: { findMany: vi.fn() },
  },
  config: vi.fn(), decrypt: vi.fn(), engine: { replyToConversation: vi.fn(), replyToComment: vi.fn(), moderateComment: vi.fn(), deleteComment: vi.fn(), listInbox: vi.fn(), listComments: vi.fn() },
  configuredEngine: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), canUseFeature: vi.fn(), canAccessFeature: vi.fn(), canAccessPage: vi.fn(),
}));

vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: mocks.decrypt }));
vi.mock('../src/server/platforms/facebook', () => ({ configuredFacebookEngine: mocks.configuredEngine }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: mocks.canUseFeature }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: mocks.canAccessFeature, canAccessPage: mocks.canAccessPage }));

import { deleteFacebookComment, moderateFacebookComment, replyToFacebookInbox, syncFacebookInbox } from '../src/server/inbox/actions';

const actor = { userId: 'user-1', workspaceId: 'workspace-1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.membership.findUnique.mockResolvedValue({ id: 'membership-1', role: 'owner' });
  mocks.entitlements.mockResolvedValue({}); mocks.permissions.mockResolvedValue({});
  mocks.canUseFeature.mockReturnValue(true); mocks.canAccessFeature.mockReturnValue(true); mocks.canAccessPage.mockReturnValue(true);
  mocks.prisma.target.findFirst.mockResolvedValue({ id: 'target-1', providerId: 'page-1', accessToken: 'encrypted', socialAccount: { scopes: 'pages_messaging,pages_manage_engagement', tokenExpiresAt: null, invalidatedAt: null } });
  mocks.config.mockImplementation(async key => key === 'inbox.messengerReplyWindowHours' ? 24 : key === 'meta.inboxWriteScopes' ? ['pages_messaging', 'pages_manage_engagement'] : ['pages_messaging']);
  mocks.decrypt.mockReturnValue('page-secret'); mocks.configuredEngine.mockResolvedValue(mocks.engine);
  mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'conversation-1', remoteId: 'remote-conversation-1', targetId: 'target-1' });
  mocks.prisma.conversationMessage.findFirst.mockResolvedValue({ fromId: 'visitor-1', createdTime: new Date(Date.now() - 60 * 60 * 1000) });
  mocks.engine.replyToConversation.mockResolvedValue('remote-message-1');
  mocks.engine.moderateComment.mockResolvedValue(undefined);
  mocks.prisma.conversationMessage.create.mockResolvedValue({}); mocks.prisma.conversation.update.mockResolvedValue({});
  mocks.prisma.postComment.findFirst.mockResolvedValue({ id: 'comment-1', remoteId: 'remote-comment-1', postTarget: { targetId: 'target-1' } });
  mocks.prisma.postComment.update.mockResolvedValue({}); mocks.prisma.$executeRaw.mockResolvedValue(1);
  mocks.engine.deleteComment.mockResolvedValue(undefined); mocks.prisma.postComment.deleteMany.mockResolvedValue({ count: 2 });
});

describe('workspace Facebook inbox actions', () => {
  it('sends and stores a reply only after scoped page, feature, entitlement, and provider-scope checks', async () => {
    await replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: '  Hello there  ' });
    expect(mocks.engine.replyToConversation).toHaveBeenCalledWith('page-secret', 'remote-conversation-1', 'Hello there');
    expect(mocks.prisma.conversationMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ remoteId: 'remote-message-1', sentById: 'user-1', message: 'Hello there' }) }));
    expect(mocks.prisma.target.findFirst.mock.calls[0][0].where).toMatchObject({ workspaceId: actor.workspaceId, type: 'page' });
    expect(JSON.stringify(mocks.prisma.$executeRaw.mock.calls)).not.toContain('page-secret');
  });

  it('blocks channel scope and missing provider permissions before any Facebook write', async () => {
    mocks.canAccessPage.mockReturnValue(false);
    await expect(replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: 'Hello' })).rejects.toThrow(/do not have access/);
    expect(mocks.engine.replyToConversation).not.toHaveBeenCalled();
    mocks.canAccessPage.mockReturnValue(true);
    mocks.prisma.target.findFirst.mockResolvedValue({ id: 'target-1', providerId: 'page-1', accessToken: 'encrypted', socialAccount: { scopes: 'pages_messaging', tokenExpiresAt: null, invalidatedAt: null } });
    await expect(moderateFacebookComment(actor, { id: 'comment-1', hidden: true })).rejects.toThrow(/Inbox is unavailable for this connection/);
    expect(mocks.engine.moderateComment).not.toHaveBeenCalled();
  });

  it('blocks replies outside the configured Messenger window before contacting Facebook', async () => {
    mocks.config.mockImplementation(async key => key === 'inbox.messengerReplyWindowHours' ? 1 : key === 'meta.inboxWriteScopes' ? ['pages_messaging', 'pages_manage_engagement'] : ['pages_messaging']);
    mocks.prisma.conversationMessage.findFirst.mockResolvedValue({ fromId: 'visitor-1', createdTime: new Date(Date.now() - 2 * 60 * 60 * 1000) });
    await expect(replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: 'Hello' })).rejects.toThrow(/reply window closed/i);
    expect(mocks.prisma.conversationMessage.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId: 'conversation-1', fromId: { not: null }, NOT: { fromId: 'page-1' } },
      orderBy: { createdTime: 'desc' },
    }));
    expect(mocks.engine.replyToConversation).not.toHaveBeenCalled();
  });

  it('does not send when there is no stored inbound visitor message', async () => {
    mocks.prisma.conversationMessage.findFirst.mockResolvedValue(null);
    await expect(replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: 'Hello' })).rejects.toThrow(/no stored visitor message/i);
    expect(mocks.engine.replyToConversation).not.toHaveBeenCalled();
  });

  it('denies a requested channel read when the page is outside the member scope', async () => {
    mocks.prisma.target.findMany.mockResolvedValue([{ id: 'target-foreign' }]);
    mocks.canAccessPage.mockReturnValue(false);
    mocks.config.mockImplementation(async key => key === 'meta.pageSize' ? 25 : key === 'meta.maxPages' ? 2 : []);
    await expect(syncFacebookInbox(actor, 'target-foreign')).rejects.toThrow(/do not have access/);
    expect(mocks.configuredEngine).not.toHaveBeenCalled();
  });

  it('denies cross-workspace reads and writes before touching the provider', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(replyToFacebookInbox(actor, { kind: 'message', id: 'foreign-conversation', text: 'Hello' }))
      .rejects.toThrow(/unavailable in the current workspace/);
    expect(mocks.engine.replyToConversation).not.toHaveBeenCalled();
    expect(mocks.prisma.conversation.findFirst.mock.calls[0][0].where)
      .toEqual({ id: 'foreign-conversation', target: { workspaceId: actor.workspaceId } });
  });

  it('moderates only a comment stored under the current workspace and audits the result', async () => {
    await moderateFacebookComment(actor, { id: 'comment-1', hidden: true });
    expect(mocks.engine.moderateComment).toHaveBeenCalledWith('page-secret', 'remote-comment-1', true);
    expect(mocks.prisma.postComment.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'comment-1' }, data: expect.objectContaining({ isHidden: true }) }));
    expect(JSON.stringify(mocks.prisma.$executeRaw.mock.calls)).toContain('inbox.comment_hidden');
  });

  it('deletes a comment on the platform first, then removes it and its replies locally with an audit entry', async () => {
    mocks.prisma.postComment.findFirst.mockResolvedValue({ id: 'comment-1', remoteId: 'remote-comment-1', postTargetId: 'post-target-1', postTarget: { targetId: 'target-1' } });
    await deleteFacebookComment(actor, { id: 'comment-1' });
    expect(mocks.engine.deleteComment).toHaveBeenCalledWith('page-secret', 'remote-comment-1');
    expect(mocks.prisma.postComment.deleteMany).toHaveBeenCalledWith({ where: { postTargetId: 'post-target-1', OR: [{ id: 'comment-1' }, { parentRemoteId: 'remote-comment-1' }] } });
    expect(JSON.stringify(mocks.prisma.$executeRaw.mock.calls)).toContain('inbox.comment_deleted');
    expect(mocks.prisma.postComment.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'comment-1', postTarget: { post: { workspaceId: actor.workspaceId } } });
  });

  it('keeps the local comment when the platform refuses the deletion', async () => {
    mocks.prisma.postComment.findFirst.mockResolvedValue({ id: 'comment-1', remoteId: 'remote-comment-1', postTargetId: 'post-target-1', postTarget: { targetId: 'target-1' } });
    mocks.engine.deleteComment.mockRejectedValue(new Error('provider refused'));
    await expect(deleteFacebookComment(actor, { id: 'comment-1' })).rejects.toThrow('provider refused');
    expect(mocks.prisma.postComment.deleteMany).not.toHaveBeenCalled();
  });

  it('checks scope, permissions and workspace before any deletion', async () => {
    mocks.prisma.postComment.findFirst.mockResolvedValue({ id: 'comment-1', remoteId: 'remote-comment-1', postTargetId: 'post-target-1', postTarget: { targetId: 'target-1' } });
    mocks.canAccessPage.mockReturnValue(false);
    await expect(deleteFacebookComment(actor, { id: 'comment-1' })).rejects.toThrow(/do not have access/);
    mocks.canAccessPage.mockReturnValue(true); mocks.canAccessFeature.mockReturnValue(false);
    await expect(deleteFacebookComment(actor, { id: 'comment-1' })).rejects.toThrow(/not enabled/);
    mocks.canAccessFeature.mockReturnValue(true); mocks.prisma.postComment.findFirst.mockResolvedValue(null);
    await expect(deleteFacebookComment(actor, { id: 'foreign' })).rejects.toThrow(/unavailable in the current workspace/);
    await expect(deleteFacebookComment(actor, { id: 'bad id!' })).rejects.toThrow(/Invalid inbox item/);
    expect(mocks.engine.deleteComment).not.toHaveBeenCalled();
  });

  it('does not change the sync time when replying or moderating', async () => {
    await replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: 'Hello' });
    expect(JSON.stringify(mocks.prisma.conversation.update.mock.calls)).not.toContain('fetchedAt');
    await moderateFacebookComment(actor, { id: 'comment-1', hidden: true });
    expect(JSON.stringify(mocks.prisma.postComment.update.mock.calls)).not.toContain('fetchedAt');
  });

  it('syncs the channels it can read, reports the ones it cannot, and fails only when none can be read', async () => {
    mocks.config.mockImplementation(async key => key === 'meta.pageSize' ? 25 : key === 'meta.maxPages' ? 2 : key === 'meta.inboxReadScopes' ? ['pages_messaging'] : []);
    mocks.prisma.target.findMany.mockResolvedValue([{ id: 'target-1' }, { id: 'target-2' }]);
    mocks.prisma.target.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'target-1'
      ? { id: 'target-1', providerId: 'page-1', accessToken: 'encrypted', socialAccount: { scopes: 'pages_messaging', tokenExpiresAt: null, invalidatedAt: null } }
      : { id: 'target-2', providerId: 'page-2', accessToken: 'encrypted', socialAccount: { scopes: '', tokenExpiresAt: null, invalidatedAt: null } });
    mocks.engine.listInbox.mockResolvedValue([]);
    mocks.prisma.postTarget.findMany.mockResolvedValue([]);
    mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => Promise<unknown>) => work(mocks.prisma));
    const result = await syncFacebookInbox(actor);
    expect(result).toMatchObject({ targetCount: 1, failedCount: 1, conversationCount: 0, commentCount: 0 });
    expect(result.syncedAt).toEqual(expect.any(String));

    mocks.prisma.target.findFirst.mockResolvedValue({ id: 'x', providerId: 'p', accessToken: 'encrypted', socialAccount: { scopes: '', tokenExpiresAt: null, invalidatedAt: null } });
    await expect(syncFacebookInbox(actor)).rejects.toThrow(/Inbox is unavailable for this connection/);
  });
});
