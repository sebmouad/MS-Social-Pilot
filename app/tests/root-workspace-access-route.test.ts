import { beforeEach, describe, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({ actor: vi.fn(), change: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: deps.actor }));
vi.mock('../src/server/root/workspace-access', () => ({ setRootWorkspaceAccess: deps.change }));
import { PATCH } from '../src/app/api/root/workspaces/[id]/access/route';
import { OperationError } from '../src/lib/operation-error';
const request = (body: unknown = { suspended: true, confirmation: 'SUSPEND WORKSPACE ws' }, origin = 'https://app.example.test') => new Request('https://app.example.test/api/root/workspaces/ws/access', { method: 'PATCH', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: 'ws' }) };
beforeEach(() => { vi.clearAllMocks(); deps.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true }); deps.change.mockResolvedValue({ changed: true, suspended: true, suspendedAt: new Date() }); });
describe('private workspace access API', () => {
  it('checks origin and private owner access before applying changes', async () => {
    expect((await PATCH(request(undefined, 'https://evil.example'), params)).status).toBe(403);
    expect(deps.actor).not.toHaveBeenCalled();
    deps.actor.mockResolvedValue({ id: 'member', isInstanceOwner: false });
    expect((await PATCH(request(), params)).status).toBe(404);
    expect(deps.change).not.toHaveBeenCalled();
  });
  it('rejects numeric/string access states and preserves safe domain failures', async () => {
    expect((await PATCH(request({ suspended: 'true', confirmation: 'yes' }), params)).status).toBe(400);
    deps.change.mockRejectedValue(new OperationError('conflict', 'Workspace data deletion is in progress.'));
    const response = await PATCH(request(), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'conflict' });
  });
  it('masks internal failures and passes the verified actor and state to the shared service', async () => {
    expect((await PATCH(request(), params)).status).toBe(200);
    expect(deps.change).toHaveBeenCalledWith('root', 'ws', true, 'SUSPEND WORKSPACE ws');
    deps.change.mockRejectedValue(new Error('Database password failure at /srv/private/settings'));
    const response = await PATCH(request(), params);
    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(JSON.stringify(await response.json())).not.toMatch(/password|private|settings/);
  });
});
