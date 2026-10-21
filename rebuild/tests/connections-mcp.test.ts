import { beforeEach, describe, expect, it, vi } from 'vitest';
const service = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), disconnect: vi.fn(), operation: vi.fn(), purge: vi.fn(), health: vi.fn(), select: vi.fn() }));
vi.mock('../src/server/data', async importOriginal => ({ ...(await importOriginal<object>()), listConnections: service.list, prisma: { user: { findUnique: async () => ({ disabledAt: null }) }, membership: { findUnique: async () => ({ role: 'owner' }) } } }));
vi.mock('../src/server/connection-mutations', async importOriginal => ({ ...(await importOriginal<object>()), previewSocialAccountDeletion: service.preview, disconnectSocialAccount: service.disconnect, setConnectionSelections: service.select }));
vi.mock('../src/server/platforms/registry', async importOriginal => ({ ...(await importOriginal<object>()), platformGrantHealth: service.health }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: service.purge, withWorkspaceOperation: service.operation }));
vi.mock('../src/server/mcp/kit', async importOriginal => ({ ...(await importOriginal<object>()), auditedReceipt: async (_viewer: unknown, _tool: string, _detail: unknown, result: unknown) => result }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: async () => resolvePermissions({ role: 'owner', allPages: true, pageAccess: [], clientAccess: [], workspaceDisabledModules: [], memberDisabledModules: [] }) }));
vi.mock('../src/server/entitlements', async original => { const real = await original<typeof import('../src/server/entitlements')>(); return { ...real, loadEntitlements: async () => real.resolveEntitlements({ workspace: { id: 'workspace', disabledModules: [] }, membership: { userId: 'actor', disabledModules: [] } }) }; });
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'settings.connectionSelectionBatchSize' ? 2 : key === 'settings.connectionDirectoryPageSize' ? 25 : key === 'mcp.maxResultItems' ? 100 : false }));
import { handleMcpMessage, type McpViewer } from '../src/server/mcp/server';
import { resolvePermissions } from '../src/server/permissions';
import { resolveEntitlements } from '../src/server/entitlements';

function viewer(role = 'owner'): McpViewer {
  return { scope: 'workspace', userId: 'actor', workspaceId: 'workspace', role, maxResultItems: 1,
    workspace: { id: 'workspace', name: 'Synthetic team', timezone: 'UTC' },
    entitlements: resolveEntitlements({ workspace: { id: 'workspace', disabledModules: [] }, membership: { userId: 'actor', disabledModules: [] } }),
    permissions: resolvePermissions({ role, allPages: true, pageAccess: [], clientAccess: [], workspaceDisabledModules: [], memberDisabledModules: [] }),
  };
}
const invoke = async (actor: McpViewer, method: string, params = {}) => (await handleMcpMessage(actor, { jsonrpc: '2.0', id: 1, method, params })).json();
const call = (actor: McpViewer, name: string, args: Record<string, unknown> = {}) => invoke(actor, 'tools/call', { name, arguments: args });
const tools = ['list_connections', 'preview_connection_disconnect', 'disconnect_connection'];

beforeEach(() => {
  vi.clearAllMocks();
  service.operation.mockImplementation(async (_workspace: string, run: () => Promise<unknown>) => run());
  service.health.mockResolvedValue([]);
  const account = (id: string) => ({ id, provider: 'synthetic', name: `Source ${id}`, pictureUrl: null, invalidatedAt: null, tokenExpiresAt: null, scopes: ['secret-scope'], createdAt: new Date('2026-01-01T00:00:00Z'),
    targets: [{ id: `${id}-channel`, type: 'page', name: 'Channel', enabled: false }], adAccounts: [{ id: `${id}-ads`, actId: 'act_1', name: 'Ads', enabled: true }] });
  service.list.mockResolvedValue([account('a'), account('b')]);
  service.preview.mockResolvedValue({ channels: 1 });
  service.disconnect.mockResolvedValue({ mode: 'retain', stillScheduled: 0, retained: { channels: 1, adAccounts: 1, instagramAccounts: 0 } });
});

