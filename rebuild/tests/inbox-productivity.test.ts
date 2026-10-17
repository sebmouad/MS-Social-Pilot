import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { conversation: { findFirst: vi.fn(), updateMany: vi.fn() }, postComment: { findFirst: vi.fn(), updateMany: vi.fn() }, membership: { findUnique: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() },
  config: vi.fn(), authorize: vi.fn(), workspace: vi.fn(), lock: vi.fn(), deletions: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/modules/inbox/server/access', () => ({ authorizeInbox: mocks.authorize }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: mocks.workspace }));
vi.mock('../src/modules/inbox/server/comment-guard', () => ({ lockInboxChannel: mocks.lock, assertInboxDeletionsSettled: mocks.deletions }));

import { listSavedReplies, performInboxProductivityAction, readInboxProductivity } from '../src/modules/inbox/server/productivity';

const actor = { userId: 'member-a', workspaceId: 'workspace-a' };
const caps = {
  'inbox.noteMaxCharacters': 2000, 'inbox.noteHistoryLimit': 100, 'inbox.savedReplyPageLimit': 100,
  'inbox.savedReplyNameMaxCharacters': 100, 'inbox.savedReplyBodyMaxCharacters': 2000,
  'inbox.productivityAssigneeLimit': 500, 'inbox.workflowTransactionTimeoutMs': 5000,
  'inbox.workflowTransactionMaxWaitMs': 500,
};
const sqlText = (query: unknown) => typeof query === 'string' ? query : (query as { sql?: string })?.sql ?? (query as string[])?.join('') ?? '';
let actorRole = 'contributor'; let noteRow: { id: string; kind: string; itemId: string; authorId: string | null } | null = null;
let noteHistory: unknown[] = []; let replyRows: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks(); actorRole = 'contributor'; noteRow = null; noteHistory = []; replyRows = [];
  mocks.config.mockImplementation(async (key: string) => caps[key as keyof typeof caps]);
  mocks.authorize.mockResolvedValue({ channelIds: ['channel-a'], channels: [] });
  mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'conversation-a', targetId: 'channel-a', assigneeId: null });
  mocks.prisma.postComment.findFirst.mockResolvedValue({ id: 'comment-a', assigneeId: null, postTarget: { targetId: 'channel-a' } });
  mocks.prisma.conversation.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.postComment.updateMany.mockResolvedValue({ count: 1 });
  mocks.prisma.membership.findUnique.mockResolvedValue({ role: actorRole });
  mocks.prisma.$queryRaw.mockImplementation(async (query: unknown) => {
    const sql = sqlText(query);
    if (sql.includes('SELECT m.id, m.role::text AS role')) return [{ id: 'membership-a', role: actorRole }];
    if (sql.includes('SELECT m."userId" AS id')) return [{ id: actor.userId, role: actorRole }, { id: 'assignee-a', role: 'editor' }];
    if (sql.includes('SELECT n.id')) return noteHistory;
    if (sql.includes('SELECT u.id, u.name')) return [];
    if (sql.includes('FROM inbox_notes')) return noteRow ? [noteRow] : [];
    if (sql.includes('FROM saved_replies')) return replyRows;
    return [];
  });
  mocks.prisma.$executeRaw.mockResolvedValue(1);
  mocks.workspace.mockImplementation(async (_workspace: string, operation: () => Promise<unknown>) => operation());
  mocks.prisma.$transaction.mockImplementation(async (operation: (tx: typeof mocks.prisma) => Promise<unknown>) => operation(mocks.prisma));
});

