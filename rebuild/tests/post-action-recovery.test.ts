import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ viewer: vi.fn(), update: vi.fn(), remove: vi.fn(), refresh: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/server/publishing/lifecycle', () => ({ updatePost: state.update, deletePost: state.remove }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('next/cache', () => ({ revalidatePath: state.refresh }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw Object.assign(new Error('redirect'), { digest: `NEXT_REDIRECT;${url}` }); } }));
import { updatePostWithRecoveryAction, deletePostWithRecoveryAction } from '../src/app/publishing/posts/actions';
import { OperationError } from '../src/lib/operation-error';
beforeEach(() => { vi.resetAllMocks(); state.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w', permissions: { pageScope: { all: false, ids: ['a'] } } }); });
function values() { const data = new FormData(); for (const [k, v] of Object.entries({ postId: 'p', message: 'Retain text', firstComment: 'Retain comment', targetIds: 'a', imageUrl: 'https://example.test/image.jpg' })) data.set(k, v); return data; }
it('retains edit values and shows only the safe domain error', async () => {
  state.update.mockRejectedValue(new OperationError('conflict', 'Another action is running for this post.'));
  const result = await updatePostWithRecoveryAction({ status: 'idle', values: {} }, values());
  expect(result).toMatchObject({ status: 'error', message: 'Another action is running for this post.', values: { message: 'Retain text', firstComment: 'Retain comment', targetIds: ['a'], imageUrl: 'https://example.test/image.jpg' } });
  expect(state.refresh).not.toHaveBeenCalled();
});
it('retains the remote-deletion choice without exposing unexpected errors', async () => {
  state.remove.mockRejectedValue(new Error('secret DSN'));
  const data = values(); data.set('deleteRemote', 'on'); data.set('intent', 'start'); data.set('confirmation', 'DELETE POST p REMOTE');
  const result = await deletePostWithRecoveryAction({ status: 'idle', deleteRemote: false }, data);
  expect(result.status).toBe('error'); expect(result.deleteRemote).toBe(true); expect(result.message).toContain('could not be confirmed'); expect(result.message).not.toContain('secret');
});
it('redirects only after a confirmed delete and refreshes publishing views', async () => {
  state.remove.mockResolvedValue({ ok: true, postId: 'p', localConfirmed: true, state: 'completed', operations: [] });
  const data = values(); data.set('intent', 'start'); data.set('confirmation', 'DELETE POST p LOCAL');
  await expect(deletePostWithRecoveryAction({ status: 'idle', deleteRemote: false }, data)).rejects.toMatchObject({ digest: expect.stringContaining('notice=deleted') });
  expect(state.remove).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w', allowedTargetIds: ['a'] }, 'p', false);
  expect(state.refresh).toHaveBeenCalledWith('/publishing/posts');
});

it('does not report deletion for a missing receipt or malformed request', async () => {
  state.remove.mockResolvedValue(undefined);
  const data = values(); data.set('intent', 'start'); data.set('confirmation', 'DELETE POST p LOCAL');
  expect(await deletePostWithRecoveryAction({ status: 'idle', deleteRemote: false }, data)).toMatchObject({ status: 'error' });
  expect(state.refresh).not.toHaveBeenCalled();
  data.delete('intent');
  expect(await deletePostWithRecoveryAction({ status: 'idle', deleteRemote: false }, data)).toMatchObject({ status: 'error' });
});
