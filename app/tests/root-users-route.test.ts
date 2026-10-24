import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: vi.fn(), load: vi.fn() }));
vi.mock('../src/server/config/access', () => ({ currentRootActor: state.actor }));
vi.mock('../src/server/root/users', () => ({ loadRootUsers: state.load }));
import { GET } from '../src/app/api/root/users/route';
import { OperationError } from '../src/lib/operation-error';
beforeEach(() => { vi.clearAllMocks(); state.actor.mockResolvedValue({ id: 'root', isInstanceOwner: true }); state.load.mockResolvedValue({ users: [], total: 0 }); });
describe('private user directory HTTP', () => {
  it.each([null, { id: 'member', isInstanceOwner: false }])('denies non-Root reads before the directory service', async actor => {
    state.actor.mockResolvedValue(actor);
    const response = await GET(new Request('https://example.test/api/root/users'));
    expect(response.status).toBe(actor ? 404 : 401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(state.load).not.toHaveBeenCalled();
  });
  it('passes all filter occurrences to the shared service and sanitizes failures', async () => {
    state.load.mockRejectedValueOnce(new OperationError('invalid_request', 'Choose one value for each user filter.'));
    const response = await GET(new Request('https://example.test/api/root/users?q=one&q=two&status=disabled&page=2'));
    expect(state.load).toHaveBeenCalledWith('root', { q: ['one','two'], status: 'disabled', page: '2' });
    expect(response.status).toBe(400);
    state.load.mockRejectedValueOnce(new Error('postgres://private-password@db'));
    const failure = await GET(new Request('https://example.test/api/root/users'));
    expect(failure.status).toBe(502);
    expect(JSON.stringify(await failure.json())).not.toContain('private-password');
  });
});
