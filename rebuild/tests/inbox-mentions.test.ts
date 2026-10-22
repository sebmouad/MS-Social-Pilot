vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { conversation: { findFirst: vi.fn() }, postComment: { findFirst: vi.fn() }, membership: { findUnique: vi.fn() }, $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() },
  config: vi.fn(), authorize: vi.fn(), enqueue: vi.fn(), policy: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/modules/inbox/server/access', () => ({ authorizeInbox: mocks.authorize }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: async (_id: string, run: () => Promise<unknown>) => run() }));
vi.mock('../src/modules/inbox/server/comment-guard', () => ({ lockInboxChannel: vi.fn(), assertInboxDeletionsSettled: vi.fn() }));
vi.mock('@/modules/settings/notifications/server', () => ({ enqueueNotification: mocks.enqueue, loadNotificationPolicy: mocks.policy }));

import { performInboxProductivityAction, readInboxProductivity } from '../src/modules/inbox/server/productivity';

const actor = { userId: 'member-a', workspaceId: 'workspace-a' };
const caps: Record<string, unknown> = {
  'inbox.noteMaxCharacters': 2000, 'inbox.noteHistoryLimit': 100, 'inbox.savedReplyPageLimit': 100,
  'inbox.savedReplyNameMaxCharacters': 100, 'inbox.savedReplyBodyMaxCharacters': 2000,
  'inbox.productivityAssigneeLimit': 500, 'inbox.savedReplyMaxCount': 200, 'inbox.workflowTransactionTimeoutMs': 5000,
  'inbox.workflowTransactionMaxWaitMs': 500, 'inbox.mentionMaxCount': 20, 'inbox.mentionSuggestionLimit': 20,
  'inbox.mentionNotificationsEnabled': true,
};
const sqlText = (query: unknown) => typeof query === 'string' ? query : (query as { sql?: string })?.sql ?? (query as TemplateStringsArray)?.join?.('?') ?? '';
let members: Array<{ id: string; name: string }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  members = [{ id: 'member-b', name: 'Bea' }, { id: 'member-c', name: 'Cal' }];
  mocks.config.mockImplementation(async (key: string) => caps[key]);
  mocks.authorize.mockResolvedValue({ channelIds: ['channel-a'], channels: [] });
  mocks.prisma.conversation.findFirst.mockResolvedValue({ id: 'conversation-a', targetId: 'channel-a', assigneeId: null });
  mocks.prisma.membership.findUnique.mockResolvedValue({ role: 'contributor' });
  mocks.prisma.$queryRaw.mockImplementation(async (query: unknown) => {
    const sql = sqlText(query);
    if (sql.includes('SELECT m.id, m.role::text AS role')) return [{ id: 'membership-a', role: 'contributor' }];
    if (sql.includes('SELECT n.id')) return [];
    if (sql.includes('FROM memberships m JOIN users u')) return members;
    return [];
  });
  mocks.prisma.$executeRaw.mockResolvedValue(1);
  mocks.prisma.$transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) => operation(mocks.prisma));
  mocks.enqueue.mockResolvedValue({ id: 'nt_a', inserted: true });
  mocks.policy.mockResolvedValue({ maxRecipientsPerEvent: 200 });
});

const addNote = (body: string, mentionIds?: string[]) => performInboxProductivityAction(actor, {
  action: 'note.add', kind: 'message', id: 'conversation-a', body, ...(mentionIds ? { mentionIds } : {}), confirmation: 'ADD PRIVATE NOTE message conversation-a',
});

describe('inbox note mentions', () => {
  it('stores mentions only for teammates who can see the channel and are named in the note', async () => {
    const result = await addNote('Looping in @Bea for this', ['member-b', 'member-c', 'member-a']);
    expect(result).toMatchObject({ ok: true, mentionIds: ['member-b'], notified: 'queued' });
    const insert = mocks.prisma.$executeRaw.mock.calls.find(call => sqlText(call[0]).includes('INSERT INTO inbox_notes'))!;
    expect(sqlText(insert[0])).toContain('"mentionIds"');
  });

  it('drops requested ids whose @name never appears in the body', async () => {
    const result = await addNote('No names here', ['member-b']);
    expect(result).toMatchObject({ mentionIds: [], notified: 'none' });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('never notifies the author about their own mention', async () => {
    members = [{ id: 'member-a', name: 'Ann' }, { id: 'member-b', name: 'Bea' }];
    const result = await addNote('@Ann please also see @Bea', ['member-a', 'member-b']);
    expect(result).toMatchObject({ mentionIds: ['member-b'] });
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue.mock.calls[0]?.[1]).toMatchObject({ kind: 'inbox_note_mention', userId: 'member-b', targetId: 'channel-a' });
  });

  it('notifies nothing when mention notifications are switched off, but still stores the names', async () => {
    mocks.config.mockImplementation(async (key: string) => (key === 'inbox.mentionNotificationsEnabled' ? false : caps[key]));
    const result = await addNote('See @Bea', ['member-b']);
    expect(result).toMatchObject({ mentionIds: ['member-b'], notified: 'none' });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('refuses more mentions than the Root limit before writing', async () => {
    mocks.config.mockImplementation(async (key: string) => (key === 'inbox.mentionMaxCount' ? 1 : caps[key]));
    await expect(addNote('@Bea and @Cal', ['member-b', 'member-c'])).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('lists mentionable teammates with the notes', async () => {
    const result = await readInboxProductivity(actor, { kind: 'message', id: 'conversation-a' });
    expect(result).toMatchObject({ mentionable: [{ id: 'member-b', name: 'Bea' }, { id: 'member-c', name: 'Cal' }] });
    const query = mocks.prisma.$queryRaw.mock.calls.map(call => sqlText(call[0])).find(sql => sql.includes('member_page_access'))!;
    expect(query).toContain(`m.role::text <> 'client'`);
  });

  it('accepts mentionIds through the MCP tool arguments', async () => {
    const { executeInboxProductivityTool } = await import('../src/modules/inbox/productivity-mcp');
    const result = await executeInboxProductivityTool(actor, 'add_inbox_private_note', { kind: 'message', id: 'conversation-a', body: 'See @Bea', mentionIds: ['member-b'], confirmation: 'ADD PRIVATE NOTE message conversation-a' }, 25);
    expect(result).toMatchObject({ ok: true, mentionIds: ['member-b'] });
  });
});
