import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  enabled: true,
  budget: 1000,
  token: undefined as string | undefined,
  session: null as unknown,
  user: { id: 'u1' } as unknown,
  workspaces: [] as unknown[],
  getSessionByTokenHash: vi.fn(),
  listWorkspaces: vi.fn(),
  userFindUnique: vi.fn(),
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  appSettingFindMany: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: (key: string) => key === 'msp_session' && state.token ? { value: state.token } : undefined })),
}));
vi.mock('../src/server/data', () => ({
  getSessionByTokenHash: state.getSessionByTokenHash,
  listWorkspaces: state.listWorkspaces,
  prisma: { user: { findUnique: state.userFindUnique }, appSetting: { findMany: state.appSettingFindMany }, $queryRaw: state.queryRaw, $executeRaw: state.executeRaw },
}));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: vi.fn(async (key: string) => key === 'mcp.enabled' ? state.enabled : key === 'mcp.authenticatedRoles' ? ['owner', 'admin'] : key === 'mcp.requestsPerMinute' ? state.budget : 1_048_576) }));

import { hashLegacySessionToken } from '../src/server/auth';
import { GET, POST } from '../src/app/api/mcp/route';
import { clear } from '../src/server/rate-limit';

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
  state.enabled = true; state.budget = 1000;
  clear('mcp:installation:u1'); clear('mcp:w1:u1'); clear('mcp:key:mk1');
  state.token = token;
  state.session = session;
  state.user = { id: 'u1' };
  state.workspaces = [{ role: 'owner', workspace: { id: 'w1', name: 'One', timezone: 'UTC' } }];
  state.getSessionByTokenHash.mockImplementation(async () => state.session);
  state.userFindUnique.mockImplementation(async () => state.user);
  state.listWorkspaces.mockImplementation(async () => state.workspaces);
  state.appSettingFindMany.mockResolvedValue([]);
  state.executeRaw.mockResolvedValue(1);
  state.queryRaw.mockImplementation(async (query: TemplateStringsArray, _userId: string, workspaceId: string) => query.join('').includes('AS role')
    ? [{ role: 'admin', allPages: true, workspaceDisabled: [], memberDisabled: [], clientAccess: [], pageIds: [] }]
    : query.join('').includes('FROM mcp_api_keys') ? [{ id: 'mk1', workspaceId: 'w1', createdById: 'u1', readFeatures: ['publishing/posts'], writeFeatures: [] }]
      : [{ workspaceId, workspaceDisabled: [], suspendedAt: null, memberDisabled: [], planFeatures: null, isInstanceOwner: false }]);
});

