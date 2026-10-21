vi.mock('@/modules/inbox/server/customer-copy', async () => ({ loadInboxCustomerCopy: async () => (await import('../src/modules/inbox/customer-copy')).inboxCustomerCopy }));
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: vi.fn(), entitlements: vi.fn(), permissions: vi.fn(), feature: vi.fn(), platform: vi.fn(), providers: vi.fn(), permission: vi.fn(), purge: vi.fn(), channels: vi.fn(), workspace: vi.fn(), where: vi.fn(),
  conversationFind: vi.fn(), commentFind: vi.fn(), conversationUpdate: vi.fn(), commentUpdate: vi.fn(), audit: vi.fn(), transaction: vi.fn(), onLocked: vi.fn(), storedResolvedAt: null as Date | null,
}));
vi.mock('../src/server/data', () => ({ prisma: {
  user: { findUnique: mocks.user }, target: { findMany: mocks.channels }, workspace: { findUnique: mocks.workspace },
  conversation: { findFirst: mocks.conversationFind }, postComment: { findFirst: mocks.commentFind },
  $transaction: mocks.transaction,
} }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseFeature: mocks.feature, hasPlatformCapability: mocks.platform }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: mocks.permission }));
vi.mock('../src/server/data-control/guard', () => ({
  assertWorkspaceNotPurging: mocks.purge,
  withWorkspaceOperation: async (_workspace: string, operation: () => Promise<unknown>) => { await mocks.onLocked(); return operation(); },
}));
vi.mock('@/modules/inbox/server/providers', () => ({ inboxTargetWhere: mocks.where, inboxProviders: mocks.providers }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: vi.fn(async key => key === 'inbox.workflowTransactionTimeoutMs' ? 5000 : key === 'inbox.workflowTransactionMaxWaitMs' ? 2000 : 500) }));

import { canManageInboxWorkflow, setInboxResolved } from '@/modules/inbox/server/actions';
const actor = { userId: 'actor', workspaceId: 'workspace' };
const targetId = 'channel';
const tx = {
  conversation: { updateMany: mocks.conversationUpdate, findFirst: mocks.conversationFind },
  postComment: { updateMany: mocks.commentUpdate, findFirst: mocks.commentFind }, $executeRaw: mocks.audit,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.onLocked.mockReset();
  mocks.user.mockResolvedValue({ disabledAt: null }); mocks.entitlements.mockResolvedValue({});
  mocks.permissions.mockResolvedValue({ pageScope: { all: false, ids: [targetId] } });
  mocks.feature.mockReturnValue(true); mocks.platform.mockReturnValue(true); mocks.providers.mockResolvedValue(['facebook']); mocks.permission.mockReturnValue(true); mocks.purge.mockResolvedValue(undefined);
  mocks.channels.mockResolvedValue([{ id: targetId, name: 'Channel' }]); mocks.workspace.mockResolvedValue({ timezone: 'UTC' });
  mocks.where.mockImplementation((_workspace: string, ids?: string[]) => ({ scopedIds: ids }));
  mocks.conversationFind.mockResolvedValue({ id: 'item', targetId });
  mocks.commentFind.mockResolvedValue({ id: 'item', postTarget: { targetId } });
  mocks.storedResolvedAt = null;
  mocks.conversationUpdate.mockImplementation(async ({ data }: { data: { resolvedAt: Date | null } }) => { mocks.storedResolvedAt = data.resolvedAt; return { count: 1 }; });
  mocks.commentUpdate.mockImplementation(async ({ data }: { data: { resolvedAt: Date | null } }) => { mocks.storedResolvedAt = data.resolvedAt; return { count: 1 }; });
  mocks.audit.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => {
    const before = mocks.storedResolvedAt;
    try { return await callback(tx); } catch (error) { mocks.storedResolvedAt = before; throw error; }
  });
});

