import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    membership: { findUnique: vi.fn() }, target: { findFirst: vi.fn(), findMany: vi.fn() }, conversation: { findFirst: vi.fn(), update: vi.fn() },
    conversationMessage: { create: vi.fn(), findFirst: vi.fn() }, postComment: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() }, $executeRaw: vi.fn(), $transaction: vi.fn(), postTarget: { findMany: vi.fn() },
  },
  config: vi.fn(), decrypt: vi.fn(), engine: { replyToConversation: vi.fn(), replyToComment: vi.fn(), moderateComment: vi.fn(), deleteComment: vi.fn(), listInbox: vi.fn(), listComments: vi.fn() },
  configuredEngine: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), canUseFeature: vi.fn(), canAccessFeature: vi.fn(), canAccessPage: vi.fn(), guard: vi.fn(), suppressed: vi.fn(), orderBatch: vi.fn(),
}));

vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: mocks.decrypt }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: mocks.configuredEngine }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: mocks.canUseFeature }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: mocks.canAccessFeature, canAccessPage: mocks.canAccessPage }));
vi.mock('@/modules/inbox/server/comment-guard', () => ({ withInboxChannelOperation: mocks.guard, inboxCommentSuppressed: mocks.suppressed, orderInboxCommentBatch: mocks.orderBatch }));

import { prepareDeleteFacebookComment, moderateFacebookComment, replyToFacebookInbox, syncFacebookInbox } from '../src/platforms/facebook/inbox';

const actor = { userId: 'user-1', workspaceId: 'workspace-1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.membership.findUnique.mockResolvedValue({ id: 'membership-1', role: 'owner' });
  mocks.entitlements.mockResolvedValue({}); mocks.permissions.mockResolvedValue({});
  mocks.canUseFeature.mockReturnValue(true); mocks.canAccessFeature.mockReturnValue(true); mocks.canAccessPage.mockReturnValue(true);
  mocks.prisma.target.findFirst.mockResolvedValue({ id: 'target-1', providerId: 'page-1', accessToken: 'encrypted', socialAccount: { scopes: 'pages_messaging,pages_manage_engagement', tokenExpiresAt: null, invalidatedAt: null } });
  mocks.config.mockImplementation(async key => key === 'platforms.facebook.enabled' ? true : key === 'inbox.messengerReplyWindowHours' ? 24 : key === 'meta.inboxWriteScopes' ? ['pages_messaging', 'pages_manage_engagement'] : ['pages_messaging']);
  mocks.decrypt.mockReturnValue('page-secret'); mocks.configuredEngine.mockResolvedValue(mocks.engine);
  mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'conversation-1', remoteId: 'remote-conversation-1', targetId: 'target-1' });
  mocks.prisma.conversationMessage.findFirst.mockResolvedValue({ fromId: 'visitor-1', createdTime: new Date(Date.now() - 60 * 60 * 1000) });
  mocks.engine.replyToConversation.mockResolvedValue('remote-message-1');
  mocks.engine.moderateComment.mockResolvedValue(undefined);
  mocks.prisma.conversationMessage.create.mockResolvedValue({}); mocks.prisma.conversation.update.mockResolvedValue({});
  mocks.prisma.postComment.findFirst.mockResolvedValue({ id: 'comment-1', remoteId: 'remote-comment-1', postTarget: { targetId: 'target-1' } });
  mocks.prisma.postComment.update.mockResolvedValue({}); mocks.prisma.$executeRaw.mockResolvedValue(1);
  mocks.engine.deleteComment.mockResolvedValue(undefined); mocks.prisma.postComment.deleteMany.mockResolvedValue({ count: 2 });
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => Promise<unknown>) => work(mocks.prisma));
  mocks.guard.mockImplementation(async (_workspaceId: string, _targetId: string, operation: (signal: AbortSignal) => Promise<unknown>) => operation(new AbortController().signal));
  mocks.suppressed.mockResolvedValue(false);
  mocks.orderBatch.mockImplementation(items => items);
});

