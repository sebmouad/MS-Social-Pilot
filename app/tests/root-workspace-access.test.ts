import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ actor: vi.fn(), lock: vi.fn(), purge: vi.fn(), execute: vi.fn(), transaction: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { $transaction: state.transaction } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'data.workspaceOperationTimeoutMs' ? 300000 : 30000 }));
import { setRootWorkspaceAccess } from '../src/server/root/workspace-access';
import { workspaceAccessConfirmation } from '../src/lib/root-workspace-access';

beforeEach(() => {
  vi.clearAllMocks();
  state.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true, disabledAt: null });
  state.lock.mockResolvedValue([{ id: 'workspace-a', name: 'Studio', suspendedAt: null }]);
  state.purge.mockResolvedValue(null);
  state.execute.mockResolvedValue(1);
  state.transaction.mockImplementation((run: (tx: unknown) => unknown) => run({ user: { findUnique: state.actor }, $queryRaw: state.lock, $executeRaw: state.execute, workspaceDataPurge: { findUnique: state.purge } }));
});

describe('private workspace access control', () => {
  it('checks current installation-owner authority before reading a workspace', async () => {
    state.actor.mockResolvedValue({ id: 'member', isInstanceOwner: false, disabledAt: null });
    await expect(setRootWorkspaceAccess('member', 'workspace-a', true, 'anything')).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.lock).not.toHaveBeenCalled();
    expect(state.execute).not.toHaveBeenCalled();
  });

  it('requires the exact resource/action confirmation and refuses erasure in progress', async () => {
    await expect(setRootWorkspaceAccess('root', 'workspace-a', true, 'yes')).rejects.toMatchObject({ code: 'invalid_request' });
    state.purge.mockResolvedValue({ status: 'requested' });
    await expect(setRootWorkspaceAccess('root', 'workspace-a', true, workspaceAccessConfirmation('workspace-a', true))).rejects.toMatchObject({ code: 'conflict' });
    expect(state.execute).not.toHaveBeenCalled();
  });

  it('changes access and audits it under an exclusive workspace lock', async () => {
    const result = await setRootWorkspaceAccess('root', 'workspace-a', true, workspaceAccessConfirmation('workspace-a', true));
    expect(result).toMatchObject({ changed: true, suspended: true });
    expect(result.suspendedAt).toBeInstanceOf(Date);
    expect(state.lock.mock.calls[0]![0].join('')).toContain('FOR UPDATE');
    expect(state.execute).toHaveBeenCalledTimes(2);
    expect(state.transaction.mock.calls[0]![1]).toEqual({ timeout: 300000, maxWait: 30000 });
  });

  it('restores access and treats a repeated state as a no-op', async () => {
    state.lock.mockResolvedValue([{ id: 'workspace-a', name: 'Studio', suspendedAt: new Date() }]);
    await expect(setRootWorkspaceAccess('root', 'workspace-a', false, workspaceAccessConfirmation('workspace-a', false))).resolves.toMatchObject({ suspended: false, suspendedAt: null });
    state.execute.mockClear();
    await expect(setRootWorkspaceAccess('root', 'workspace-a', true, workspaceAccessConfirmation('workspace-a', true))).resolves.toMatchObject({ changed: false });
    expect(state.execute).not.toHaveBeenCalled();
  });
});