describe('platform-neutral Inbox resolve workflow', () => {
  it.each(['channel', 'permission'] as const)('refreshes revoked %s grants after waiting for the workspace lock', async changed => {
    mocks.onLocked.mockImplementation(() => {
      if (changed === 'channel') mocks.channels.mockResolvedValue([]);
      else mocks.permission.mockReturnValue(false);
    });
    await expect(setInboxResolved(actor, { kind: 'message', id: 'item', resolved: true })).rejects.toBeTruthy();
    expect(mocks.onLocked).toHaveBeenCalledOnce(); expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.permissions).toHaveBeenCalledTimes(2);
  });
  it.each(['message', 'comment'] as const)('resolves and reopens stored %s items atomically', async kind => {
    await expect(setInboxResolved(actor, { action: 'resolve', kind, id: 'item', resolved: true })).resolves.toMatchObject({ ok: true, kind, id: 'item', resolved: true });
    await expect(setInboxResolved(actor, { action: 'resolve', kind, id: 'item', resolved: false })).resolves.toMatchObject({ ok: true, kind, resolved: false });
    const update = kind === 'message' ? mocks.conversationUpdate : mocks.commentUpdate;
    expect(update).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 5000, maxWait: 2000 });
    const where = update.mock.calls[0][0].where;
    expect(where.id).toBe('item');
    expect(kind === 'message' ? where.target.workspaceId : where.postTarget.target.workspaceId).toBe('workspace');
    expect(kind === 'message' ? where.targetId : where.postTarget.targetId).toEqual({ in: [targetId] });
    expect(update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);
    expect(update.mock.calls[1][0].data.resolvedAt).toBeNull();
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(mocks.audit.mock.calls[0][4]).toContain('"workspaceId":"workspace"');
    expect(mocks.audit.mock.calls[0][4]).toContain('"targetId":"channel"');
    expect(mocks.audit.mock.calls[0][3]).toBe(`inbox.${kind === 'message' ? 'conversation' : 'comment'}_resolved`);
    expect(mocks.audit.mock.calls[1][3]).toBe(`inbox.${kind === 'message' ? 'conversation' : 'comment'}_reopened`);
  });

  it.each(['disabled_account', 'membership', 'feature', 'read_only', 'unassigned'])(
    'blocks %s before opening a write transaction', async denial => {
      if (denial === 'disabled_account') mocks.user.mockResolvedValue({ disabledAt: new Date() });
      if (denial === 'membership') mocks.permissions.mockResolvedValue(null);
      if (denial === 'feature') mocks.feature.mockReturnValue(false);
      if (denial === 'read_only') mocks.permission.mockImplementation((_p, _f, mode) => mode !== 'write');
      if (denial === 'unassigned') mocks.channels.mockResolvedValue([]);
      await expect(setInboxResolved(actor, { kind: 'message', id: 'item', resolved: true })).rejects.toBeTruthy();
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.conversationUpdate).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
    },
  );

  it('rolls back the item change when the audit insert fails', async () => {
    mocks.audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(setInboxResolved(actor, { kind: 'message', id: 'item', resolved: true })).rejects.toThrow('audit unavailable');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.conversationUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.storedResolvedAt).toBeNull();
  });

  it('does not require provider credentials for expired-source local resolution', async () => {
    await expect(setInboxResolved(actor, { kind: 'comment', id: 'item', resolved: true })).resolves.toMatchObject({ resolved: true });
    expect(mocks.where).toHaveBeenCalledWith('workspace', ['channel'], ['facebook']);
    expect(mocks.audit).toHaveBeenCalled();
  });

  it('intersects an owner grant with a caller-supplied channel constraint', async () => {
    mocks.permissions.mockResolvedValue({ pageScope: { all: true, ids: [] } });
    mocks.channels.mockResolvedValue([]);
    await expect(setInboxResolved(actor, { kind: 'message', id: 'item', resolved: true }, { allowedChannelIds: ['foreign'] }))
      .rejects.toMatchObject({ code: 'not_found' });
    expect(mocks.where).toHaveBeenCalledWith('workspace', ['foreign'], ['facebook']);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('validates kind/id/state and returns false for inaccessible channel management checks', async () => {
    await expect(setInboxResolved(actor, { kind: 'other', id: 'item', resolved: true } as unknown as { kind: 'message'; id: string; resolved: boolean })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(setInboxResolved(actor, { kind: 'message', id: 'bad id', resolved: true })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(await canManageInboxWorkflow(actor, 'foreign')).toBe(false);
  });
});
