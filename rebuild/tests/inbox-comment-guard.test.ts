import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ transaction: vi.fn(), query: vi.fn(), config: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { $transaction: state.transaction } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: state.config }));
import { withInboxChannelOperation, orderInboxCommentBatch } from '../src/modules/inbox/server/comment-guard';
const settings: Record<string, number> = { 'inbox.commentOperationTimeoutMs': 6000, 'inbox.commentOperationMaxWaitMs': 500, 'inbox.workflowTransactionTimeoutMs': 1000, 'data.workspaceOperationTimeoutMs': 15000 };
beforeEach(() => {
  vi.clearAllMocks();
  state.config.mockImplementation(async key => settings[key]);
  state.query.mockResolvedValue([{ acquired: true }]);
  state.transaction.mockImplementation(async callback => callback({ $queryRaw: state.query }));
});
afterEach(() => vi.useRealTimers());
it('refuses a comment budget that would outlive the workspace operation guard', async () => {
  state.config.mockImplementation(async key => key === 'data.workspaceOperationTimeoutMs' ? 7000 : settings[key]);
  let dispatched = false;
  await expect(withInboxChannelOperation('workspace', 'channel', async () => { dispatched = true; })).rejects.toMatchObject({ code: 'unavailable' });
  expect(dispatched).toBe(false);
});
it('fails before dispatch when another comment operation holds the channel lock', async () => {
  state.query.mockResolvedValue([{ acquired: false }]);
  let dispatched = false;
  await expect(withInboxChannelOperation('workspace', 'channel', async () => { dispatched = true; })).rejects.toMatchObject({ code: 'conflict' });
  expect(dispatched).toBe(false);
});
it('passes cancellation to provider work before the database lock deadline', async () => {
  vi.useFakeTimers();
  let localWrite = false;
  const action = withInboxChannelOperation('workspace', 'channel', async signal => {
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    signal.throwIfAborted();
    localWrite = true;
  });
  const rejected = expect(action).rejects.toBeTruthy();
  await vi.advanceTimersByTimeAsync(6000);
  await rejected;
  expect(localWrite).toBe(false);
  expect(state.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 8500, maxWait: 500 });
});

it('orders stale reply batches parent first even when remote responses arrive reversed', () => {
  const items = [{ id: 'grandchild', parentId: 'child' }, { id: 'child', parentId: 'parent' }, { id: 'parent', parentId: null }];
  expect(orderInboxCommentBatch(items).map(item => item.id)).toEqual(['parent', 'child', 'grandchild']);
});
it('rejects a cyclic remote reply hierarchy before persisting partial content', () => {
  expect(() => orderInboxCommentBatch([{ id: 'first', parentId: 'second' }, { id: 'second', parentId: 'first' }])).toThrow();
});
