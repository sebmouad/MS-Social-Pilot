import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  target: { findFirst: vi.fn(), findMany: vi.fn() },
  conversation: { findFirst: vi.fn(), updateMany: vi.fn() },
  postComment: { findFirst: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  membership: { findUnique: vi.fn() },
}));
vi.mock('../src/server/data', () => ({ prisma: db }));

// Membership grants two channels. The double mirrors authorizeInbox: requested ids are intersected with grants.
const grants = ['channel-a', 'channel-b'];
const authorize = vi.hoisted(() => vi.fn());
vi.mock('../src/modules/inbox/server/access', () => ({ authorizeInbox: authorize }));
const host = vi.hoisted(() => ({ reply: vi.fn(), moderate: vi.fn(), canManage: vi.fn(), sync: vi.fn() }));
vi.mock('../src/server/platforms/registry', () => ({ inboxPlatformIds: async () => ['facebook'], platformInbox: async () => host }));
const workflow = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('../src/modules/inbox/server/workflow', () => ({ setInboxWorkflowResolved: workflow.resolve, canManageInboxWorkflow: vi.fn() }));
vi.mock('../src/modules/inbox/server/deletion', () => ({ deleteInboxCommentDurably: vi.fn() }));
vi.mock('../src/modules/inbox/server/comment-guard', () => ({ lockInboxChannel: vi.fn(), assertInboxDeletionsSettled: vi.fn() }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, run: () => Promise<unknown>) => run() }));
vi.mock('../src/server/config/store', () => ({
  runtimeConfig: async (key: string) => ({ 'inbox.noteMaxCharacters': 1000, 'inbox.noteHistoryLimit': 50, 'inbox.savedReplyPageLimit': 50, 'inbox.savedReplyNameMaxCharacters': 100, 'inbox.savedReplyBodyMaxCharacters': 2000, 'inbox.productivityAssigneeLimit': 100, 'inbox.workflowTransactionTimeoutMs': 5000, 'inbox.workflowTransactionMaxWaitMs': 2000 })[key],
}));

import { moderateInboxComment, replyToInbox } from '@/modules/inbox/server/actions';
import { listSavedReplies, performInboxProductivityAction, readInboxProductivity } from '../src/modules/inbox/server/productivity';
import { confirmation } from '../src/modules/inbox/productivity';

const social = { socialAccount: { provider: 'facebook' } };
const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const lastRequestedChannels = () => authorize.mock.calls.at(-1)![1].allowedChannelIds;

beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockImplementation(async (_actor: unknown, constraints: { allowedChannelIds?: readonly string[] } = {}) => {
    const ids = constraints.allowedChannelIds === undefined ? grants : constraints.allowedChannelIds.filter(id => grants.includes(id));
    return { channels: ids.map(id => ({ id, name: id })), channelIds: [...ids], timeZone: 'UTC' };
  });
  host.reply.mockResolvedValue({ ok: true });
  host.moderate.mockResolvedValue({ ok: true });
  // The conversation/comment rows belong to channel-b.
  db.conversation.findFirst.mockResolvedValue({ target: { id: 'channel-b', ...social } });
  db.postComment.findFirst.mockResolvedValue({ postTarget: { target: { id: 'channel-b', ...social } } });
});

