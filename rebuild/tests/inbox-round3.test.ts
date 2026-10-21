vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    target: { findMany: vi.fn(), findFirst: vi.fn() }, conversation: { findMany: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn() },
    conversationMessage: { findFirst: vi.fn() }, postComment: { findMany: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn() },
    postTarget: { findFirst: vi.fn() }, membership: { findFirst: vi.fn() }, $queryRaw: vi.fn(),
  },
  authorize: vi.fn(), config: vi.fn(), operation: vi.fn(), resolved: vi.fn(), moderate: vi.fn(), remove: vi.fn(),
}));

vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: mocks.authorize }));
vi.mock('../src/modules/inbox/server/access', () => ({ authorizeInbox: mocks.authorize }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: mocks.operation }));
vi.mock('../src/modules/inbox/server/actions', () => ({ setInboxResolved: mocks.resolved, moderateInboxComment: mocks.moderate, deleteInboxComment: mocks.remove }));

import { readInboxList, quickConditions } from '@/modules/inbox/server/read';
import { bulkInboxAction } from '@/modules/inbox/server/bulk';
import { readInboxContactDetails } from '@/modules/inbox/server/details';
import { sentimentTrend } from '@/modules/inbox/details';
import { bulkConfirmation } from '@/modules/inbox/bulk';
import { inboxListInput } from '@/modules/inbox/query';
import { INBOX_MODULE_CONFIG } from '@/modules/inbox/config';

const actor = { userId: 'user-1', workspaceId: 'workspace-1' };
const settings: Record<string, unknown> = {
  'inbox.listPageSize': 25, 'inbox.threadPageSize': 25, 'inbox.searchMaxCharacters': 100, 'inbox.cursorMaxCharacters': 500, 'inbox.bulkMaxItems': 3,
  'inbox.mentionPrefix': '@', 'inbox.relatedPostsLimit': 2, 'inbox.sentimentTrendLimit': 5,
};
const sqlOf = (call: unknown[]) => { const value = call[0] as { strings?: string[]; sql?: string; values?: unknown[] }; return (value.strings ?? [value.sql ?? '']).join('?'); };
const sqlParts = (fragment: unknown) => { const value = fragment as { strings: string[]; values: unknown[] }; return { text: value.strings.join('?'), values: value.values }; };
const target = { id: 'target-1', name: 'Brand Page', providerId: 'page-1', socialAccount: { provider: 'facebook' } };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockImplementation(async (key: string) => settings[key]);
  mocks.authorize.mockResolvedValue({ channelIds: ['target-1'], channels: [{ id: 'target-1', name: 'Brand Page' }], timeZone: 'UTC' });
  mocks.operation.mockImplementation(async (_workspace: string, work: () => Promise<unknown>) => work());
  mocks.resolved.mockResolvedValue({ ok: true });
  mocks.moderate.mockResolvedValue({ ok: true });
  mocks.remove.mockResolvedValue({ ok: true, state: 'completed', remoteConfirmed: true, localConfirmed: true });
  mocks.prisma.conversation.aggregate.mockResolvedValue({ _max: { fetchedAt: null } });
  mocks.prisma.postComment.aggregate.mockResolvedValue({ _max: { fetchedAt: null } });
  mocks.prisma.$queryRaw.mockResolvedValue([]);
});

describe('Root settings declared for round 3', () => {
  it('declares every new bound with an active consumer and a sane default', () => {
    const byKey = new Map<string, (typeof INBOX_MODULE_CONFIG)[number]>(INBOX_MODULE_CONFIG.map(item => [item.key, item]));
    for (const key of ['inbox.savedReplyMaxCount', 'inbox.relatedPostsLimit', 'inbox.sentimentTrendLimit', 'inbox.mentionPrefix', 'inbox.bulkMaxItems']) {
      expect(byKey.get(key)?.consumption, key).toBe('active');
      expect(byKey.get(key)?.defaultValue, key).toBeDefined();
    }
  });
});