describe('connections MCP parity with the Connections screen and API', () => {
  it('advertises the tools only to managers', async () => {
    const names = (await invoke(viewer(), 'tools/list')).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(expect.arrayContaining(tools));
    for (const role of ['viewer', 'editor', 'contributor']) {
      expect((await invoke(viewer(role), 'tools/list')).result.tools.map((tool: { name: string }) => tool.name)).not.toEqual(expect.arrayContaining(['list_connections']));
      expect((await call(viewer(role), 'list_connections')).result.structuredContent.code).toBe('forbidden');
    }
    expect(service.list).not.toHaveBeenCalled();
  });
  it('lists discovered and unselected resources within the cap, without credentials', async () => {
    const result = (await call(viewer(), 'list_connections')).result.structuredContent;
    expect(result).toMatchObject({ total: 2, hasMore: true });
    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].channels).toEqual([{ id: 'a-channel', type: 'page', name: 'Channel', selected: false }]);
    expect(JSON.stringify(result)).not.toContain('secret-scope');
  });
  it('previews related data through the shared service', async () => {
    expect((await call(viewer(), 'preview_connection_disconnect', { socialAccountId: 'a' })).result.structuredContent.counts).toEqual({ channels: 1 });
    expect(service.preview).toHaveBeenCalledWith({ userId: 'actor', workspaceId: 'workspace' }, 'a');
  });
  it('requires the exact confirmation for each mode and never claims provider revocation', async () => {
    const refused = (await call(viewer(), 'disconnect_connection', { socialAccountId: 'a', mode: 'delete', confirmation: 'DISCONNECT a RETAIN' })).result.structuredContent;
    expect(refused.code).toBe('invalid_request'); expect(service.disconnect).not.toHaveBeenCalled();
    const retained = (await call(viewer(), 'disconnect_connection', { socialAccountId: 'a', mode: 'retain', confirmation: 'DISCONNECT a RETAIN' })).result.structuredContent;
    expect(service.disconnect).toHaveBeenLastCalledWith({ userId: 'actor', workspaceId: 'workspace' }, 'a', 'retain', undefined);
    expect(retained).toMatchObject({ providerAccessRevoked: false, mode: 'retain' });
    await call(viewer(), 'disconnect_connection', { socialAccountId: 'a', mode: 'delete', confirmation: 'DISCONNECT a DELETE RELATED DATA' });
    expect(service.disconnect).toHaveBeenLastCalledWith({ userId: 'actor', workspaceId: 'workspace' }, 'a', 'delete', 'DELETE');
  });
});

vi.mock('../src/server/context', () => ({ requireViewer: async () => ({ user: { id: 'actor' }, workspaceId: 'workspace' }) }));
vi.mock('../src/server/request-origin', () => ({ requestOrigin: () => 'https://app.example' }));
import { PATCH, DELETE } from '../src/app/api/connections/route';
const restRequest = (method: string, input: unknown) => new Request('https://app.example/api/connections', { method, headers: { origin: 'https://app.example' }, body: JSON.stringify(input) });
it.each(['retain', 'delete'] as const)('REST and MCP share %s consent, workspace guard and domain mutation', async mode => {
  service.disconnect.mockResolvedValue({ mode, stillScheduled: 0 });
  const input = { socialAccountId: 'a', mode, confirmation: `DISCONNECT a ${mode === 'retain' ? 'RETAIN' : 'DELETE RELATED DATA'}` };
  const rest = await DELETE(restRequest('DELETE', input));
  expect(await rest.json()).toEqual((await call(viewer(), 'disconnect_connection', input)).result.structuredContent);
  // REST invokes the service guard; MCP also has its outer host guard.
  expect(service.operation).toHaveBeenCalledTimes(3);
  expect(service.disconnect).toHaveBeenCalledTimes(2);
  for (const args of service.disconnect.mock.calls) expect(args).toEqual([{ userId: 'actor', workspaceId: 'workspace' }, 'a', mode, mode === 'delete' ? 'DELETE' : undefined]);
});
it.each(['DELETE', 'DISCONNECT other RETAIN', 'DISCONNECT a DELETE RELATED DATA'])('REST and MCP refuse stale retain consent %s before mutation', async confirmation => {
  const input = { socialAccountId: 'a', mode: 'retain', confirmation };
  expect((await DELETE(restRequest('DELETE', input))).status).toBe(400);
  expect((await call(viewer(), 'disconnect_connection', input)).result.structuredContent.code).toBe('invalid_request');
  expect(service.disconnect).not.toHaveBeenCalled();
  // Invalid MCP consent enters only the outer host guard, never the mutation.
  expect(service.operation).toHaveBeenCalledTimes(1);
});
it.each(['target', 'adAccount'] as const)('REST and MCP single %s selections share confirmation and atomic mutation', async kind => {
  const input = { kind, id: 'a', enabled: false, confirmation: `SET CONNECTION ${kind} a DISABLED` };
  const rest = await PATCH(restRequest('PATCH', input));
  expect(await rest.json()).toEqual({ ok: true, changed: 1 });
  expect((await call(viewer(), 'set_connection_selection', input)).result.structuredContent).toMatchObject({ kind, id: 'a', enabled: false });
  expect(service.select).toHaveBeenCalledTimes(2);
  for (const args of service.select.mock.calls) expect(args).toEqual([{ userId: 'actor', workspaceId: 'workspace' }, [{ kind, id: 'a', enabled: false }]]);
});
it('REST and single MCP selections refuse stale consent', async () => {
  const input = { kind: 'target', id: 'a', enabled: false, confirmation: 'SET CONNECTION target a ENABLED' };
  expect((await PATCH(restRequest('PATCH', input))).status).toBe(400);
  expect((await call(viewer(), 'set_connection_selection', input)).result.structuredContent.code).toBe('invalid_request');
  expect(service.select).not.toHaveBeenCalled();
});
