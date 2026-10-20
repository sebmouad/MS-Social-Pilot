import { beforeEach, describe, expect, it, vi } from 'vitest';
const service = vi.hoisted(() => ({ list: vi.fn(), preview: vi.fn(), disconnect: vi.fn(), operation: vi.fn(), purge: vi.fn(), health: vi.fn() }));
vi.mock('../src/server/data', async importOriginal => ({ ...(await importOriginal<object>()), listConnections: service.list }));
vi.mock('../src/server/connection-mutations', async importOriginal => ({ ...(await importOriginal<object>()), previewSocialAccountDeletion: service.preview, disconnectSocialAccount: service.disconnect }));
vi.mock('../src/server/platforms/registry', async importOriginal => ({ ...(await importOriginal<object>()), platformGrantHealth: service.health }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: service.purge, withWorkspaceOperation: service.operation }));
vi.mock('../src/server/mcp/kit', async importOriginal => ({ ...(await importOriginal<object>()), auditedReceipt: async (_viewer: unknown, _tool: string, _detail: unknown, result: unknown) => result }));
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