describe('MCP route authentication', () => {
  it('enforces the global MCP switch and a per-owner installation request budget', async () => {
    state.user = { id: 'u1', isInstanceOwner: true, disabledAt: null };
    const root = () => new Request('http://localhost/api/mcp?scope=installation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    state.enabled = false;
    expect((await POST(root())).status).toBe(401);
    expect(state.getSessionByTokenHash).not.toHaveBeenCalled();
    state.enabled = true; state.budget = 1;
    expect((await POST(root())).status).toBe(200);
    const limited = await POST(root());
    expect(limited.status).toBe(429);
    expect(limited.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps Root available when current workspace grants cannot be resolved', async () => {
    state.user = { id: 'u1', isInstanceOwner: true, disabledAt: null };
    state.queryRaw.mockResolvedValue([]);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).result.instructions).toContain('Private installation access');
  });
  it('gives installation owners Root-only access without any workspace membership', async () => {
    state.user = { id: 'u1', isInstanceOwner: true, disabledAt: null };
    state.workspaces = [];
    const response = await POST(new Request('http://localhost/api/mcp?scope=installation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const names = (await response.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('get_root_config');
    expect(names).not.toContain('list_posts');
    expect(state.listWorkspaces).not.toHaveBeenCalled();
    expect(state.queryRaw).not.toHaveBeenCalled();
    expect((await POST(request())).status).toBe(200);
    expect((await GET(new Request('http://localhost/api/mcp?scope=installation'))).status).toBe(405);
  });

  it('does not upgrade explicit workspace scope and denies installation access to non-owners and bearer keys', async () => {
    state.user = { id: 'u1', isInstanceOwner: true, disabledAt: null };
    state.workspaces = [];
    const scoped = (scope: string, authorization?: string) => new Request(`http://localhost/api/mcp?scope=${scope}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect((await POST(scoped('workspace'))).status).toBe(401);
    expect((await POST(scoped('installation', `Bearer mcp_${'a'.repeat(43)}`))).status).toBe(401);
    state.workspaces = [{ role: 'owner', workspace: { id: 'w1', name: 'One', timezone: 'UTC' } }];
    state.user = { id: 'u1', isInstanceOwner: false, disabledAt: null };
    expect((await POST(scoped('installation'))).status).toBe(401);
    state.user = { id: 'u1', isInstanceOwner: true, disabledAt: new Date() };
    expect((await POST(scoped('installation'))).status).toBe(401);
  });

  it('keeps explicit workspace discovery free of Root tools for an installation owner', async () => {
    state.user = { id: 'u1', isInstanceOwner: true, disabledAt: null };
    const response = await POST(new Request('http://localhost/api/mcp?scope=workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }));
    const names = (await response.json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('list_posts');
    expect(names).not.toContain('get_root_config');
  });

  it('does not pass the owner suspension-inspection exception to workspace keys or explicit workspace scope', async () => {
    state.user = { id: 'u1', isInstanceOwner: true, disabledAt: null };
    state.queryRaw.mockImplementation(async (query: TemplateStringsArray) => query.join('').includes('AS role')
      ? [{ role: 'owner', allPages: true, workspaceDisabled: [], memberDisabled: [], clientAccess: [], pageIds: [] }]
      : query.join('').includes('FROM mcp_api_keys') ? [{ id: 'mk1', workspaceId: 'w1', createdById: 'u1', readFeatures: ['publishing/posts'], writeFeatures: [] }]
        : [{ workspaceId: 'w1', workspaceDisabled: [], suspendedAt: new Date(), memberDisabled: [], planFeatures: null, isInstanceOwner: true }]);
    for (const bearer of [false, true]) {
      const response = await POST(new Request('http://localhost/api/mcp?scope=workspace', { method: 'POST', headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer mcp_${'a'.repeat(43)}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_posts', arguments: {} } }) }));
      expect((await response.json()).result.structuredContent.code).toBe('forbidden');
    }
  });

  it('rejects malformed/repeated scopes and never replaces an invalid bearer with the owner cookie', async () => {
    state.user = { id: 'u1', isInstanceOwner: true, disabledAt: null };
    for (const suffix of ['?scope=unknown', '?scope=workspace&scope=installation']) {
      const bad = new Request(`http://localhost/api/mcp${suffix}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect((await POST(bad)).status).toBe(400);
    }
    const bearer = new Request('http://localhost/api/mcp?scope=installation', { method: 'POST', headers: { authorization: 'Bearer invalid', 'content-type': 'application/json' }, body: '{}' });
    expect((await POST(bearer)).status).toBe(401);
    expect(state.getSessionByTokenHash).not.toHaveBeenCalled();
  });

  it('falls back to private owner access when the workspace role is ineligible, without granting workspace tools', async () => {
    state.user = { id: 'u1', isInstanceOwner: true, disabledAt: null };
    state.workspaces = [{ role: 'viewer', workspace: { id: 'w1', name: 'One', timezone: 'UTC' } }];
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).result.instructions).toContain('installation');
    expect(state.queryRaw).not.toHaveBeenCalled();
  });
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

  it('accepts a hashed bearer key and fixes it to its stored workspace and feature scopes', async () => {
    const bearer = new Request('http://localhost/api/mcp', { method: 'POST', headers: { authorization: `Bearer mcp_${'a'.repeat(43)}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/list' }) });
    const response = await POST(bearer);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['list_posts']);
    expect(state.executeRaw).toHaveBeenCalled();
    const writeAttempt = new Request('http://localhost/api/mcp', { method: 'POST', headers: { authorization: `Bearer mcp_${'a'.repeat(43)}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'create_draft', arguments: { message: 'nope', confirmation: 'CREATE DRAFT' } } }) });
    const denied = await POST(writeAttempt);
    expect((await denied.json()).result.isError).toBe(true);
  });

  it('exposes Root MCP tools only when the authenticated browser user is the instance owner', async () => {
    const listed = () => new Request('http://localhost/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/list' }) });
    state.user = { id: 'u1', isInstanceOwner: true };
    const response = await POST(listed());
    expect((await response.json()).result.tools.map((tool: { name: string }) => tool.name)).toContain('get_root_config');
    state.user = { id: 'u1', isInstanceOwner: false };
    const denied = await POST(listed());
    expect((await denied.json()).result.tools.map((tool: { name: string }) => tool.name)).not.toContain('get_root_config');
  });
});
