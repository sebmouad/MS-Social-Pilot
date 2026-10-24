import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ viewer: vi.fn(), allowed: vi.fn(), cancel: vi.fn(), refresh: vi.fn(), redirect: vi.fn() }));
vi.mock('@/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: state.allowed }));
vi.mock('@/modules/publishing/server/lifecycle', () => ({ cancelScheduledPost: state.cancel }));
vi.mock('next/cache', () => ({ revalidatePath: state.refresh }));
vi.mock('next/navigation', () => ({ redirect: state.redirect }));
import { cancelScheduledPostAction } from '@/modules/publishing/ui/posts/actions';

beforeEach(() => {
  vi.resetAllMocks();
  state.viewer.mockResolvedValue({ user: { id: 'u' }, workspaceId: 'w', permissions: { pageScope: { all: false, ids: ['channel'] } } });
  state.allowed.mockReturnValue(true);
  state.redirect.mockImplementation((url: string) => { throw Object.assign(new Error('redirect'), { digest: `NEXT_REDIRECT;${url}` }); });
});
function form() { const data = new FormData(); data.set('postId', 'post'); return data; }

it('rejects failed cancellation for the queue form without redirecting or refreshing away input', async () => {
  const failure = new Error('Cancellation refused');
  state.cancel.mockRejectedValue(failure);
  await expect(cancelScheduledPostAction(form())).rejects.toBe(failure);
  expect(state.cancel).toHaveBeenCalledWith({ userId: 'u', workspaceId: 'w', allowedTargetIds: ['channel'] }, 'post');
  expect(state.refresh).not.toHaveBeenCalled();
  expect(state.redirect).not.toHaveBeenCalled();
});

it('retains write authorization and refuses cancellation for a denied viewer', async () => {
  state.allowed.mockReturnValue(false);
  await expect(cancelScheduledPostAction(form())).rejects.toThrow('cannot manage posts');
  expect(state.viewer).toHaveBeenCalledWith({ feature: 'publishing/posts', channelScoped: true, write: true });
  expect(state.cancel).not.toHaveBeenCalled();
  expect(state.redirect).not.toHaveBeenCalled();
});

it('retains authentication redirects', async () => {
  const failure = Object.assign(new Error('sign in'), { digest: 'NEXT_REDIRECT;/sign-in' });
  state.viewer.mockRejectedValue(failure);
  await expect(cancelScheduledPostAction(form())).rejects.toBe(failure);
  expect(state.cancel).not.toHaveBeenCalled();
});

it('retains the successful cancellation destination and invalidates the existing views', async () => {
  state.cancel.mockResolvedValue(undefined);
  await expect(cancelScheduledPostAction(form())).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;/content?notice=cancelled' });
  expect(state.refresh.mock.calls).toEqual([['/content'], ['/content/queue'], ['/content/approvals']]);
});
