import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  transaction: vi.fn(), query: vi.fn(), post: vi.fn(), postTarget: vi.fn(), target: vi.fn(), workspace: vi.fn(), user: vi.fn(), membership: vi.fn(),
  entitlements: vi.fn(), permissions: vi.fn(), feature: vi.fn(), permission: vi.fn(), purge: vi.fn(), workspaceOperation: vi.fn(), config: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: {
  $transaction: state.transaction,
  user: { findUnique: state.user }, membership: { findFirst: state.membership }, post: { findFirst: state.post }, target: { findMany: state.target },
  postTarget: { findFirst: state.postTarget },
} }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: state.entitlements, canUseFeature: state.feature }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: state.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: state.permission }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: state.purge, withWorkspaceOperation: state.workspaceOperation }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));

import { assertPublishingTargetsSettled, lockPublishingTargets, withPublishingOperation } from '../src/modules/publishing/server/guard';

const actor = { userId: 'writer', workspaceId: 'workspace', allowedTargetIds: ['channel-a', 'channel-b'] };
const grantPermissions = { pageScope: { all: false, ids: ['channel-a', 'channel-b'] } };
const operationTx = { $queryRaw: state.query, postTarget: { findFirst: state.postTarget } };

beforeEach(() => {
  vi.clearAllMocks();
  state.transaction.mockImplementation(async (work: (tx: typeof operationTx) => Promise<unknown>) => work(operationTx));
  state.query.mockResolvedValue([{ acquired: true }]);
  state.post.mockResolvedValue({ targets: [{ targetId: 'channel-a' }] });
  state.postTarget.mockResolvedValue(null);
  state.target.mockImplementation(async (query: { where: { id?: { in?: string[] } } }) => (query.where.id?.in ?? []).map(id => ({ id })));
  state.user.mockResolvedValue({ disabledAt: null });
  state.membership.mockResolvedValue({ role: 'editor' });
  state.entitlements.mockResolvedValue({});
  state.permissions.mockResolvedValue(grantPermissions);
  state.feature.mockReturnValue(true); state.permission.mockReturnValue(true); state.purge.mockResolvedValue(undefined);
  state.workspaceOperation.mockImplementation(async (_workspace: string, work: () => Promise<unknown>) => work());
  state.config.mockImplementation(async (key: string) => ({
    'publishing.operationTimeoutMs': 60000, 'publishing.operationMaxWaitMs': 2000,
    'publishing.transactionTimeoutMs': 15000, 'publishing.transactionMaxWaitMs': 5000,
    'publishing.maxTargetsPerOperation': 100, 'publishing.identifierMaxCharacters': 200,
    'data.workspaceOperationTimeoutMs': 300000,
  }[key]));
});

