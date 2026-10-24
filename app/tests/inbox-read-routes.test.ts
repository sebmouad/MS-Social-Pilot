import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ viewer: vi.fn(), list: vi.fn(), thread: vi.fn() }));
vi.mock('../src/server/context', () => ({ requireViewer: state.viewer }));
vi.mock('../src/modules/inbox/server/read', () => ({ readInboxList: state.list, readInboxThread: state.thread }));
import { GET as list } from '../src/app/api/inbox/route';
import { GET as thread } from '../src/app/api/inbox/threads/[key]/route';
import { OperationError } from '../src/lib/operation-error';
beforeEach(() => { vi.clearAllMocks(); state.viewer.mockResolvedValue({ user: { id: 'user' }, workspaceId: 'workspace' }); state.list.mockResolvedValue({ items: [], total: 0 }); state.thread.mockResolvedValue({ thread: { id: 'conversation' } }); });
const threadRequest = (query = '') => thread(new Request(`http://localhost/api/inbox/threads/message:conversation${query}`), { params: Promise.resolve({ key: 'message:conversation' }) });
describe('shared Inbox HTTP reads', () => {
  it('authorizes channel-scoped member reads and forwards typed URL values', async () => {
    const response = await list(new Request('http://localhost/api/inbox?channel=channel&type=message&status=all&hidden=all&q=literal_%25&limit=2&cursor=position'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.viewer).toHaveBeenCalledWith({ feature: 'inbox/conversations', channelScoped: true });
    expect(state.list).toHaveBeenCalledWith({ userId: 'user', workspaceId: 'workspace' }, { channelId: 'channel', kind: 'message', state: 'all', hidden: 'all', q: 'literal_%', limit: 2, cursor: 'position' });
    await threadRequest('?limit=2&cursor=history'); expect(state.thread).toHaveBeenCalledWith({ userId: 'user', workspaceId: 'workspace' }, { key: 'message:conversation', limit: 2, cursor: 'history' });
  });
  it('denies unverified identity before any domain read and keeps no-store', async () => {
    state.viewer.mockRejectedValue(new Error('redirect'));
    for (const response of [await list(new Request('http://localhost/api/inbox')), await threadRequest()]) { expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('no-store'); }
    expect(state.list).not.toHaveBeenCalled(); expect(state.thread).not.toHaveBeenCalled();
  });
  it('does not silently coerce repeated values or string limits into a valid selection', async () => {
    await list(new Request('http://localhost/api/inbox?type=message&type=comment&limit=bad'));
    expect(state.list.mock.calls[0][1]).toEqual({ kind: ['message', 'comment'], limit: 'bad' });
    expect((await list(new Request('http://localhost/api/inbox?unexpected=true'))).status).toBe(400);
    expect((await threadRequest('?cursor=one&cursor=two')).status).toBe(400);
  });
  it('preserves deliberate access errors and withholds raw infrastructure/provider text', async () => {
    state.list.mockRejectedValueOnce(new OperationError('forbidden', 'Selected channel is unavailable.'));
    const denied = await list(new Request('http://localhost/api/inbox')); expect(denied.status).toBe(403);
    state.thread.mockRejectedValueOnce(new Error('access_token=private'));
    const failed = await threadRequest(); expect(failed.status).toBe(502); expect(JSON.stringify(await failed.json())).not.toContain('access_token');
  });
});
