// Contract tests for the neutral review-participant protocol. The transaction is a
// snapshot/rollback fake: it proves lifecycle wiring (ordering, shared tx, error
// propagation), not PostgreSQL rollback itself, which is Prisma's guarantee.
vi.mock('@/modules/publishing/server/guard', () => ({
  withPublishingTransaction: (_signal: AbortSignal, work: (tx: unknown) => Promise<unknown>) => db.$transaction(work),
  withPublishingOperation: (actor: unknown, options: unknown, work: (context: unknown) => Promise<unknown>) => {
    guard.options.push(options);
    return work({ actor, signal: guard.signal, lockTargets: async () => {} });
  },
}));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => ({ options: [] as unknown[], signal: new AbortController().signal }));
const store = vi.hoisted(() => ({
  post: { status: 'pending_approval', scheduledAt: null as Date | null },
  approval: 'pending', audits: [] as string[], domain: [] as string[], log: [] as string[],
}));
const db = vi.hoisted(() => ({
  membership: { findUnique: vi.fn() },
  target: { findMany: vi.fn() },
  postTarget: { findMany: vi.fn() },
  post: { findFirst: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: db }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async () => 10000 }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: async () => ({}), hasPlatformCapability: () => true }));
vi.mock('../src/server/platforms/registry', () => ({ platformFor: async () => null }));

import { reviewPost, type ReviewParticipant } from '@/modules/publishing/server/lifecycle';

const actor = { userId: 'u1', workspaceId: 'w1' };

beforeEach(() => {
  vi.clearAllMocks();
  guard.options.length = 0;
  Object.assign(store, { post: { status: 'pending_approval', scheduledAt: null }, approval: 'pending', audits: [], domain: [], log: [] });
  db.membership.findUnique.mockResolvedValue({ role: 'editor' });
  db.postTarget.findMany.mockResolvedValue([]);
  db.post.findFirst.mockImplementation(async () => ({ id: 'p1', authorId: 'u2', status: store.post.status, scheduledAt: store.post.scheduledAt }));
  db.post.updateMany.mockImplementation(async (args: { where: { status: string }; data: { status: string } }) => {
    if (store.post.status !== args.where.status) return { count: 0 };
    store.post.status = args.data.status;
    store.log.push('mutate');
    return { count: 1 };
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('INSERT INTO root_activities')) { store.audits.push(String(values[2])); store.log.push('audit'); }
    else if (sql.includes('UPDATE posts SET "approvalStatus"')) { store.approval = String(values[0]); store.log.push('approval'); }
    return 1;
  });
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => {
    const snapshot = structuredClone({ post: store.post, approval: store.approval, audits: store.audits, domain: store.domain });
    try { return await work(db); }
    catch (error) { Object.assign(store, snapshot); throw error; }
  });
});