describe('Inbox reply and moderation intersect every credential ceiling', () => {
  it('refuses an item outside the actor ceiling before contacting the platform', async () => {
    await expect(replyToInbox({ ...actor, allowedChannelIds: ['channel-a'] }, { kind: 'message', id: 'm1', text: 'Hi' })).rejects.toMatchObject({ code: 'not_found' });
    expect(lastRequestedChannels()).toEqual([]);
    expect(host.reply).not.toHaveBeenCalled();
  });

  it('refuses an item outside an explicit constraint ceiling', async () => {
    await expect(replyToInbox(actor, { kind: 'message', id: 'm1', text: 'Hi' }, { allowedChannelIds: ['channel-a'] })).rejects.toMatchObject({ code: 'not_found' });
    await expect(moderateInboxComment(actor, { id: 'c1', hidden: true }, { allowedChannelIds: ['channel-a'] })).rejects.toMatchObject({ code: 'not_found' });
    expect(host.reply).not.toHaveBeenCalled();
    expect(host.moderate).not.toHaveBeenCalled();
  });

  it('intersects the two ceilings instead of letting one overwrite the other', async () => {
    db.conversation.findFirst.mockResolvedValue({ target: { id: 'channel-a', ...social } });
    // Actor allows only channel-a, the explicit constraint only channel-b: nothing is left.
    await expect(replyToInbox({ ...actor, allowedChannelIds: ['channel-a'] }, { kind: 'message', id: 'm1', text: 'Hi' }, { allowedChannelIds: ['channel-b'] })).rejects.toMatchObject({ code: 'not_found' });
    expect(lastRequestedChannels()).toEqual([]);
    expect(host.reply).not.toHaveBeenCalled();
    // Both ceilings include channel-a: the single requested channel is the whole request.
    await expect(replyToInbox({ ...actor, allowedChannelIds: ['channel-a'] }, { kind: 'message', id: 'm1', text: 'Hi' }, { allowedChannelIds: ['channel-a', 'channel-b'] })).resolves.toEqual({ ok: true });
    expect(lastRequestedChannels()).toEqual(['channel-a']);
    expect(host.reply).toHaveBeenCalledTimes(1);
  });

  it('still honours current membership when no ceiling is supplied', async () => {
    await expect(moderateInboxComment(actor, { id: 'c1', hidden: false })).resolves.toEqual({ ok: true });
    expect(lastRequestedChannels()).toEqual(['channel-b']);
  });
});

describe('Inbox productivity actions respect the credential ceiling', () => {
  const restrictedActor = { ...actor, allowedChannelIds: ['channel-a'] };

  it('looks up items only in permitted channels for reads and writes', async () => {
    db.conversation.findFirst.mockResolvedValue(null);
    await expect(readInboxProductivity(restrictedActor, { kind: 'message', id: 'm1' })).rejects.toMatchObject({ code: 'not_found' });
    expect(db.conversation.findFirst.mock.calls[0]![0].where.targetId).toEqual({ in: ['channel-a'] });
    await expect(performInboxProductivityAction(restrictedActor, { action: 'assign', kind: 'message', id: 'm1', assigneeId: 'user-b', confirmation: confirmation.assign('message', 'm1', 'user-b') })).rejects.toMatchObject({ code: 'not_found' });
    expect(db.conversation.findFirst.mock.calls[1]![0].where.targetId).toEqual({ in: ['channel-a'] });
    expect(db.$transaction).not.toHaveBeenCalled();
    // Without a ceiling the member's own grants decide.
    db.conversation.findFirst.mockResolvedValue(null);
    await expect(readInboxProductivity(actor, { kind: 'message', id: 'm1' })).rejects.toMatchObject({ code: 'not_found' });
    expect(db.conversation.findFirst.mock.calls[2]![0].where.targetId).toEqual({ in: ['channel-a', 'channel-b'] });
  });

  it('requires all-resource access for workspace saved replies, before any query', async () => {
    await expect(listSavedReplies(restrictedActor, {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(performInboxProductivityAction(restrictedActor, { action: 'reply.create', name: 'Hello', body: 'Body', confirmation: confirmation.createReply('Hello') })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(performInboxProductivityAction(restrictedActor, { action: 'reply.update', id: 'r1', name: 'Hello', body: 'Body', confirmation: confirmation.updateReply('r1') })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(performInboxProductivityAction(restrictedActor, { action: 'reply.delete', id: 'r1', confirmation: confirmation.deleteReply('r1') })).rejects.toMatchObject({ code: 'forbidden' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it('keeps saved replies available to an unrestricted actor', async () => {
    db.$queryRaw.mockResolvedValue([]);
    await expect(listSavedReplies(actor, {})).resolves.toMatchObject({ ok: true, replies: [] });
  });
});
