import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ findUnique: vi.fn(), transaction: vi.fn(), config: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { workspaceDataPurge: { findUnique: state.findUnique }, $transaction: state.transaction } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
import { assertWorkspaceNotPurging, withWorkspaceOperation } from '../src/server/data-control/guard';

beforeEach(() => {
  state.findUnique.mockReset(); state.transaction.mockReset(); state.config.mockReset();
  state.config.mockImplementation(async (key: string) => key === 'data.workspaceOperationTimeoutMs' ? 300000 : 30000);
});

describe('workspace purge write guard', () => {
  it('refuses new operations in a suspended workspace before running side effects', async () => {
    const operation = vi.fn();
    state.transaction.mockImplementation(async (run: (client: unknown) => Promise<unknown>) => run({
      $queryRaw: async () => [{ id: 'workspace-1', suspendedAt: new Date() }],
      workspaceDataPurge: { findUnique: vi.fn() },
    }));
    await expect(withWorkspaceOperation('workspace-1', operation)).rejects.toMatchObject({ code: 'forbidden', message: 'This workspace is suspended.' });
    expect(operation).not.toHaveBeenCalled();
  });

  it.each(['requested', 'db_deleted'])('denies workspace actions during %s', async status => {
    state.findUnique.mockResolvedValue({ status });
    await expect(assertWorkspaceNotPurging('workspace-1')).rejects.toThrow('Workspace data deletion is in progress.');
    expect(state.findUnique).toHaveBeenCalledWith({ where: { workspaceId: 'workspace-1' }, select: { status: true } });
  });

  it.each([null, { status: 'completed' }])('permits actions outside an active purge', async job => {
    state.findUnique.mockResolvedValue(job);
    await expect(assertWorkspaceNotPurging('workspace-1')).resolves.toBeUndefined();
  });

  it('holds the transaction through the provider operation and uses Root limits', async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const tx = {
      $queryRaw: vi.fn(async () => { events.push('lock'); return [{ id: 'workspace-1' }]; }),
      workspaceDataPurge: { findUnique: vi.fn(async () => { events.push('check'); return null; }) },
    };
    state.transaction.mockImplementation(async (run: (client: typeof tx) => Promise<unknown>) => {
      const value = await run(tx);
      events.push('commit');
      return value;
    });
    const pending = withWorkspaceOperation('workspace-1', async () => {
      events.push('provider');
      await gate;
      events.push('provider-done');
      return 'ok';
    });
    await vi.waitFor(() => expect(events).toEqual(['lock', 'check', 'provider']));
    expect(events).not.toContain('commit');
    release();
    await expect(pending).resolves.toBe('ok');
    expect(events).toEqual(['lock', 'check', 'provider', 'provider-done', 'commit']);
    expect(state.transaction.mock.calls[0]?.[1]).toEqual({ timeout: 300000, maxWait: 30000 });
  });

  it('denies the provider call when deletion was queued before the lock', async () => {
    const operation = vi.fn();
    state.transaction.mockImplementation(async (run: (client: unknown) => Promise<unknown>) => run({
      $queryRaw: async () => [{ id: 'workspace-1' }],
      workspaceDataPurge: { findUnique: async () => ({ status: 'requested' }) },
    }));
    await expect(withWorkspaceOperation('workspace-1', operation)).rejects.toThrow('Workspace data deletion is in progress.');
    expect(operation).not.toHaveBeenCalled();
  });
});