describe('reviewPost participant protocol', () => {
  it('keeps legacy callers working without a participant, including the original argument shape', async () => {
    await reviewPost(actor, 'p1', 'approve');
    await expect(reviewPost(actor, 'p1', 'approve', 'again')).rejects.toMatchObject({ code: 'conflict' });
    expect(store.post.status).toBe('draft');
    expect(store.audits).toEqual(['publishing.post_approved']);
    expect(guard.options[0]).toEqual({ postId: 'p1', feature: 'publishing/approvals' });
  });

  it('accepts an empty participant and one with a single callback', async () => {
    await reviewPost(actor, 'p1', 'reject', undefined, {});
    expect(store.post.status).toBe('rejected');
    store.post.status = 'pending_approval';
    await reviewPost(actor, 'p1', 'reject', undefined, { after: async () => { store.log.push('after'); } });
    expect(store.log).toContain('after');
  });

  it('runs before, mutation, approval update, after, then audit, all on the same transaction client', async () => {
    const seen: unknown[] = [];
    const participant: ReviewParticipant = {
      before: async (tx, context) => { seen.push(tx); store.log.push('before'); expect(store.post.status).toBe('pending_approval'); expect(context.resultingStatus).toBe('draft'); },
      after: async (tx) => { seen.push(tx); store.log.push('after'); expect(store.post.status).toBe('draft'); store.domain.push('outcome'); },
    };
    await reviewPost(actor, 'p1', 'approve', '  looks good  ', participant);
    expect(store.log).toEqual(['before', 'mutate', 'approval', 'after', 'audit']);
    expect(seen).toEqual([db, db]);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(store.domain).toEqual(['outcome']);
    expect(store.audits).toEqual(['publishing.post_approved']);
  });

  it('passes a frozen neutral context with the trimmed note and the scheduled outcome', async () => {
    const scheduledAt = new Date(Date.now() + 3_600_000);
    store.post.scheduledAt = scheduledAt;
    let received: Parameters<NonNullable<ReviewParticipant['before']>>[1] | undefined;
    await reviewPost(actor, 'p1', 'approve', ' ok ', { before: async (_tx, context) => { received = context; } });
    expect(received).toMatchObject({ postId: 'p1', decision: 'approve', note: 'ok', resultingStatus: 'scheduled', post: { id: 'p1', status: 'pending_approval', scheduledAt } });
    expect(received?.actor).toEqual(actor);
    expect(Object.isFrozen(received)).toBe(true);
    expect(Object.isFrozen(received?.post)).toBe(true);
    await expect(Promise.resolve().then(() => { (received as { decision: string }).decision = 'reject'; })).rejects.toThrow(TypeError);
  });

  it('reports a null note and rejected outcome for a rejection without note', async () => {
    let received: Parameters<NonNullable<ReviewParticipant['before']>>[1] | undefined;
    await reviewPost(actor, 'p1', 'reject', '   ', { before: async (_tx, context) => { received = context; } });
    expect(received).toMatchObject({ note: null, resultingStatus: 'rejected', decision: 'reject' });
  });

  it('refuses in before without changing status, approval state, audit or running after', async () => {
    const after = vi.fn();
    const refusal = new Error('share link expired');
    await expect(reviewPost(actor, 'p1', 'approve', undefined, { before: async () => { throw refusal; }, after })).rejects.toBe(refusal);
    expect(db.post.updateMany).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(store).toMatchObject({ post: { status: 'pending_approval' }, approval: 'pending', audits: [], log: [] });
  });

  it('rolls back status, approval fields, domain writes and audit when after fails', async () => {
    const failure = new Error('domain outcome could not be recorded');
    const participant: ReviewParticipant = {
      before: async () => { store.domain.push('locked'); },
      after: async () => { store.domain.push('outcome'); throw failure; },
    };
    await expect(reviewPost(actor, 'p1', 'approve', undefined, participant)).rejects.toBe(failure);
    expect(store.log).toEqual(['mutate', 'approval']);
    expect(store.post.status).toBe('pending_approval');
    expect(store.approval).toBe('pending');
    expect(store.domain).toEqual([]);
    expect(store.audits).toEqual([]);
  });

  it('does not call a participant when the post is not awaiting approval', async () => {
    store.post.status = 'draft';
    const before = vi.fn(); const after = vi.fn();
    await expect(reviewPost(actor, 'p1', 'approve', undefined, { before, after })).rejects.toMatchObject({ code: 'conflict' });
    expect(before).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('keeps Publishing authority ahead of any participant callback', async () => {
    const before = vi.fn(); const after = vi.fn();
    db.membership.findUnique.mockResolvedValue({ role: 'viewer' });
    await expect(reviewPost(actor, 'p1', 'approve', undefined, { before, after })).rejects.toMatchObject({ code: 'forbidden' });
    db.membership.findUnique.mockResolvedValue(null);
    await expect(reviewPost(actor, 'p1', 'approve', undefined, { before, after })).rejects.toMatchObject({ code: 'forbidden' });
    db.membership.findUnique.mockResolvedValue({ role: 'client' });
    db.post.findFirst.mockResolvedValueOnce({ authorId: 'u1' });
    await expect(reviewPost(actor, 'p1', 'approve', undefined, { before, after })).rejects.toThrow(/own post/);
    expect(before).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('enforces channel scope before participants run', async () => {
    const before = vi.fn();
    db.postTarget.findMany.mockResolvedValue([{ targetId: 't-out' }]);
    await expect(reviewPost({ ...actor, allowedTargetIds: ['t-in'] }, 'p1', 'approve', undefined, { before })).rejects.toMatchObject({ code: 'forbidden' });
    expect(before).not.toHaveBeenCalled();
  });

  it('validates decision and notes exactly as before, without invoking participants', async () => {
    const before = vi.fn();
    await expect(reviewPost(actor, 'p1', 'approve', 'x'.repeat(501), { before })).rejects.toThrow(/500 characters/);
    await expect(reviewPost(actor, 'p1', 'maybe' as never, undefined, { before })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(reviewPost(actor, 'p1', 'approve', 42 as never, { before })).rejects.toMatchObject({ code: 'invalid_request' });
    await reviewPost(actor, 'p1', 'approve', 'x'.repeat(500));
    expect(before).not.toHaveBeenCalled();
    expect(store.post.status).toBe('draft');
  });

  it('rejects a malformed participant before touching any data', async () => {
    await expect(reviewPost(actor, 'p1', 'approve', undefined, { before: 'nope' } as never)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(reviewPost(actor, 'p1', 'approve', undefined, null as never)).rejects.toMatchObject({ code: 'unavailable' });
    expect(db.membership.findUnique).not.toHaveBeenCalled();
    expect(store.post.status).toBe('pending_approval');
  });

  it('aborts and rolls back when the operation lease expires during a callback', async () => {
    const controller = new AbortController();
    guard.signal = controller.signal;
    try {
      await expect(reviewPost(actor, 'p1', 'approve', undefined, { after: async () => { controller.abort(); } })).rejects.toThrow();
      expect(store.post.status).toBe('pending_approval');
      expect(store.audits).toEqual([]);
    } finally { guard.signal = new AbortController().signal; }
  });
});
