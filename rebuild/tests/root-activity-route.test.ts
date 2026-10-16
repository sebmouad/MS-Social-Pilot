import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: state.actor }));
vi.mock('../src/server/root/activity', () => ({ listRootActivity: state.list }));
import { GET } from '../src/app/api/root/activity/route';
import { OperationError } from '../src/lib/operation-error';
beforeEach(() => { vi.clearAllMocks(); state.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true }); state.list.mockResolvedValue({ items: [], olderCursor: null, newerCursor: null }); });
describe('private Root audit HTTP reads', () => {
  it('denies anonymous and non-owner callers before reading audit history', async () => {
    state.actor.mockResolvedValueOnce(null);
    expect((await GET(new Request('http://localhost/api/root/activity'))).status).toBe(401);
    state.actor.mockResolvedValueOnce({ id: 'member', isInstanceOwner: false });
    expect((await GET(new Request('http://localhost/api/root/activity'))).status).toBe(404);
    expect(state.list).not.toHaveBeenCalled();
  });
  it('decodes strict URL filters and delegates identity and query to the shared service', async () => {
    const response = await GET(new Request('http://localhost/api/root/activity?q=root&limit=2&workspaceId=workspace-a'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.list).toHaveBeenCalledWith('root', { q: 'root', limit: 2, workspaceId: 'workspace-a' });
    expect((await GET(new Request('http://localhost/api/root/activity?q=a&q=b'))).status).toBe(400);
    expect((await GET(new Request('http://localhost/api/root/activity?__proto__=value'))).status).toBe(400);
  });
  it('preserves public failures and never exposes unexpected database/session details', async () => {
    state.list.mockRejectedValueOnce(new OperationError('invalid_request', 'Choose valid activity filters.'));
    expect((await GET(new Request('http://localhost/api/root/activity'))).status).toBe(400);
    state.list.mockRejectedValueOnce(new Error('postgres://private-password@host'));
    const response = await GET(new Request('http://localhost/api/root/activity'));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('private-password');
    state.actor.mockRejectedValueOnce(new Error('session database private-password'));
    expect(JSON.stringify(await (await GET(new Request('http://localhost/api/root/activity'))).json())).not.toContain('private-password');
  });
});
