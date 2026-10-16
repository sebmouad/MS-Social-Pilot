import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '@/lib/operation-error';

const mocks = vi.hoisted(() => ({
  prisma: {
    membership: { findUnique: vi.fn() },
    target: { findFirst: vi.fn(), findMany: vi.fn() },
    conversation: { findFirst: vi.fn(), update: vi.fn() },
    conversationMessage: { findFirst: vi.fn(), create: vi.fn() },
    postComment: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    postTarget: { findMany: vi.fn() },
    $executeRaw: vi.fn(), $transaction: vi.fn(),
  },
  config: vi.fn(), decrypt: vi.fn(),
  engine: { replyToConversation: vi.fn(), replyToComment: vi.fn(), moderateComment: vi.fn(), deleteComment: vi.fn(), listInbox: vi.fn(), listComments: vi.fn() },
  configuredEngine: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), canUseFeature: vi.fn(), canAccessFeature: vi.fn(), canAccessPage: vi.fn(),
  platformInbox: vi.fn(), inboxPlatformIds: vi.fn(),
}));

vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/server/secret-crypto', () => ({ decryptSecret: mocks.decrypt }));
vi.mock('../src/platforms/facebook/runtime', () => ({ configuredFacebookEngine: mocks.configuredEngine }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: mocks.canUseFeature }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: mocks.canAccessFeature, canAccessPage: mocks.canAccessPage }));
vi.mock('../src/server/platforms/registry', () => ({ platformInbox: mocks.platformInbox, inboxPlatformIds: mocks.inboxPlatformIds }));

import { replyToInbox, syncInbox } from '../src/server/inbox/actions';
import { replyToFacebookInbox } from '../src/platforms/facebook/inbox';

const actor = { userId: 'user-1', workspaceId: 'workspace-1' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.membership.findUnique.mockResolvedValue({ id: 'membership-1', role: 'owner' });
  mocks.entitlements.mockResolvedValue({});
  mocks.permissions.mockResolvedValue({});
  mocks.canUseFeature.mockReturnValue(true);
  mocks.canAccessFeature.mockReturnValue(true);
  mocks.canAccessPage.mockReturnValue(true);
  mocks.config.mockImplementation(async key => key === 'platforms.facebook.enabled' ? true
    : key === 'inbox.messengerReplyWindowHours' ? 24
      : key === 'meta.inboxWriteScopes' ? ['pages_messaging', 'pages_manage_engagement'] : ['pages_messaging']);
  mocks.prisma.target.findFirst.mockResolvedValue({ id: 'target-1', providerId: 'page-1', accessToken: 'encrypted', socialAccount: { scopes: 'pages_messaging,pages_manage_engagement', tokenExpiresAt: null, invalidatedAt: null } });
  mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'conversation-1', remoteId: 'remote-1', targetId: 'target-1' });
  mocks.prisma.conversationMessage.findFirst.mockResolvedValue({ fromId: 'visitor-1', createdTime: new Date() });
  mocks.decrypt.mockReturnValue('page-secret');
  mocks.configuredEngine.mockResolvedValue(mocks.engine);
  mocks.engine.replyToConversation.mockResolvedValue('remote-message-1');
  mocks.platformInbox.mockResolvedValue({ reply: mocks.engine.replyToConversation });
  mocks.inboxPlatformIds.mockResolvedValue(['facebook']);
});

describe('Inbox operation errors', () => {
  it('returns a typed not-found error for a conversation outside the workspace', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue(null);

    await expect(replyToInbox(actor, { kind: 'message', id: 'missing', text: 'Hello' }))
      .rejects.toMatchObject({ name: 'OperationError', code: 'not_found', message: 'This conversation is unavailable in the current workspace.' });
    expect(mocks.platformInbox).not.toHaveBeenCalled();
  });

  it('keeps unexpected database failures untyped at the shared action boundary', async () => {
    const databaseFailure = new Error('database connection password detail');
    mocks.prisma.target.findFirst.mockRejectedValue(databaseFailure);

    await expect(syncInbox(actor, 'target-1')).rejects.toBe(databaseFailure);
    expect(databaseFailure).not.toBeInstanceOf(OperationError);
  });

  it('returns a typed validation error for an invalid Facebook reply', async () => {
    await expect(replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: '   ' }))
      .rejects.toMatchObject({ name: 'OperationError', code: 'invalid_request', message: 'Write a reply of 1 to 2,000 characters.' });
    expect(mocks.engine.replyToConversation).not.toHaveBeenCalled();
  });

  it('returns a typed authorization error when workspace membership is gone', async () => {
    mocks.prisma.membership.findUnique.mockResolvedValue(null);

    await expect(replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: 'Hello' }))
      .rejects.toMatchObject({ name: 'OperationError', code: 'unauthorized', message: 'You are no longer a member of this workspace.' });
  });

  it('returns a typed forbidden error for a page outside the member scope', async () => {
    mocks.canAccessPage.mockReturnValue(false);

    await expect(replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: 'Hello' }))
      .rejects.toMatchObject({ name: 'OperationError', code: 'forbidden', message: 'You do not have access to this Facebook Page.' });
    expect(mocks.engine.replyToConversation).not.toHaveBeenCalled();
  });

  it('returns a typed reconnect error when the Facebook connection is unavailable', async () => {
    mocks.prisma.target.findFirst.mockResolvedValue(null);

    await expect(replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: 'Hello' }))
      .rejects.toMatchObject({ name: 'OperationError', code: 'reconnect_required', message: 'This Facebook Page or its connection is unavailable. Reconnect it before using the inbox.' });
    expect(mocks.engine.replyToConversation).not.toHaveBeenCalled();
  });

  it('returns a typed not-found error when the requested conversation is absent', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue(null);

    await expect(replyToFacebookInbox(actor, { kind: 'message', id: 'missing', text: 'Hello' }))
      .rejects.toMatchObject({ name: 'OperationError', code: 'not_found', message: 'This conversation is unavailable in the current workspace.' });
  });

  it('returns a typed conflict when Facebook reply window is closed', async () => {
    mocks.prisma.conversationMessage.findFirst.mockResolvedValue({ fromId: 'visitor-1', createdTime: new Date(Date.now() - 25 * 60 * 60 * 1000) });

    await expect(replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: 'Hello' }))
      .rejects.toMatchObject({ name: 'OperationError', code: 'conflict' });
    expect(mocks.engine.replyToConversation).not.toHaveBeenCalled();
  });

  it('does not type unexpected database errors from Facebook actions', async () => {
    const databaseFailure = new Error('raw database detail');
    mocks.prisma.conversation.findFirst.mockRejectedValue(databaseFailure);

    await expect(replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: 'Hello' })).rejects.toBe(databaseFailure);
    expect(databaseFailure).not.toBeInstanceOf(OperationError);
  });

  it('does not type unexpected provider errors from Facebook actions', async () => {
    const providerFailure = new Error('provider transport detail');
    mocks.engine.replyToConversation.mockRejectedValue(providerFailure);

    await expect(replyToFacebookInbox(actor, { kind: 'message', id: 'conversation-1', text: 'Hello' })).rejects.toBe(providerFailure);
    expect(providerFailure).not.toBeInstanceOf(OperationError);
  });
});
