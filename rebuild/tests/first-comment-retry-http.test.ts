import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), retry: vi.fn(), refresh: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: mocks.viewer }));
vi.mock('../src/modules/publishing/server/first-comment', () => ({ retryFirstComment: mocks.retry }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.refresh }));
import { POST } from '../src/app/api/publishing/first-comments/retry/route';
import { OperationError } from '../src/lib/operation-error';
const input = { postId: 'post', postTargetId: 'destination', confirmation: 'RETRY FIRST COMMENT destination' };
const request = (body = JSON.stringify(input), origin = 'https://local.test') => new Request('https://local.test/api/publishing/first-comments/retry', { method: 'POST', headers: { origin }, body });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.viewer.mockResolvedValue({ user: { id: 'user' }, workspaceId: 'workspace', permissions: { pageScope: { all: false, ids: ['channel'] } } });
  mocks.retry.mockResolvedValue({ ok: true, postId: 'post', postTargetId: 'destination', state: 'sent' });
});
it('rejects missing and cross-origin writes before authentication', async () => {
  for (const origin of ['', 'https://other.test']) expect((await POST(request(undefined, origin))).status).toBe(403);
  expect(mocks.viewer).not.toHaveBeenCalled(); expect(mocks.retry).not.toHaveBeenCalled();
});
it('requires current scoped Publishing write authorization and delegates to the same retry service', async () => {
  const response = await POST(request());
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(mocks.viewer).toHaveBeenCalledWith({ feature: 'publishing/posts', channelScoped: true, write: true });
  expect(mocks.retry).toHaveBeenCalledWith({ userId: 'user', workspaceId: 'workspace', allowedTargetIds: ['channel'] }, input);
  expect(await response.json()).toMatchObject({ state: 'sent' });
});
it('returns no receipt without authorization', async () => {
  mocks.viewer.mockRejectedValueOnce(new Error('denied'));
  expect((await POST(request())).status).toBe(401); expect(mocks.retry).not.toHaveBeenCalled();
});
it('does not turn cache failure after a committed retry into an apparent failure', async () => {
  mocks.refresh.mockImplementation(() => { throw new Error('cache'); });
  expect(await (await POST(request())).json()).toMatchObject({ state: 'sent' });
});
it('preserves conflicts, masks unexpected errors, and rejects malformed JSON', async () => {
  mocks.retry.mockRejectedValueOnce(new OperationError('conflict', 'Only rejected comments can be retried.'));
  expect((await POST(request())).status).toBe(409);
  mocks.retry.mockRejectedValueOnce(new Error('private database details'));
  const result = await POST(request()); expect(result.status).toBe(502);
  expect(JSON.stringify(await result.json())).not.toContain('private');
  expect((await POST(request('{'))).status).toBe(400);
});