describe('quick filters', () => {
  it('turns the comma separated URL value into the service input', () => {
    expect(inboxListInput({ quick: 'unread,negative' })).toEqual({ quick: ['unread', 'negative'] });
    expect(inboxListInput({ quick: '' })).toEqual({ quick: [] });
    expect(inboxListInput({})).toEqual({});
  });

  it('applies every selected filter to each kind and reports them back in canonical order', async () => {
    const page = await readInboxList(actor, { quick: ['negative', 'unread'] });
    expect(page.quick).toEqual(['unread', 'negative']);
    const listing = sqlOf(mocks.prisma.$queryRaw.mock.calls[0]!);
    expect(listing).toContain('"unreadCount" > 0');
    expect(listing).toContain("pc.sentiment = 'negative'");
    // Reviews carry neither an unread count nor a classification, so they cannot match.
    expect(listing).toContain('AND false');
  });

  it('adds nothing to the page or the query when no quick filter is chosen', async () => {
    const page = await readInboxList(actor, {});
    expect('quick' in page).toBe(false);
    expect(sqlOf(mocks.prisma.$queryRaw.mock.calls[0]!)).not.toContain('"unreadCount" > 0');
  });

  it('rejects an unknown quick filter and reads the mention marker from Root', async () => {
    await expect(readInboxList(actor, { quick: ['vip'] })).rejects.toThrow(/valid Inbox filters/);
    await readInboxList(actor, { quick: ['mentions'] });
    expect(mocks.config).toHaveBeenCalledWith('inbox.mentionPrefix');
    const call = mocks.prisma.$queryRaw.mock.calls[0]![0] as { values: unknown[] };
    expect(call.values).toContain('@');
  });

  it('refuses the Mentions filter when the marker is empty', async () => {
    settings['inbox.mentionPrefix'] = '';
    try { await expect(readInboxList(actor, { quick: ['mentions'] })).rejects.toThrow(/unavailable/); } finally { settings['inbox.mentionPrefix'] = '@'; }
  });

  it('mirrors the needs-reply rule for unanswered and never guesses sentiment for messages', () => {
    const message = sqlParts(quickConditions(['unanswered', 'negative'], '@', 'message')).text;
    expect(message).toContain('"resolvedAt" IS NULL');
    expect(message).toContain('"sentById" IS NULL');
    expect(message).toContain('AND false');
    const comment = sqlParts(quickConditions(['unanswered'], '@', 'comment')).text;
    expect(comment).toContain('"isHidden" = false');
    expect(comment).toContain('NOT EXISTS');
    expect(sqlParts(quickConditions([], '@', 'comment')).text).toBe('');
  });
});

