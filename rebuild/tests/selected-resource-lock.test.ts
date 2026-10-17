import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  runtimeConfig: vi.fn(),
  config: {
    'sync.resourceOperationTimeoutMs': 60_000,
    'sync.resourceOperationMaxWaitMs': 2_000,
    'sync.resourceFinalizationGraceMs': 5_000,
    'data.workspaceOperationTimeoutMs': 300_000,
  } as Record<string, unknown>,
}));

vi.mock('../src/server/data', () => ({ prisma: { $transaction: state.transaction } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.runtimeConfig }));

import { OperationError } from '../src/lib/operation-error';
import { lockSelectedResources, withSelectedResourceOperation } from '../src/server/platforms/resource-lock';

const workspaceId = 'workspace-a';
const resource = { kind: 'target' as const, id: 'page-1' };

function createTx() {
  return {
    $queryRaw: state.query,
    target: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

function lockKeys() {
  return state.query.mock.calls.map((call: unknown[]) => call[1] as string);
}

function defaults() {
  state.config = {
    'sync.resourceOperationTimeoutMs': 60_000,
    'sync.resourceOperationMaxWaitMs': 2_000,
    'sync.resourceFinalizationGraceMs': 5_000,
    'data.workspaceOperationTimeoutMs': 300_000,
  };
}

beforeEach(() => {
  vi.useRealTimers();
  defaults();
  state.query.mockReset().mockResolvedValue([{ acquired: true }]);
  state.runtimeConfig.mockReset().mockImplementation(async (key: string) => state.config[key]);
  state.transaction.mockReset().mockImplementation(async (run: (tx: ReturnType<typeof createTx>) => Promise<unknown>, options: unknown) => {
    void options;
    return run(createTx());
  });
});

afterEach(() => vi.useRealTimers());

describe('selected resource advisory locks', () => {
  it('locks deduplicated resource descriptors in stable key order', async () => {
    const tx = createTx();
    await lockSelectedResources(tx as never, workspaceId, [
      { kind: 'target', id: 'z-page' },
      { kind: 'adAccount', id: 'ad-2' },
      { kind: 'target', id: 'a-page' },
      { kind: 'target', id: 'z-page' },
      { kind: 'adAccount', id: 'ad-2' },
    ]);
    const keys = lockKeys();
    expect(keys).toEqual([
      JSON.stringify(['selected-resource', workspaceId, 'adAccount', 'ad-2']),
      JSON.stringify(['selected-resource', workspaceId, 'target', 'a-page']),
      JSON.stringify(['selected-resource', workspaceId, 'target', 'z-page']),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('scopes otherwise identical resource locks to their workspace', async () => {
    const tx = createTx();
    await lockSelectedResources(tx as never, 'workspace-a', [resource]);
    await lockSelectedResources(tx as never, 'workspace-b', [resource]);
    expect(lockKeys()).toEqual([
      JSON.stringify(['selected-resource', 'workspace-a', 'target', 'page-1']),
      JSON.stringify(['selected-resource', 'workspace-b', 'target', 'page-1']),
    ]);
  });

  it('rejects invalid descriptors before requesting a lock', async () => {
    await expect(lockSelectedResources(createTx() as never, workspaceId, [
      { kind: 'target', id: '' },
    ])).rejects.toMatchObject({ name: 'OperationError', code: 'invalid_request' });
    expect(state.query).not.toHaveBeenCalled();
  });

  it('does not invoke the callback when advisory lock acquisition fails', async () => {
    state.query.mockResolvedValue([{ acquired: false }]);
    const run = vi.fn();
    await expect(withSelectedResourceOperation(workspaceId, resource, run)).rejects.toMatchObject({
      name: 'OperationError', code: 'conflict',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('passes the transaction to callback writes and configures the bounded transaction', async () => {
    const tx = createTx();
    state.transaction.mockImplementationOnce(async (run: (client: typeof tx) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual({ timeout: 65_000, maxWait: 2_000 });
      return run(tx);
    });
    const run = vi.fn(async (client: unknown, signal: AbortSignal) => {
      const transactionClient = client as typeof tx;
      expect(client).toBe(tx);
      expect(signal.aborted).toBe(false);
      return transactionClient.target.updateMany({ where: { id: resource.id, workspaceId }, data: { enabled: false } });
    });
    await expect(withSelectedResourceOperation(workspaceId, resource, run)).resolves.toEqual({ count: 1 });
    expect(tx.target.updateMany).toHaveBeenCalledWith({ where: { id: 'page-1', workspaceId }, data: { enabled: false } });
    expect(run.mock.calls[0]?.[1].aborted).toBe(true);
  });

  it.each([
    ['operation timeout', { 'sync.resourceOperationTimeoutMs': 0 }],
    ['max wait', { 'sync.resourceOperationMaxWaitMs': -1 }],
    ['finalization grace', { 'sync.resourceFinalizationGraceMs': 0 }],
    ['workspace timeout', { 'data.workspaceOperationTimeoutMs': 60_000 }],
  ])('refuses invalid %s policy before opening a transaction', async (_name, override) => {
    Object.assign(state.config, override);
    await expect(withSelectedResourceOperation(workspaceId, resource, async () => undefined)).rejects.toMatchObject({
      name: 'OperationError', code: 'unavailable',
    });
    expect(state.transaction).not.toHaveBeenCalled();
  });

  it('aborts the callback before a delayed operation can reach its late write', async () => {
    vi.useFakeTimers();
    state.config['sync.resourceOperationTimeoutMs'] = 10;
    state.config['sync.resourceOperationMaxWaitMs'] = 2;
    state.config['sync.resourceFinalizationGraceMs'] = 5;
    const tx = createTx();
    state.transaction.mockImplementationOnce(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
    const delayedRun = async (client: unknown, signal: AbortSignal) => {
      await new Promise<void>(resolve => setTimeout(resolve, 100));
      signal.throwIfAborted();
      await (client as typeof tx).target.updateMany({ where: { id: resource.id }, data: { enabled: false } });
    };
    const pending = withSelectedResourceOperation(workspaceId, resource, delayedRun);
    const rejection = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10);
    expect(tx.target.updateMany).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(90);
    await rejection;
    expect(tx.target.updateMany).not.toHaveBeenCalled();
  });
});