describe('Publishing guarded operations', () => {
  it('holds one workspace operation and target locks across the callback, then refreshes authorization', async () => {
    const work = vi.fn(async (context: { actor: unknown; role: string; signal: AbortSignal; lockTargets: (ids: readonly string[]) => Promise<void> }) => {
      expect(context.actor).toMatchObject({ allowedTargetIds: ['channel-a', 'channel-b'] });
      expect(context.role).toBe('editor');
      expect(context.signal.aborted).toBe(false);
      await context.lockTargets(['channel-b']);
      return 'done';
    });
    await expect(withPublishingOperation(actor, { postId: 'post-1', targetIds: ['channel-b'] }, work)).resolves.toBe('done');
    expect(state.workspaceOperation).toHaveBeenCalledTimes(1);
    expect(state.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 102000, maxWait: 2000 });
    expect(state.post).toHaveBeenCalledWith({ where: { id: 'post-1', workspaceId: 'workspace' }, select: { targets: { select: { targetId: true } } } });
    expect(state.query).toHaveBeenCalledTimes(4);
    expect(state.permissions).toHaveBeenCalledTimes(2);
  });

  it('fails fast on an advisory lock conflict without running protected work', async () => {
    state.query.mockResolvedValueOnce([{ acquired: false }]);
    const work = vi.fn();
    await expect(withPublishingOperation(actor, { targetIds: ['channel-a'] }, work)).rejects.toMatchObject({ code: 'conflict' });
    expect(work).not.toHaveBeenCalled();
  });

  it('refreshes grants after locks and rejects a revoked destination before work', async () => {
    state.permissions.mockResolvedValueOnce(grantPermissions).mockResolvedValueOnce({ pageScope: { all: false, ids: ['channel-b'] } });
    const work = vi.fn();
    await expect(withPublishingOperation(actor, { targetIds: ['channel-a'] }, work)).rejects.toMatchObject({ code: 'forbidden' });
    expect(work).not.toHaveBeenCalled();
    expect(state.transaction).toHaveBeenCalledTimes(1);
  });

  it('fails closed when an existing post destination is outside current grants', async () => {
    state.post.mockResolvedValue({ targets: [{ targetId: 'channel-a' }] });
    state.permissions.mockResolvedValue({ pageScope: { all: false, ids: ['channel-b'] } });
    const work = vi.fn();
    await expect(withPublishingOperation(actor, { postId: 'post-1' }, work)).rejects.toMatchObject({ code: 'forbidden' });
    expect(work).not.toHaveBeenCalled();
    expect(state.query).toHaveBeenCalledTimes(1); // post lock only; no destination lock is acquired
  });

  it('rejects an invalid transaction budget before acquiring the workspace operation lock', async () => {
    state.config.mockImplementation(async (key: string) => key === 'publishing.transactionTimeoutMs' ? -1 : ({
      'publishing.operationTimeoutMs': 60000, 'publishing.operationMaxWaitMs': 2000,
      'publishing.transactionMaxWaitMs': 5000, 'publishing.maxTargetsPerOperation': 100,
      'publishing.identifierMaxCharacters': 200, 'data.workspaceOperationTimeoutMs': 300000,
    }[key]));
    await expect(withPublishingOperation(actor, {}, async () => 'no')).rejects.toMatchObject({ code: 'unavailable' });
    expect(state.workspaceOperation).not.toHaveBeenCalled();
    expect(state.query).not.toHaveBeenCalled();
  });

  it('aborts the remote work budget and rejects a late successful callback', async () => {
    vi.useFakeTimers();
    try {
      const work = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
        expect(signal.aborted).toBe(false);
        await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
        return 'late success';
      });
      const pending = withPublishingOperation(actor, {}, work);
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(60000);
      await rejected;
      expect(work.mock.calls[0]?.[0].signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not call protected work when preflight authorization completes after the deadline', async () => {
    vi.useFakeTimers();
    try {
      let releasePermissions!: (value: typeof grantPermissions) => void;
      state.permissions.mockImplementationOnce(() => new Promise(resolve => { releasePermissions = resolve; }));
      const work = vi.fn();
      const pending = withPublishingOperation(actor, {}, work);
      const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(60000);
      releasePermissions(grantPermissions);
      await rejected;
      expect(work).not.toHaveBeenCalled();
      expect(state.post).not.toHaveBeenCalled();
      expect(state.target).not.toHaveBeenCalled();
      expect(state.query).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('validates and sorts bounded destination IDs before locking', async () => {
    await lockPublishingTargets(operationTx as never, 'workspace', ['channel-b', 'channel-a', 'channel-a']);
    expect(state.query).toHaveBeenCalledTimes(2);
    await expect(lockPublishingTargets(operationTx as never, 'workspace', ['x'.repeat(201)])).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(lockPublishingTargets(operationTx as never, 'workspace', Array.from({ length: 101 }, (_, i) => `target-${i}`))).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('deduplicates the union before applying the operation target cap', async () => {
    state.config.mockImplementation(async (key: string) => key === 'publishing.maxTargetsPerOperation' ? 1 : 200);
    await expect(lockPublishingTargets(operationTx as never, 'workspace', ['same', 'same'])).resolves.toBeUndefined();
    expect(state.query).toHaveBeenCalledTimes(1);
  });

  it('blocks cleanup when workspace scoped publishing results remain processing', async () => {
    state.postTarget.mockResolvedValueOnce({ id: 'pending-target-row' });
    await expect(assertPublishingTargetsSettled(operationTx as never, 'workspace', ['channel-a', 'channel-a']))
      .rejects.toMatchObject({ code: 'conflict', message: expect.stringContaining('needs review') });
    expect(state.postTarget).toHaveBeenCalledWith({
      where: { status: 'processing', post: { workspaceId: 'workspace' }, targetId: { in: ['channel-a'] } },
      select: { id: true },
    });
  });

  it('checks all workspace processing rows when no target subset is supplied', async () => {
    await assertPublishingTargetsSettled(operationTx as never, 'workspace');
    expect(state.postTarget).toHaveBeenCalledWith({ where: { status: 'processing', post: { workspaceId: 'workspace' } }, select: { id: true } });
    state.postTarget.mockClear();
    await assertPublishingTargetsSettled(operationTx as never, 'workspace', []);
    expect(state.postTarget).not.toHaveBeenCalled();
  });
});