describe('bulk moderation service', () => {
  const comments = (...ids: string[]) => ids.map(id => ({ kind: 'comment' as const, id }));
  const run = (action: string, items: Array<{ kind: string; id: string }>, confirmation?: string) =>
    bulkInboxAction(actor, { action, items, confirmation: confirmation ?? bulkConfirmation(action as 'hide', items.length) });

  it('builds one exact confirmation per request', () => {
    expect(bulkConfirmation('delete', 3)).toBe('BULK DELETE 3 INBOX ITEMS');
  });

  it('refuses a wrong confirmation, too many items and comment-only actions on messages before touching anything', async () => {
    await expect(run('hide', comments('a', 'b'), 'BULK HIDE 1 INBOX ITEMS')).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(run('resolve', [...comments('a', 'b', 'c', 'd')])).rejects.toThrow(/up to 3/);
    await expect(run('hide', [{ kind: 'message', id: 'm1' }])).rejects.toThrow(/Only comments/);
    await expect(run('explode', comments('a'))).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.resolved).not.toHaveBeenCalled(); expect(mocks.moderate).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('checks write access first and passes the credential ceiling to every item', async () => {
    mocks.authorize.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'forbidden' }));
    await expect(run('resolve', comments('a'))).rejects.toThrow();
    mocks.authorize.mockResolvedValue({ channelIds: ['target-1'], channels: [], timeZone: 'UTC' });
    await bulkInboxAction(actor, { action: 'resolve', items: comments('a'), confirmation: bulkConfirmation('resolve', 1) }, { allowedChannelIds: ['target-1'] });
    expect(mocks.authorize).toHaveBeenLastCalledWith(actor, { allowedChannelIds: ['target-1'] }, 'write');
    expect(mocks.resolved).toHaveBeenCalledWith(actor, { kind: 'comment', id: 'a', resolved: true }, { allowedChannelIds: ['target-1'] });
  });

  it('reports each item on its own, so one failure never hides another result', async () => {
    const { OperationError } = await import('@/lib/operation-error');
    mocks.resolved.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new OperationError('not_found', 'This comment is unavailable.')).mockResolvedValueOnce({ ok: true });
    const result = await run('resolve', comments('a', 'b', 'c'));
    expect(result).toMatchObject({ ok: true, requested: 3, succeeded: 2, failed: 1 });
    expect(result.results.map(item => item.ok)).toEqual([true, false, true]);
    expect(result.results[1]).toMatchObject({ id: 'b', code: 'not_found', error: 'This comment is unavailable.' });
  });

  it('does not leak unexpected error text', async () => {
    mocks.resolved.mockRejectedValueOnce(new Error('connection string postgres://secret'));
    const result = await run('reopen', comments('a'));
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result.results[0]).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('counts an item without an ok receipt as failed rather than done', async () => {
    mocks.moderate.mockResolvedValueOnce(undefined);
    const result = await run('hide', comments('a'));
    expect(result).toMatchObject({ succeeded: 0, failed: 1 });
  });

  it('hides under the workspace operation lock, per item', async () => {
    await run('hide', comments('a', 'b'));
    expect(mocks.operation).toHaveBeenCalledTimes(2);
    expect(mocks.moderate).toHaveBeenCalledWith(actor, { id: 'a', hidden: true }, {});
    await run('unhide', comments('a'));
    expect(mocks.moderate).toHaveBeenLastCalledWith(actor, { id: 'a', hidden: false }, {});
  });

  it('deletes with the exact per-comment confirmation and treats an unfinished deletion as not done', async () => {
    mocks.remove.mockResolvedValueOnce({ ok: true, state: 'completed' }).mockResolvedValueOnce({ ok: true, state: 'uncertain' });
    const result = await run('delete', comments('a', 'b'));
    expect(mocks.remove).toHaveBeenNthCalledWith(1, actor, { id: 'a', confirmation: 'DELETE COMMENT a' }, {});
    expect(result).toMatchObject({ succeeded: 1, failed: 1 });
    expect(result.results[1]).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('counts duplicates once', async () => {
    const result = await bulkInboxAction(actor, { action: 'resolve', items: [...comments('a', 'a')], confirmation: bulkConfirmation('resolve', 1) });
    expect(result.requested).toBe(1); expect(mocks.resolved).toHaveBeenCalledTimes(1);
  });
});

describe('sentiment trend', () => {
  const at = (day: number, sentiment: 'positive' | 'neutral' | 'negative' | null) => ({ time: new Date(`2026-10-${String(day).padStart(2, '0')}T10:00:00Z`), sentiment });
  it('orders oldest first and reads direction from classified comments only', () => {
    expect(sentimentTrend([at(4, 'positive'), at(1, 'negative'), at(2, null), at(3, 'neutral')])).toMatchObject({ direction: 'improving', counts: { positive: 1, neutral: 1, negative: 1, unclassified: 1 } });
    expect(sentimentTrend([at(3, 'negative'), at(1, 'positive'), at(2, 'positive'), at(4, 'negative')]).direction).toBe('worsening');
    expect(sentimentTrend([at(1, 'neutral'), at(2, 'neutral')]).direction).toBe('steady');
    expect(sentimentTrend([at(2, 'negative'), at(1, 'positive')]).points[0]!.time.getUTCDate()).toBe(1);
  });
  it('is unknown, not steady, with fewer than two classified comments', () => {
    expect(sentimentTrend([]).direction).toBe('unknown');
    expect(sentimentTrend([at(1, 'negative'), at(2, null), at(3, null)])).toMatchObject({ direction: 'unknown', counts: { unclassified: 2, negative: 1 } });
  });
});

describe('conversation details', () => {
  const comment = (over: Record<string, unknown> = {}) => ({ fromId: 'person-1', fromName: 'Amina', resolvedAt: null, isHidden: false, assigneeId: 'member-1', postTargetId: 'pt-1', createdTime: new Date('2026-10-10T10:00:00Z'), sentiment: 'negative', postTarget: { target }, ...over });

  it('refuses a malformed key and an item outside the authorized channels', async () => {
    await expect(readInboxContactDetails(actor, { key: 'nope' })).rejects.toMatchObject({ code: 'invalid_request' });
    mocks.prisma.postComment.findFirst.mockResolvedValue(null);
    await expect(readInboxContactDetails(actor, { key: 'comment:c1' })).rejects.toMatchObject({ code: 'not_found' });
    mocks.authorize.mockResolvedValue({ channelIds: [], channels: [], timeZone: 'UTC' });
    await expect(readInboxContactDetails(actor, { key: 'comment:c1' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('scopes the lookup to the workspace and the allowed channels', async () => {
    mocks.prisma.postComment.findFirst.mockResolvedValue(null);
    await expect(readInboxContactDetails(actor, { key: 'comment:c1' }, { allowedChannelIds: ['target-1'] })).rejects.toThrow();
    expect(mocks.authorize).toHaveBeenCalledWith(actor, { allowedChannelIds: ['target-1'] });
    expect(mocks.prisma.postComment.findFirst.mock.calls[0]![0].where).toMatchObject({ id: 'c1', parentRemoteId: null, postTarget: { targetId: { in: ['target-1'] }, target: { workspaceId: 'workspace-1' }, post: { workspaceId: 'workspace-1' } } });
  });

  it('summarises a person from stored data inside the channel, bounded by Root limits', async () => {
    mocks.prisma.postComment.findFirst.mockResolvedValue(comment());
    mocks.prisma.membership.findFirst.mockResolvedValue({ user: { id: 'member-1', name: 'Nadia' } });
    mocks.prisma.$queryRaw.mockImplementation(async (query: { strings: string[] }) => {
      const sql = query.strings.join('?');
      if (sql.includes('FROM conversation_messages')) return [{ count: BigInt(2), first: new Date('2026-09-01T00:00:00Z') }];
      if (sql.includes('GROUP BY p.id')) return [{ id: 'p1', message: 'Autumn menu', comments: BigInt(3), last: new Date('2026-10-10T10:00:00Z') }, { id: 'p2', message: 'Opening hours', comments: BigInt(1), last: new Date('2026-10-02T10:00:00Z') }, { id: 'p3', message: 'Older', comments: BigInt(1), last: new Date('2026-09-02T10:00:00Z') }];
      if (sql.includes('ORDER BY pc."createdTime" DESC')) return [{ createdTime: new Date('2026-10-10T10:00:00Z'), sentiment: 'negative' }, { createdTime: new Date('2026-10-01T10:00:00Z'), sentiment: 'positive' }, { createdTime: new Date('2026-09-20T10:00:00Z'), sentiment: 'angry' }];
      if (sql.includes('MIN(pc."firstSeenAt")')) return [{ count: BigInt(4), first: new Date('2026-09-15T00:00:00Z') }];
      return [];
    });
    const details = await readInboxContactDetails(actor, { key: 'comment:c1' });
    expect(details).toMatchObject({ kind: 'comment', identityKnown: true, messageCount: 6, person: { name: 'Amina', remoteId: 'person-1' }, channel: { id: 'target-1', provider: 'facebook' }, state: { resolved: false, hidden: false, assignee: { id: 'member-1', name: 'Nadia' } } });
    expect(details.firstSeen?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(details.relatedPosts.map(post => post.id)).toEqual(['p1', 'p2']);
    expect(details.relatedPostsMore).toBe(true);
    // An unrecognised stored value is unknown, never neutral.
    expect(details.sentiment.counts).toMatchObject({ positive: 1, negative: 1, neutral: 0, unclassified: 1 });
    const limited = mocks.prisma.$queryRaw.mock.calls.map(call => call[0] as { values: unknown[] }).filter(query => query.values.includes(3) || query.values.includes(5));
    expect(limited.length).toBeGreaterThanOrEqual(2);
  });

  it('describes only the open comment when the platform gave no id for the person', async () => {
    mocks.prisma.postComment.findFirst.mockResolvedValue(comment({ fromId: null, assigneeId: null, sentiment: null }));
    mocks.prisma.postTarget.findFirst.mockResolvedValue({ post: { id: 'p1', message: 'Autumn menu' } });
    const details = await readInboxContactDetails(actor, { key: 'comment:c1' });
    expect(details).toMatchObject({ identityKnown: false, firstSeen: null, messageCount: 1, relatedPosts: [{ id: 'p1', comments: 1 }] });
    expect(details.sentiment.direction).toBe('unknown');
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('reads a review without inventing an identity', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ id: 'r1', targetId: 'target-1', reviewerName: 'Sam', createdTime: new Date('2026-10-03T10:00:00Z'), resolvedAt: new Date('2026-10-04T10:00:00Z') }]);
    mocks.prisma.target.findFirst.mockResolvedValue(target);
    const details = await readInboxContactDetails(actor, { key: 'review:r1' });
    expect(details).toMatchObject({ kind: 'review', identityKnown: false, messageCount: 1, person: { name: 'Sam', remoteId: null }, state: { resolved: true } });
    expect(details.sentiment.points).toEqual([]);
  });

  it('identifies the person of a conversation as the newest sender who is not the channel', async () => {
    mocks.prisma.conversation.findFirst.mockResolvedValue({ assigneeId: null, unreadCount: 2, resolvedAt: null, target });
    mocks.prisma.conversationMessage.findFirst.mockResolvedValue({ fromId: 'person-9', fromName: 'Jules' });
    const details = await readInboxContactDetails(actor, { key: 'message:m1' });
    expect(mocks.prisma.conversationMessage.findFirst.mock.calls[0]![0].where).toMatchObject({ conversationId: 'm1', sentById: null, NOT: { fromId: 'page-1' } });
    expect(details).toMatchObject({ kind: 'message', person: { name: 'Jules', remoteId: 'person-9' }, state: { unread: 2 } });
  });
});
