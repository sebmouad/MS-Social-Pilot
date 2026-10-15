import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  token: undefined as string | undefined,
  session: null as unknown,
  user: { id: 'u1' } as unknown,
  workspaces: [] as unknown[],
  getSessionByTokenHash: vi.fn(),
  listWorkspaces: vi.fn(),
  userFindUnique: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: (key: string) => key === 'msp_session' && state.token ? { value: state.token } : undefined })),
}));
vi.mock('../src/server/data', () => ({
  getSessionByTokenHash: state.getSessionByTokenHash,
  listWorkspaces: state.listWorkspaces,
  prisma: { user: { findUnique: state.userFindUnique }, $queryRaw: state.queryRaw },
}));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: vi.fn(async (key: string) => key === 'mcp.enabled' ? true : key === 'mcp.authenticatedRoles' ? ['owner', 'admin'] : 1_048_576) }));

import { hashLegacySessionToken } from '../src/server/auth';
import { POST } from '../src/app/api/mcp/route';

const token = Buffer.alloc(32, 3).toString('base64url');
const session = {
  id: 's1', userId: 'u1', tokenHash: hashLegacySessionToken(token)!,
  expiresAt: new Date(Date.now() + 60_000), pending: null,
  user: { id: 'u1', disabledAt: null },
};
const request = () => new Request('http://localhost/api/mcp', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
});

beforeEach(() => {
  vi.clearAllMocks();
  state.token = token;
  state.session = session;
  state.user = { id: 'u1' };
  state.workspaces = [{ role: 'owner', workspace: { id: 'w1', name: 'One', timezone: 'UTC' } }];
  state.getSessionByTokenHash.mockImplementation(async () => state.session);
  state.userFindUnique.mockImplementation(async () => state.user);
  state.listWorkspaces.mockImplementation(async () => state.workspaces);
  state.queryRaw.mockImplementation(async (_query: TemplateStringsArray, _userId: string, workspaceId: string) => [{ workspaceId, workspaceDisabled: [], suspendedAt: null, memberDisabled: [], planFeatures: null, isInstanceOwner: false }]);
});

describe('MCP route authentication', () => {
  it('rejects cross-origin browser writes before session lookup', async () => {
    const crossOrigin = new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { origin: 'https://other.example', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect((await POST(crossOrigin)).status).toBe(403);
    expect(state.getSessionByTokenHash).not.toHaveBeenCalled();
  });

  it('rejects malformed tokens and pending sessions without looking up a user', async () => {
    state.token = 'invalid';
    expect((await POST(request())).status).toBe(401);
    expect(state.getSessionByTokenHash).not.toHaveBeenCalled();

    state.token = token;
    state.session = { ...session, pending: 'verify' };
    expect((await POST(request())).status).toBe(401);
    expect(state.userFindUnique).not.toHaveBeenCalled();
  });

  it('requires an owner or admin workspace, while honoring a selected admin workspace', async () => {
    state.workspaces = [{ role: 'viewer', workspace: { id: 'w-view', name: 'Viewer', timezone: 'UTC' } }];
    expect((await POST(request())).status).toBe(401);

    state.workspaces = [
      { role: 'viewer', workspace: { id: 'w-view', name: 'Viewer', timezone: 'UTC' } },
      { role: 'admin', workspace: { id: 'w-admin', name: 'Admin', timezone: 'UTC' } },
    ];
    const authorized = await POST(request());
    expect(authorized.status).toBe(200);
    const body = await authorized.json();
    expect(body.result.instructions).toContain('Admin');
    expect(state.getSessionByTokenHash).toHaveBeenCalledWith(hashLegacySessionToken(token));
  });
});