describe('workspace Facebook inbox actions', () => {
  it('blocks provider reads when Root disables the platform', async () => {
    mocks.config.mockImplementation(async key => key === 'platforms.facebook.enabled' ? false : []);
    await expect(syncFacebookInbox(actor, 'target-1')).rejects.toThrow(/unavailable in the inbox/);
    expect(mocks.configuredEngine).not.toHaveBeenCalled();
  });
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
    mocks.config.mockImplementation(async key => key === 'platforms.facebook.enabled' ? true : key === 'inbox.messengerReplyWindowHours' ? 1 : key === 'meta.inboxWriteScopes' ? ['pages_messaging', 'pages_manage_engagement'] : ['pages_messaging']);
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
    mocks.config.mockImplementation(async key => key === 'platforms.facebook.enabled' ? true : key === 'meta.pageSize' ? 25 : key === 'meta.maxPages' ? 2 : []);
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

  it('blocks comment reply when a nonrejected deletion tombstone exists', async () => {
    mocks.suppressed.mockResolvedValue(true);
    await expect(replyToFacebookInbox(actor, { kind: 'comment', id: 'comment-1', text: 'Reply' })).rejects.toThrow(/pending or confirmed deletion/);
    expect(mocks.engine.replyToComment).not.toHaveBeenCalled();
    expect(mocks.guard).toHaveBeenCalledWith(actor.workspaceId, 'target-1', expect.any(Function));
  });

  it('does not apply comment reply or moderation locally after the provider call is aborted', async () => {
    const controller = new AbortController();
    mocks.guard.mockImplementationOnce(async (_workspaceId: string, _targetId: string, operation: (signal: AbortSignal) => Promise<unknown>) => operation(controller.signal));
    mocks.engine.replyToComment.mockImplementationOnce(async () => { controller.abort(); return 'remote-reply'; });
    await expect(replyToFacebookInbox(actor, { kind: 'comment', id: 'comment-1', text: 'Reply' })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.configuredEngine).toHaveBeenCalledWith({ signal: controller.signal });
    expect(mocks.prisma.postComment.create).not.toHaveBeenCalled();
    expect(mocks.prisma.postComment.update).not.toHaveBeenCalled();

    vi.clearAllMocks();
    mocks.prisma.membership.findUnique.mockResolvedValue({ id: 'membership-1', role: 'owner' });
    mocks.entitlements.mockResolvedValue({}); mocks.permissions.mockResolvedValue({});
    mocks.canUseFeature.mockReturnValue(true); mocks.canAccessFeature.mockReturnValue(true); mocks.canAccessPage.mockReturnValue(true);
    mocks.prisma.postComment.findFirst.mockResolvedValue({ id: 'comment-1', remoteId: 'remote-comment-1', postTarget: { targetId: 'target-1' } });
    mocks.config.mockImplementation(async key => key === 'platforms.facebook.enabled' ? true : key === 'meta.inboxWriteScopes' ? ['pages_messaging', 'pages_manage_engagement'] : ['pages_messaging']);
    mocks.decrypt.mockReturnValue('page-secret');
    const moderationController = new AbortController();
    mocks.guard.mockImplementationOnce(async (_workspaceId: string, _targetId: string, operation: (signal: AbortSignal) => Promise<unknown>) => operation(moderationController.signal));
    mocks.configuredEngine.mockResolvedValue(mocks.engine);
    mocks.engine.moderateComment.mockImplementationOnce(async () => { moderationController.abort(); });
    await expect(moderateFacebookComment(actor, { id: 'comment-1', hidden: true })).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.engine.moderateComment).toHaveBeenCalledWith('page-secret', 'remote-comment-1', true);
    expect(mocks.prisma.postComment.update).not.toHaveBeenCalled();
  });

  it('prepares only the provider deletion call; shared Inbox owns local cleanup and audit', async () => {
    const remove = await prepareDeleteFacebookComment(actor, { targetId: 'target-1', remoteId: 'remote-comment-1' });
    expect(mocks.engine.deleteComment).not.toHaveBeenCalled();
    await remove(new AbortController().signal);
    expect(mocks.engine.deleteComment).toHaveBeenCalledWith('page-secret', 'remote-comment-1');
    expect(mocks.prisma.postComment.deleteMany).not.toHaveBeenCalled();
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('keeps the local comment when the platform refuses the deletion', async () => {
    mocks.engine.deleteComment.mockRejectedValue(new Error('provider refused'));
    const remove = await prepareDeleteFacebookComment(actor, { targetId: 'target-1', remoteId: 'remote-comment-1' });
    await expect(remove(new AbortController().signal)).rejects.toThrow('provider refused');
    expect(mocks.prisma.postComment.deleteMany).not.toHaveBeenCalled();
  });

  it('checks page scope and permissions before preparing deletion', async () => {
    mocks.canAccessPage.mockReturnValue(false);
    await expect(prepareDeleteFacebookComment(actor, { targetId: 'target-1', remoteId: 'remote-comment-1' })).rejects.toThrow(/do not have access/);
    mocks.canAccessPage.mockReturnValue(true); mocks.canAccessFeature.mockReturnValue(false);
    await expect(prepareDeleteFacebookComment(actor, { targetId: 'target-1', remoteId: 'remote-comment-1' })).rejects.toThrow(/not enabled/);
    mocks.canAccessFeature.mockReturnValue(true);
    await expect(prepareDeleteFacebookComment(actor, { targetId: 'target-1', remoteId: 'bad id!' })).rejects.toThrow(/Invalid inbox item/);
    expect(mocks.engine.deleteComment).not.toHaveBeenCalled();
  });

  it('passes the lock cancellation signal to the provider engine and aborts before dispatch', async () => {
    const controller = new AbortController();
    controller.abort();
    const remove = await prepareDeleteFacebookComment(actor, { targetId: 'target-1', remoteId: 'remote-comment-1' });
    await expect(remove(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.configuredEngine).toHaveBeenCalledWith({ signal: controller.signal });
    expect(mocks.engine.deleteComment).not.toHaveBeenCalled();
  });

  it('does not change the sync time when replying or moderating', async () => {
    await replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: 'Hello' });
    expect(JSON.stringify(mocks.prisma.conversation.update.mock.calls)).not.toContain('fetchedAt');
    await moderateFacebookComment(actor, { id: 'comment-1', hidden: true });
    expect(JSON.stringify(mocks.prisma.postComment.update.mock.calls)).not.toContain('fetchedAt');
  });

  it('syncs the channels it can read, reports the ones it cannot, and fails only when none can be read', async () => {
    mocks.config.mockImplementation(async key => key === 'platforms.facebook.enabled' ? true : key === 'meta.pageSize' ? 25 : key === 'meta.maxPages' ? 2 : key === 'meta.inboxReadScopes' ? ['pages_messaging'] : []);
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

  it('checks comment and parent tombstones inside the locked sync transaction', async () => {
    mocks.config.mockImplementation(async key => key === 'platforms.facebook.enabled' ? true : key === 'meta.pageSize' ? 25 : key === 'meta.maxPages' ? 2 : key === 'meta.inboxReadScopes' ? ['pages_messaging'] : []);
    mocks.prisma.target.findMany.mockResolvedValue([{ id: 'target-1' }]);
    mocks.engine.listInbox.mockResolvedValue([]);
    mocks.prisma.postTarget.findMany.mockResolvedValue([{ id: 'post-target-1', remotePostId: 'post-remote-1' }]);
    mocks.engine.listComments.mockResolvedValue([{ id: 'reply-1', parentId: 'parent-1', message: 'reply', fromName: 'Visitor', fromId: 'visitor-1', likeCount: 0, replyCount: 0, isHidden: false, createdAt: new Date() }]);
    await syncFacebookInbox(actor, 'target-1');
    expect(mocks.guard).toHaveBeenCalledWith(actor.workspaceId, 'target-1', expect.any(Function));
    expect(mocks.suppressed).toHaveBeenCalledWith(mocks.prisma, actor.workspaceId, 'target-1', 'reply-1', 'parent-1');
  });

  it('orders each manual comment batch parent-first before checking tombstones', async () => {
    mocks.config.mockImplementation(async key => key === 'platforms.facebook.enabled' ? true : key === 'meta.pageSize' ? 25 : key === 'meta.maxPages' ? 2 : key === 'meta.inboxReadScopes' ? ['pages_messaging'] : []);
    mocks.prisma.target.findMany.mockResolvedValue([{ id: 'target-1' }]);
    mocks.engine.listInbox.mockResolvedValue([]);
    mocks.prisma.postTarget.findMany.mockResolvedValue([{ id: 'post-target-1', remotePostId: 'post-remote-1' }]);
    const comments = [
      { id: 'grandchild', parentId: 'child', message: 'grandchild', fromName: null, fromId: null, likeCount: 0, replyCount: 0, isHidden: false, createdAt: new Date() },
      { id: 'child', parentId: 'root', message: 'child', fromName: null, fromId: null, likeCount: 0, replyCount: 0, isHidden: false, createdAt: new Date() },
      { id: 'root', parentId: null, message: 'root', fromName: null, fromId: null, likeCount: 0, replyCount: 0, isHidden: false, createdAt: new Date() },
    ];
    mocks.engine.listComments.mockResolvedValue(comments);
    mocks.orderBatch.mockImplementation((items: typeof comments) => {
      const byId = new Map(items.map(item => [item.id, item]));
      const ordered: typeof items = []; const done = new Set<string>();
      while (ordered.length < items.length) for (const item of items) {
        if (done.has(item.id) || (item.parentId && byId.has(item.parentId) && !done.has(item.parentId))) continue;
        ordered.push(item); done.add(item.id);
      }
      return ordered;
    });

    await syncFacebookInbox(actor, 'target-1');

    expect(mocks.orderBatch).toHaveBeenCalledWith(comments);
    expect(mocks.suppressed.mock.calls.map(call => call[3])).toEqual(['root', 'child', 'grandchild']);
  });
});
