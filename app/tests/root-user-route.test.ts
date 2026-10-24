import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationError } from '../src/lib/operation-error';

const state = vi.hoisted(() => ({ currentRootActor: vi.fn(), setRootUserDisabled: vi.fn(), revokeRootUserSessions: vi.fn(), resetRootUserTwoStep: vi.fn() }));
vi.mock('@/server/config/access', () => ({ currentRootActor: state.currentRootActor }));
vi.mock('@/server/root/user-controls', () => ({ setRootUserDisabled: state.setRootUserDisabled, revokeRootUserSessions: state.revokeRootUserSessions, resetRootUserTwoStep: state.resetRootUserTwoStep }));
import { PATCH, POST } from '../src/app/api/root/users/[id]/route';

const params = Promise.resolve({ id: 'target' });
const request = (method: string, origin: string, body: unknown, id = 'target') => new Request(`https://app.example.test/api/root/users/${id}`, { method, headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('Root user mutation route', () => {
  beforeEach(() => { vi.clearAllMocks(); state.currentRootActor.mockResolvedValue({ id: 'root', isInstanceOwner: true }); state.setRootUserDisabled.mockResolvedValue({ changed: true, sessionsRevoked: 2 }); });

  it('rejects cross-origin requests before reading actor or changing account and disables caching', async () => {
    const response = await PATCH(request('PATCH', 'https://evil.example', { disabled: true, confirmation: 'DISABLE member@example.com' }), { params });
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.currentRootActor).not.toHaveBeenCalled();
    expect(state.setRootUserDisabled).not.toHaveBeenCalled();
  });

  it('hides mutation from non-root actors', async () => {
    state.currentRootActor.mockResolvedValue({ id: 'viewer', isInstanceOwner: false });
    const response = await PATCH(request('PATCH', 'https://app.example.test', { disabled: true, confirmation: 'DISABLE member@example.com' }), { params });
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.setRootUserDisabled).not.toHaveBeenCalled();
  });

  it('passes validated request to audited account service', async () => {
    const response = await PATCH(request('PATCH', 'https://app.example.test', { disabled: true, confirmation: 'DISABLE member@example.com' }), { params });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.setRootUserDisabled).toHaveBeenCalledWith('root', 'target', true, 'DISABLE member@example.com');
  });

  it('validates target ID and confirmation bounds', async () => {
    expect((await PATCH(request('PATCH', 'https://app.example.test', { disabled: true, confirmation: 'x' }, '') , { params: Promise.resolve({ id: '' }) })).status).toBe(400);
    expect((await PATCH(request('PATCH', 'https://app.example.test', { disabled: true, confirmation: 'x'.repeat(401) }), { params })).status).toBe(400);
    expect(state.setRootUserDisabled).not.toHaveBeenCalled();
  });

  it('requires Root access for recovery actions and dispatches only valid actions', async () => {
    state.revokeRootUserSessions.mockResolvedValue({ sessionsRevoked: 2 });
    expect((await POST(request('POST', 'https://evil.example', { action: 'sign-out', confirmation: 'SIGN OUT member@example.com' }), { params })).status).toBe(403);
    expect((await POST(request('POST', 'https://app.example.test', { action: 'unknown', confirmation: 'x' }), { params })).status).toBe(400);
    const response = await POST(request('POST', 'https://app.example.test', { action: 'sign-out', confirmation: 'SIGN OUT member@example.com' }), { params });
    expect(response.status).toBe(200);
    expect(state.revokeRootUserSessions).toHaveBeenCalledWith('root', 'target', 'SIGN OUT member@example.com');
  });

  it('maps only typed operation errors and masks actor and database failures', async () => {
    state.setRootUserDisabled.mockRejectedValueOnce(new OperationError('conflict', 'Reload the user list before repeating this action.'));
    const conflict = await PATCH(request('PATCH', 'https://app.example.test', { disabled: true, confirmation: 'DISABLE member@example.com' }), { params });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: 'Reload the user list before repeating this action.', code: 'conflict' });
    state.setRootUserDisabled.mockRejectedValueOnce(new Error('password=do-not-expose'));
    const unknown = await PATCH(request('PATCH', 'https://app.example.test', { disabled: true, confirmation: 'DISABLE member@example.com' }), { params });
    expect(unknown.status).toBe(502);
    expect(await unknown.text()).not.toContain('password');
    state.currentRootActor.mockRejectedValueOnce(new Error('secret database detail'));
    const actorError = await PATCH(request('PATCH', 'https://app.example.test', { disabled: true, confirmation: 'DISABLE member@example.com' }), { params });
    expect(actorError.status).toBe(502);
    expect(await actorError.text()).not.toContain('secret');
  });
});
