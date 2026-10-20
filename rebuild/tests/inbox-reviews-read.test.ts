import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { target: { findMany: vi.fn() }, conversation: { findMany: vi.fn(), aggregate: vi.fn() }, postComment: { findMany: vi.fn(), aggregate: vi.fn() }, $queryRaw: vi.fn(), $transaction: vi.fn() },
  tx: { $queryRaw: vi.fn(), $executeRaw: vi.fn() },
  authorize: vi.fn(), config: vi.fn(), guard: vi.fn(),
}));

vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: mocks.authorize }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: async (_id: string, operation: () => Promise<unknown>) => operation() }));

import { readInboxList, readInboxThread } from '@/modules/inbox/server/read';
import { setInboxWorkflowResolved } from '@/modules/inbox/server/workflow';

const actor = { userId: 'user-1', workspaceId: 'workspace-1' };
const limits: Record<string, number> = { 'inbox.listPageSize': 25, 'inbox.threadPageSize': 25, 'inbox.searchMaxCharacters': 100, 'inbox.cursorMaxCharacters': 500, 'inbox.workflowTransactionTimeoutMs': 5000, 'inbox.workflowTransactionMaxWaitMs': 2000 };
const target = { id: 'target-1', name: 'Brand Page', providerId: 'page-1', socialAccount: { provider: 'facebook' } };
const review = (overrides: Record<string, unknown> = {}) => ({ id: 'review-1', targetId: 'target-1', reviewerName: 'Sam', rating: null, recommendationType: null, reviewText: null, createdTime: new Date('2026-03-01T10:00:00Z'), resolvedAt: null, ...overrides });
const sqlOf = (call: unknown[]) => { const value = call[0] as string[] | { strings?: string[]; sql?: string }; return Array.isArray(value) ? value.join('?') : value.strings?.join('?') ?? value.sql ?? ''; };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.config.mockImplementation(async (key: string) => limits[key]);
  mocks.authorize.mockResolvedValue({ channelIds: ['target-1'], channels: [{ id: 'target-1', name: 'Brand Page' }], timeZone: 'UTC' });
  mocks.prisma.target.findMany.mockResolvedValue([target]);
  mocks.prisma.conversation.aggregate.mockResolvedValue({ _max: { fetchedAt: null } });
  mocks.prisma.postComment.aggregate.mockResolvedValue({ _max: { fetchedAt: null } });
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.tx) => Promise<unknown>) => work(mocks.tx));
  mocks.tx.$executeRaw.mockResolvedValue(1);
});

describe('stored reviews in the shared Inbox list', () => {
  it('lists reviews as their own kind, keeping a missing rating missing', async () => {
    mocks.prisma.$queryRaw.mockImplementation(async (query: { strings?: string[] }) => {
      const sql = (query.strings ?? []).join('?');
      if (sql.includes('COUNT(*)')) return [{ count: BigInt(1) }];
      if (sql.includes('FROM (') && sql.includes('LIMIT')) return [{ id: 'review-1', kind: 'review', time: new Date('2026-03-01T10:00:00Z') }];
      if (sql.includes('page_reviews r') && sql.includes('"resolvedAt"')) return [review({ recommendationType: 'positive' })];
      return [{ at: null }];
    });
    const page = await readInboxList(actor, { kind: 'review' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ key: 'review:review-1', kind: 'review', author: 'Sam', rating: null, recommendation: 'positive', needsReply: false, resolved: false, hidden: false });
    expect(page.filters.kind).toBe('review');
  });
  it('queries reviews through the target join (tenant check) and the selected channels only', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([]);
    await readInboxList(actor, { kind: 'all' });
    const listing = sqlOf(mocks.prisma.$queryRaw.mock.calls[0]!);
    expect(listing).toContain('page_reviews r JOIN targets t');
    expect(listing).toContain('t."workspaceId"');
  });
  it('rejects an unknown kind', async () => {
    await expect(readInboxList(actor, { kind: 'rating' })).rejects.toThrow(/valid Inbox filters/);
  });
  it('opens one review as a thread with its rating, and refuses another channel scope', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([review({ rating: 2, reviewText: 'Slow service' })]);
    const { thread, history } = await readInboxThread(actor, { key: 'review:review-1' });
    expect(thread).toMatchObject({ kind: 'review', rating: 2, recommendation: null, resolved: false, postText: null, lastInbound: null });
    expect(thread.entries).toEqual([expect.objectContaining({ author: 'Sam', text: 'Slow service', fromChannel: false })]);
    expect(history).toMatchObject({ total: 1, shown: 1, olderCursor: null, newerCursor: null });
    mocks.authorize.mockResolvedValue({ channelIds: [], channels: [], timeZone: 'UTC' });
    await expect(readInboxThread(actor, { key: 'review:review-1' })).rejects.toThrow(/unavailable/);
  });
  it('does not accept a history cursor on a review', async () => {
    await expect(readInboxThread(actor, { key: 'review:review-1', cursor: 'abc' })).rejects.toThrow(/valid Inbox filters/);
  });
});

describe('resolving a review', () => {
  it('stamps resolution on the scoped review and audits it without any provider call', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ targetId: 'target-1' }]);
    mocks.tx.$queryRaw.mockResolvedValue([{ targetId: 'target-1' }]);
    expect(await setInboxWorkflowResolved(actor, { kind: 'review', id: 'review-1', resolved: true })).toEqual({ ok: true, kind: 'review', id: 'review-1', resolved: true });
    expect(sqlOf(mocks.tx.$queryRaw.mock.calls[0]!)).toContain('UPDATE page_reviews');
    expect(JSON.stringify(mocks.tx.$executeRaw.mock.calls)).toContain('inbox.review_resolved');
  });
  it('reopens with a null resolution time', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ targetId: 'target-1' }]);
    mocks.tx.$queryRaw.mockResolvedValue([{ targetId: 'target-1' }]);
    await setInboxWorkflowResolved(actor, { kind: 'review', id: 'review-1', resolved: false });
    expect(JSON.stringify(mocks.tx.$executeRaw.mock.calls)).toContain('inbox.review_reopened');
    expect((mocks.tx.$queryRaw.mock.calls[0] as unknown[])[1]).toBeNull();
  });
  it('fails closed when the review is not in an authorized channel of this workspace', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([]);
    await expect(setInboxWorkflowResolved(actor, { kind: 'review', id: 'review-x', resolved: true })).rejects.toThrow(/review is unavailable/);
    expect(mocks.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('loses a race with deletion without writing an audit record', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ targetId: 'target-1' }]);
    mocks.tx.$queryRaw.mockResolvedValue([]);
    await expect(setInboxWorkflowResolved(actor, { kind: 'review', id: 'review-1', resolved: true })).rejects.toThrow(/review is unavailable/);
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled();
  });
});
