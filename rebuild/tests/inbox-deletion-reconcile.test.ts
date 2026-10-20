import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() },
  config: vi.fn(), workspaceOp: vi.fn(), channelOp: vi.fn(), jobAccess: vi.fn(), platformInbox: vi.fn(), finish: vi.fn(), presence: vi.fn(),
}));

vi.mock('@/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: mocks.workspaceOp }));
vi.mock('@/server/jobs/access', () => ({ assertWorkspaceJobAccess: mocks.jobAccess }));
vi.mock('@/server/platforms/registry', () => ({ platformInbox: mocks.platformInbox }));
vi.mock('../src/modules/inbox/server/comment-guard', () => ({ withInboxChannelOperation: mocks.channelOp }));
vi.mock('../src/modules/inbox/server/deletion', () => ({ finish: mocks.finish }));

import { reconcileInboxDeletions } from '../src/modules/inbox/server/deletion-reconcile';
import { OperationError } from '../src/lib/operation-error';

const journal = (state: string) => ({ id: 'op-1', workspaceId: 'w1', targetId: 't1', provider: 'facebook', remoteId: 'rc1', localItemId: 'c1', state, actorId: 'u1' });
const now = new Date('2026-10-20T12:00:00Z');
let rows: unknown[]; let fresh: unknown[]; let post: unknown[];

beforeEach(() => {
  vi.clearAllMocks();
  rows = [journal('uncertain')]; fresh = [journal('uncertain')]; post = [{ remotePostId: 'post-1' }];
  mocks.config.mockImplementation(async (key: string) => ({ 'inbox.deletionReconcileBatch': 20, 'inbox.deletionReconcileMinAgeMs': 300000, 'inbox.deletionReconcileMaxAgeMs': 604800000, 'inbox.workflowTransactionTimeoutMs': 5000, 'inbox.workflowTransactionMaxWaitMs': 2000 })[key]);
  // Call order: candidates, fresh journal, comment's post.
  const queue = () => [rows, fresh, post];
  let call = 0;
  mocks.prisma.$queryRaw.mockImplementation(async () => queue()[call++ % 3]);
  mocks.prisma.$executeRaw.mockResolvedValue(1);
  mocks.prisma.$transaction.mockImplementation(async (work: (tx: typeof mocks.prisma) => Promise<unknown>) => work(mocks.prisma));
  mocks.workspaceOp.mockImplementation(async (_w: string, op: () => Promise<unknown>) => op());
  mocks.channelOp.mockImplementation(async (_w: string, _t: string, op: (s: AbortSignal) => Promise<unknown>) => op(new AbortController().signal));
  mocks.jobAccess.mockResolvedValue(undefined);
  mocks.presence.mockResolvedValue('absent');
  mocks.platformInbox.mockResolvedValue({ readCommentPresence: mocks.presence });
  mocks.finish.mockResolvedValue({ ok: true });
});

const sqlText = (call: unknown[]) => (call[0] as string[]).join('?');

describe('automatic inbox deletion reconciliation', () => {
  it('finalizes locally and audits only after the module reports positive absence', async () => {
    const result = await reconcileInboxDeletions(now);
    expect(mocks.presence).toHaveBeenCalledWith({ workspaceId: 'w1', targetId: 't1', remoteId: 'rc1', postRemoteId: 'post-1' }, expect.any(AbortSignal));
    expect(mocks.jobAccess).toHaveBeenCalledWith('w1', { provider: 'facebook', anyFeatureOf: ['inbox/conversations'] });
    const writes = mocks.prisma.$executeRaw.mock.calls.map(sqlText).join('\n');
    expect(writes).toContain("state = 'remote_confirmed'");
    expect(writes).toContain('inbox.comment_deletion_reconciled');
    expect(mocks.finish).toHaveBeenCalledWith(expect.objectContaining({ id: 'op-1', state: 'remote_confirmed' }), { userId: 'u1', workspaceId: 'w1' }, { source: 'reconciliation' });
    expect(result).toEqual({ examined: 1, updated: 1, skipped: 0, failed: 0 });
  });

  it.each(['present', 'unknown'] as const)('keeps the deletion held and never finalizes when the read says %s', async answer => {
    mocks.presence.mockResolvedValue(answer);
    const result = await reconcileInboxDeletions(now);
    expect(mocks.finish).not.toHaveBeenCalled();
    const writes = mocks.prisma.$executeRaw.mock.calls.map(sqlText).join('\n');
    expect(writes).not.toContain('remote_confirmed');
    expect(writes).not.toContain('root_activities');
    expect(result).toEqual({ examined: 1, updated: 0, skipped: 1, failed: 0 });
  });

  it('treats a missing stored post as unknown without calling the provider', async () => {
    post = [];
    await reconcileInboxDeletions(now);
    expect(mocks.presence).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it('skips modules without a read capability and rows settled by someone else', async () => {
    mocks.platformInbox.mockResolvedValue({});
    expect(await reconcileInboxDeletions(now)).toMatchObject({ skipped: 1, updated: 0 });
    mocks.platformInbox.mockResolvedValue({ readCommentPresence: mocks.presence });
    fresh = [journal('completed')];
    expect(await reconcileInboxDeletions(now)).toMatchObject({ skipped: 1, updated: 0 });
    expect(mocks.presence).not.toHaveBeenCalled();
  });

  it('finishes an already remote-confirmed row locally without any provider read', async () => {
    rows = [journal('remote_confirmed')]; fresh = [journal('remote_confirmed')];
    const result = await reconcileInboxDeletions(now);
    expect(mocks.presence).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(1);
  });

  it('skips when job access is gone, counts other errors as failed, and respects the Root bounds', async () => {
    mocks.jobAccess.mockRejectedValueOnce(new OperationError('forbidden', 'no'));
    expect(await reconcileInboxDeletions(now)).toMatchObject({ skipped: 1, failed: 0 });
    mocks.jobAccess.mockRejectedValueOnce(new Error('boom'));
    expect(await reconcileInboxDeletions(now)).toMatchObject({ failed: 1 });
    const select = sqlText(mocks.prisma.$queryRaw.mock.calls[0]);
    expect(select).toContain('LIMIT');
    expect(mocks.prisma.$queryRaw.mock.calls[0].slice(1)).toEqual(expect.arrayContaining([new Date(now.getTime() - 604800000), new Date(now.getTime() - 300000), 20]));
    mocks.prisma.$queryRaw.mockClear();
    mocks.config.mockImplementation(async (key: string) => key === 'inbox.deletionReconcileBatch' ? 0 : 1);
    expect(await reconcileInboxDeletions(now)).toEqual({ examined: 0, updated: 0, skipped: 0, failed: 0 });
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
