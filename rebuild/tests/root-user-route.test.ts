import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ currentRootActor: vi.fn(), setRootUserDisabled: vi.fn(), revokeRootUserSessions: vi.fn(), resetRootUserTwoStep: vi.fn() }));
vi.mock('@/server/config/access', () => ({ currentRootActor: state.currentRootActor }));
vi.mock('@/server/root/user-controls', () => ({ setRootUserDisabled: state.setRootUserDisabled, revokeRootUserSessions: state.revokeRootUserSessions, resetRootUserTwoStep: state.resetRootUserTwoStep }));
import { PATCH, POST } from '../src/app/api/root/users/[id]/route';

const params = Promise.resolve({ id: 'target' });
const request = (origin: string) => new Request('https://app.example.test/api/root/users/target', { method: 'PATCH', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ disabled: true, confirmation: 'DISABLE member@example.com' }) });
const post = (origin: string, action: string) => new Request('https://app.example.test/api/root/users/target', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ action, confirmation: 'SIGN OUT member@example.com' }) });

describe('Root user mutation route', () => {
  beforeEach(() => { vi.clearAllMocks(); state.currentRootActor.mockResolvedValue({ id: 'root', isInstanceOwner: true }); state.setRootUserDisabled.mockResolvedValue({ changed: true, sessionsRevoked: 2 }); });

  it('rejects cross-origin requests before reading actor or changing account', async () => {
    expect((await PATCH(request('https://evil.example'), { params })).status).toBe(403);
    expect(state.currentRootActor).not.toHaveBeenCalled();
    expect(state.setRootUserDisabled).not.toHaveBeenCalled();
  });

  it('hides mutation from non-root actors', async () => {
    state.currentRootActor.mockResolvedValue({ id: 'viewer', isInstanceOwner: false });
    expect((await PATCH(request('https://app.example.test'), { params })).status).toBe(404);
    expect(state.setRootUserDisabled).not.toHaveBeenCalled();
  });

  it('passes validated request to audited account service', async () => {
    const response = await PATCH(request('https://app.example.test'), { params });
    expect(response.status).toBe(200);
    expect(state.setRootUserDisabled).toHaveBeenCalledWith('root', 'target', true, 'DISABLE member@example.com');
  });

  it('requires Root access for recovery actions and dispatches only valid actions', async () => {
    state.revokeRootUserSessions.mockResolvedValue({ sessionsRevoked: 2 });
    expect((await POST(post('https://evil.example', 'sign-out'), { params })).status).toBe(403);
    expect((await POST(post('https://app.example.test', 'unknown'), { params })).status).toBe(400);
    const response = await POST(post('https://app.example.test', 'sign-out'), { params });
    expect(response.status).toBe(200);
    expect(state.revokeRootUserSessions).toHaveBeenCalledWith('root', 'target', 'SIGN OUT member@example.com');
  });
});