describe('Inbox productivity service', () => {
  it('reads only an authorized message with workspace and selected-channel constraints', async () => {
    noteHistory = [{ id: 'note-a', authorId: 'member-b', authorName: 'Teammate', body: 'private', createdAt: new Date() }];
    const result = await readInboxProductivity(actor, { kind: 'message', id: 'conversation-a' });
    expect(result.notes[0]).toMatchObject({ id: 'note-a', canDelete: false });
    expect(mocks.prisma.conversation.findFirst.mock.calls[0]?.[0].where).toMatchObject({ id: 'conversation-a', targetId: { in: ['channel-a'] }, target: { workspaceId: 'workspace-a' } });
    const noteQuery = mocks.prisma.$queryRaw.mock.calls.find(call => sqlText(call[0]).includes('SELECT n.id'))?.[0];
    expect(sqlText(noteQuery)).toContain('"workspaceId"');
    expect(sqlText(noteQuery)).toContain('"itemId"');
  });

  it('refuses inaccessible comments before reading notes or membership', async () => {
    mocks.authorize.mockResolvedValue({ channelIds: [], channels: [] });
    await expect(readInboxProductivity(actor, { kind: 'comment', id: 'comment-a' })).rejects.toMatchObject({ code: 'not_found' });
    expect(mocks.prisma.postComment.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('fails closed when a stored Root limit is invalid and never builds an unbounded read', async () => {
    mocks.config.mockImplementation(async (key: string) => key === 'inbox.noteHistoryLimit' ? Number.NaN : caps[key as keyof typeof caps]);
    await expect(readInboxProductivity(actor, { kind: 'message', id: 'conversation-a' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('refuses oversized assignment directories instead of returning a truncated team list', async () => {
    mocks.prisma.$queryRaw.mockImplementation(async (query: unknown) => sqlText(query).includes('SELECT n.id')
      ? [] : sqlText(query).includes('SELECT u.id, u.name') ? Array.from({ length: 501 }, (_, i) => ({ id: `member-${i}`, name: `Member ${i}` })) : []);
    await expect(readInboxProductivity(actor, { kind: 'message', id: 'conversation-a' })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('caps saved-reply queries at the Root page limit and escapes literal search wildcards', async () => {
    await listSavedReplies(actor, { q: 'a%_\\b', limit: 99 });
    const query = mocks.prisma.$queryRaw.mock.calls[0]?.[0];
    expect(sqlText(query)).toContain('saved_replies');
    expect(sqlText(query)).toContain('"workspaceId"');
    expect((query as { values?: unknown[] }).values).toContain('%a\\%\\_\\\\b%');
  });

  it('validates active assignees and reports no mutation when the item disappears during assignment', async () => {
    mocks.prisma.$queryRaw.mockImplementation(async (query: unknown) => sqlText(query).includes('SELECT m."userId" AS id')
      ? [{ id: actor.userId, role: actorRole }] : []);
    await expect(performInboxProductivityAction(actor, { action: 'assign', kind: 'message', id: 'conversation-a', assigneeId: 'foreign-user', confirmation: 'ASSIGN INBOX message conversation-a TO foreign-user' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();

    mocks.prisma.$queryRaw.mockImplementation(async (query: unknown) => sqlText(query).includes('SELECT m."userId" AS id')
      ? [{ id: actor.userId, role: actorRole }, { id: 'assignee-a', role: 'editor' }] : []);
    mocks.prisma.conversation.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(performInboxProductivityAction(actor, { action: 'assign', kind: 'message', id: 'conversation-a', assigneeId: 'assignee-a', confirmation: 'ASSIGN INBOX message conversation-a TO assignee-a' })).rejects.toMatchObject({ code: 'not_found' });
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not assign to a client-role workspace membership', async () => {
    mocks.prisma.$queryRaw.mockImplementation(async (query: unknown) => sqlText(query).includes('SELECT m."userId" AS id')
      ? [{ id: actor.userId, role: actorRole }, { id: 'assignee-a', role: 'client' }] : []);
    await expect(performInboxProductivityAction(actor, { action: 'assign', kind: 'message', id: 'conversation-a', assigneeId: 'assignee-a', confirmation: 'ASSIGN INBOX message conversation-a TO assignee-a' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();
  });

  it('assigns a comment only after locking the active actor and assignee, then records metadata-only audit', async () => {
    const result = await performInboxProductivityAction(actor, { action: 'assign', kind: 'comment', id: 'comment-a', assigneeId: 'assignee-a', confirmation: 'ASSIGN INBOX comment comment-a TO assignee-a' });
    expect(result).toMatchObject({ ok: true, action: 'assign', kind: 'comment', assigneeId: 'assignee-a' });
    expect(mocks.prisma.postComment.updateMany.mock.calls[0]?.[0].where.postTarget).toMatchObject({ targetId: 'channel-a', target: { workspaceId: 'workspace-a' }, post: { workspaceId: 'workspace-a' } });
    expect(mocks.prisma.$queryRaw.mock.calls.filter(call => /FOR SHARE OF m, u/.test(sqlText(call[0])))).toHaveLength(1);
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledOnce();
  });

  it('rechecks the active actor membership in the mutation transaction before assignment', async () => {
    mocks.prisma.$queryRaw.mockImplementation(async (query: unknown) => sqlText(query).includes('SELECT m.id, m.role::text AS role') ? [] : []);
    await expect(performInboxProductivityAction(actor, { action: 'assign', kind: 'message', id: 'conversation-a', assigneeId: null, confirmation: 'ASSIGN INBOX message conversation-a TO UNASSIGNED' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.prisma.conversation.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('fails closed on corrupt transaction bounds before opening a transaction', async () => {
    mocks.config.mockImplementation(async (key: string) => key === 'inbox.workflowTransactionTimeoutMs' ? 0 : caps[key as keyof typeof caps]);
    await expect(performInboxProductivityAction(actor, { action: 'assign', kind: 'message', id: 'conversation-a', assigneeId: null, confirmation: 'ASSIGN INBOX message conversation-a TO UNASSIGNED' })).rejects.toMatchObject({ code: 'unavailable' });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('writes a private note and audit in one transaction without placing its body in audit parameters', async () => {
    const body = 'Internal follow-up that must remain private';
    const receipt = await performInboxProductivityAction(actor, { action: 'note.add', kind: 'message', id: 'conversation-a', body, confirmation: 'ADD PRIVATE NOTE message conversation-a' });
    expect(receipt).toMatchObject({ ok: true, action: 'note.add' });
    expect(mocks.lock).toHaveBeenCalledWith(mocks.prisma, 'workspace-a', 'channel-a');
    expect(mocks.deletions).toHaveBeenCalledWith(mocks.prisma, 'workspace-a', ['channel-a']);
    expect(mocks.prisma.$transaction).toHaveBeenCalledOnce();
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(mocks.prisma.$executeRaw.mock.calls[0]).toContain(body);
    expect(mocks.prisma.$executeRaw.mock.calls[1]).not.toContain(body);
  });

  it('stops note creation when deletion recovery is unsettled and leaves no audit', async () => {
    mocks.deletions.mockRejectedValueOnce(new Error('uncertain deletion'));
    await expect(performInboxProductivityAction(actor, { action: 'note.add', kind: 'message', id: 'conversation-a', body: 'Do not commit', confirmation: 'ADD PRIVATE NOTE message conversation-a' })).rejects.toThrow('uncertain deletion');
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('permits deleting own note but blocks deleting another author’s note for ordinary members', async () => {
    noteRow = { id: 'note-a', kind: 'message', itemId: 'conversation-a', authorId: 'other-user' };
    await expect(performInboxProductivityAction(actor, { action: 'note.delete', id: 'note-a', confirmation: 'DELETE PRIVATE NOTE note-a' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();

    noteRow = { ...noteRow, authorId: actor.userId };
    await expect(performInboxProductivityAction(actor, { action: 'note.delete', id: 'note-a', confirmation: 'DELETE PRIVATE NOTE note-a' })).resolves.toMatchObject({ ok: true, action: 'note.delete' });
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('allows an active workspace manager to delete another author’s note', async () => {
    actorRole = 'admin'; mocks.prisma.membership.findUnique.mockResolvedValue({ role: actorRole });
    mocks.prisma.$queryRaw.mockImplementation(async (query: unknown) => sqlText(query).includes('FROM inbox_notes')
      ? [{ id: 'note-a', kind: 'message', itemId: 'conversation-a', authorId: 'other-user' }]
      : sqlText(query).includes('SELECT m.id, m.role::text AS role') ? [{ id: 'membership-a', role: actorRole }] : []);
    await expect(performInboxProductivityAction(actor, { action: 'note.delete', id: 'note-a', confirmation: 'DELETE PRIVATE NOTE note-a' })).resolves.toMatchObject({ ok: true });
  });

  it('creates, updates and deletes saved replies only inside the current workspace', async () => {
    await expect(performInboxProductivityAction(actor, { action: 'reply.create', name: 'Greeting', body: 'Hello', confirmation: 'CREATE SAVED REPLY Greeting' })).resolves.toMatchObject({ ok: true, action: 'reply.create' });
    replyRows = [{ id: 'reply-a' }];
    await expect(performInboxProductivityAction(actor, { action: 'reply.update', id: 'reply-a', name: 'Updated', body: 'Welcome', confirmation: 'UPDATE SAVED REPLY reply-a' })).resolves.toMatchObject({ ok: true, action: 'reply.update', id: 'reply-a' });
    await expect(performInboxProductivityAction(actor, { action: 'reply.delete', id: 'reply-a', confirmation: 'DELETE SAVED REPLY reply-a' })).resolves.toMatchObject({ ok: true, action: 'reply.delete', id: 'reply-a' });
    replyRows = [];
    await expect(performInboxProductivityAction(actor, { action: 'reply.update', id: 'foreign-reply', name: 'Changed', body: 'No', confirmation: 'UPDATE SAVED REPLY foreign-reply' })).rejects.toMatchObject({ code: 'not_found' });
    const scopedLocks = mocks.prisma.$queryRaw.mock.calls.filter(call => sqlText(call[0]).includes('FROM saved_replies'));
    expect(scopedLocks.every(call => sqlText(call[0]).includes('"workspaceId"'))).toBe(true);
  });

  it('rejects malformed, oversize and unconfirmed actions before mutating', async () => {
    const before = mocks.prisma.$transaction.mock.calls.length;
    await expect(performInboxProductivityAction(actor, { action: 'note.add', kind: 'message', id: 'conversation-a', body: 'x'.repeat(2001), confirmation: 'ADD PRIVATE NOTE message conversation-a' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(performInboxProductivityAction(actor, { action: 'reply.create', name: 'x'.repeat(101), body: 'body', confirmation: 'CREATE SAVED REPLY wrong' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(performInboxProductivityAction(actor, { action: 'reply.delete', id: 'reply-a', confirmation: 'DELETE SAVED REPLY reply-a', extra: true })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(before);
  });
});
