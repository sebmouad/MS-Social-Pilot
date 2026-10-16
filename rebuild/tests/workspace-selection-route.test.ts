import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  cookieSet: vi.fn(),
  getSessionByTokenHash: vi.fn(),
  listWorkspaces: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: state.cookieGet, set: state.cookieSet }),
}));
vi.mock('@/server/data', () => ({
  getSessionByTokenHash: state.getSessionByTokenHash,
  listWorkspaces: state.listWorkspaces,
}));

import { POST } from '../src/app/api/workspaces/select/route';

const sessionToken = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const selectedWorkspaces = [
  { membershipId: 'membership-a', role: 'owner', workspace: { id: 'workspace-a', name: 'A', slug: 'a', timezone: 'UTC' } },
  { membershipId: 'membership-b', role: 'viewer', workspace: { id: 'workspace-b', name: 'B', slug: 'b', timezone: 'UTC' } },
];

function request(body: unknown, origin = 'https://app.example.test') {
  return new Request('https://app.example.test/api/workspaces/select', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('workspace selection route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.cookieGet.mockImplementation((name: string) => name === 'msp_session' ? { value: sessionToken } : undefined);
    state.cookieSet.mockImplementation(() => undefined);
    state.getSessionByTokenHash.mockResolvedValue({
      id: 'session', userId: 'user', tokenHash: 'hash', expiresAt: new Date(Date.now() + 60_000), pending: null,
      user: { id: 'user', disabledAt: null },
    });
    state.listWorkspaces.mockResolvedValue(selectedWorkspaces);
  });

  it('rejects cross-origin requests before authenticating or mutating', async () => {
    const response = await POST(request({ workspaceId: 'workspace-b' }, 'https://evil.example'));
    expect(response.status).toBe(403);
    expect(state.getSessionByTokenHash).not.toHaveBeenCalled();
    expect(state.listWorkspaces).not.toHaveBeenCalled();
    expect(state.cookieSet).not.toHaveBeenCalled();
  });

  it('requires an enabled user with a completed two-factor session', async () => {
    state.getSessionByTokenHash.mockResolvedValueOnce({
      id: 'session', userId: 'user', tokenHash: 'hash', expiresAt: new Date(Date.now() + 60_000), pending: 'totp',
      user: { id: 'user', disabledAt: null },
    });
    const response = await POST(request({ workspaceId: 'workspace-b' }));
    expect(response.status).toBe(401);
    expect(state.listWorkspaces).not.toHaveBeenCalled();
    expect(state.cookieSet).not.toHaveBeenCalled();
  });

  it('rejects sessions belonging to a disabled user', async () => {
    state.getSessionByTokenHash.mockResolvedValueOnce({
      id: 'session', userId: 'user', tokenHash: 'hash', expiresAt: new Date(Date.now() + 60_000), pending: null,
      user: { id: 'user', disabledAt: new Date() },
    });
    const response = await POST(request({ workspaceId: 'workspace-b' }));
    expect(response.status).toBe(401);
    expect(state.listWorkspaces).not.toHaveBeenCalled();
    expect(state.cookieSet).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON shapes before changing the selected workspace', async () => {
    const response = await POST(request({ workspaceId: 'workspace-b', redirect: 'https://evil.example' }));
    expect(response.status).toBe(400);
    expect(state.listWorkspaces).not.toHaveBeenCalled();
    expect(state.cookieSet).not.toHaveBeenCalled();
  });

  it('rejects a workspace without a current membership', async () => {
    const response = await POST(request({ workspaceId: 'foreign-workspace' }));
    expect(response.status).toBe(404);
    expect(state.cookieSet).not.toHaveBeenCalled();
  });

  it('sets only the authorized workspace cookie after validating the completed session', async () => {
    const response = await POST(request({ workspaceId: 'workspace-b' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(state.getSessionByTokenHash).toHaveBeenCalledTimes(1);
    expect(state.listWorkspaces).toHaveBeenCalledWith('user');
    expect(state.cookieSet).toHaveBeenCalledWith('sp_workspace', 'workspace-b', {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/',
    });
  });
});
