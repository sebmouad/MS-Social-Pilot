const history = vi.hoisted(() => ({ load: vi.fn(), record: vi.fn(), calls: [] as Array<{ postId: string; authorId: string; retention: number }> }));
vi.mock('@/modules/publishing/collaboration/server/versions', () => ({
  loadVersionRetention: history.load,
  recordPostVersion: history.record,
}));
vi.mock('@/modules/publishing/server/guard', () => ({ withPublishingTransaction: (_signal: AbortSignal, work: (tx: unknown) => Promise<unknown>) => db.$transaction(work), withPublishingOperation: (actor: unknown, _options: unknown, work: (context: unknown) => Promise<unknown>) => work({ actor, signal: new AbortController().signal }) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  $transaction: vi.fn(), $executeRaw: vi.fn(),
  post: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock('../src/server/data', () => ({ prisma: db }));

import { createLocalDraft, deleteLocalDraft, updateLocalDraft } from '../src/server/post-mutations';

const actor = { userId: 'u1', workspaceId: 'w1' };

beforeEach(() => {
  vi.clearAllMocks();
  history.calls = [];
  history.load.mockResolvedValue(50);
  history.record.mockImplementation(async (_tx: unknown, postId: string, authorId: string, retention: number) => { history.calls.push({ postId, authorId, retention }); return true; });
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db));
  db.membership.findUnique.mockResolvedValue({ role: 'owner' });
  db.post.create.mockResolvedValue({ id: 'new-id' });
  db.post.findFirst.mockResolvedValue({ id: 'p1' });
  db.post.updateMany.mockResolvedValue({ count: 1 });
  db.post.deleteMany.mockResolvedValue({ count: 1 });
});

describe('local draft mutation boundaries', () => {
  it('creates a local-only draft in the actor workspace without scheduling or destination rows', async () => {
    await createLocalDraft(actor, 'Draft text');
    const createArgs = db.post.create.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({ workspaceId: 'w1', authorId: 'u1', status: 'draft', scheduledAt: null, publishedAt: null });
    expect(createArgs.data).not.toHaveProperty('targets');
    expect(db.membership.findUnique.mock.calls[0][0].where.userId_workspaceId).toEqual({ userId: 'u1', workspaceId: 'w1' });
    expect(history.load).toHaveBeenCalledTimes(1);
    expect(history.calls).toEqual([{ postId: 'new-id', authorId: 'u1', retention: 50 }]);
    expect(history.record.mock.invocationCallOrder[0]).toBeLessThan(db.$executeRaw.mock.invocationCallOrder[0]!);
  });

  it('lets contributors edit and delete only their own unpublished unconnected drafts', async () => {
    db.membership.findUnique.mockResolvedValue({ role: 'contributor' });
    await updateLocalDraft(actor, 'p1', 'Updated');
    await deleteLocalDraft(actor, 'p2');
    const updateWhere = db.post.updateMany.mock.calls[0][0].where;
    const deleteWhere = db.post.deleteMany.mock.calls[0][0].where;
    for (const where of [updateWhere, deleteWhere]) {
      expect(where).toMatchObject({ id: expect.any(String), workspaceId: 'w1', status: 'draft', authorId: 'u1', publishedAt: null, targets: { none: {} } });
    }
    expect(history.calls).toEqual([
      { postId: 'p1', authorId: 'u1', retention: 50 },
      { postId: 'p1', authorId: 'u1', retention: 50 },
    ]);
    expect(history.record.mock.invocationCallOrder[0]).toBeLessThan(db.post.updateMany.mock.invocationCallOrder[0]!);
    expect(history.record.mock.invocationCallOrder[1]).toBeGreaterThan(db.post.updateMany.mock.invocationCallOrder[0]!);
  });

  it('blocks missing memberships, unauthorized roles, and mutations that match anything other than one draft', async () => {
    db.membership.findUnique.mockResolvedValue(null);
    await expect(createLocalDraft(actor, 'x')).rejects.toThrow(/no longer a member/);
    db.membership.findUnique.mockResolvedValue({ role: 'viewer' });
    await expect(createLocalDraft(actor, 'x')).rejects.toThrow(/permission/);
    db.membership.findUnique.mockResolvedValue({ role: 'owner' });
    db.post.findFirst.mockResolvedValue(null);
    history.record.mockClear();
    await expect(updateLocalDraft(actor, 'foreign', 'x')).rejects.toThrow(/unavailable/);
    expect(history.record).not.toHaveBeenCalled();
    db.post.findFirst.mockResolvedValue({ id: 'p1' });
    db.post.updateMany.mockResolvedValue({ count: 0 });
    await expect(updateLocalDraft(actor, 'p1', 'x')).rejects.toThrow(/unavailable/);
    db.post.deleteMany.mockResolvedValue({ count: 2 });
    await expect(deleteLocalDraft(actor, 'p1')).rejects.toThrow(/unavailable/);
  });

  it('aborts draft writes and audits when a version snapshot fails', async () => {
    history.record.mockRejectedValueOnce(new Error('history unavailable'));
    await expect(createLocalDraft(actor, 'Draft')).rejects.toThrow('history unavailable');
    expect(db.post.create).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw).not.toHaveBeenCalled();

    history.record.mockReset();
    history.record.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('history unavailable'));
    await expect(updateLocalDraft(actor, 'p1', 'Updated')).rejects.toThrow('history unavailable');
    expect(db.post.updateMany).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(history.record.mock.calls[0]![0]).toBe(history.record.mock.calls[1]![0]);
  });
});
