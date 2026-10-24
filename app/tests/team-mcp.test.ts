import { beforeEach, describe, expect, it, vi } from 'vitest';
const service = vi.hoisted(() => ({ read: vi.fn(), add: vi.fn(), update: vi.fn(), remove: vi.fn(), purge: vi.fn(), workspace: vi.fn() }));
vi.mock('../src/modules/settings/server/team', () => ({ getTeamDirectory: service.read, addTeamMember: service.add, updateTeamMember: service.update, removeTeamMember: service.remove }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: service.purge, withWorkspaceOperation: service.workspace }));
import { handleMcpMessage, type McpViewer } from '../src/server/mcp/server';
import { resolvePermissions } from '../src/server/permissions';
import { resolveEntitlements } from '../src/server/entitlements';
import { OperationError } from '../src/lib/operation-error';

function viewer(role = 'owner'): McpViewer {
  return { scope: 'workspace', userId: 'actor', workspaceId: 'workspace', role, maxResultItems: 2,
    workspace: { id: 'workspace', name: 'Synthetic team', timezone: 'UTC' },
    entitlements: resolveEntitlements({ workspace: { id: 'workspace', disabledModules: [] }, membership: { userId: 'actor', disabledModules: [] } }),
    permissions: resolvePermissions({ role, allPages: true, pageAccess: [], clientAccess: [], workspaceDisabledModules: [], memberDisabledModules: [] }),
  };
}
const invoke = async (actor: McpViewer, method: string, params = {}) => (await handleMcpMessage(actor, { jsonrpc: '2.0', id: 1, method, params })).json();
const call = (actor: McpViewer, name: string, args: Record<string, unknown> = {}) => invoke(actor, 'tools/call', { name, arguments: args });
beforeEach(() => {
  vi.clearAllMocks();
  service.read.mockResolvedValue({ actorRole: 'owner', actorId: 'actor', members: [1, 2, 3].map(id => ({ id: `member-${id}`, email: `person${id}@example.test`, targetIds: [], allPages: true })), targets: [1, 2, 3].map(id => ({ id: `channel-${id}`, name: `Channel ${id}` })), total: 3, hasMore: false });
  service.add.mockResolvedValue({ id: 'added', added: true });
  service.update.mockResolvedValue({ id: 'updated', updated: true });
  service.remove.mockResolvedValue({ id: 'removed', removed: true });
});

describe('team UI/API/MCP service parity', () => {
  it('advertises tools and resource for workspace managers', async () => {
    const actor = viewer();
    const names = (await invoke(actor, 'tools/list')).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['list_workspace_team', 'add_workspace_member', 'update_workspace_member', 'remove_workspace_member']));
    expect((await invoke(actor, 'resources/list')).result.resources.map((resource: { uri: string }) => resource.uri)).toContain('msp://settings/team');
  });
  it('independently pages members and channel choices within the MCP cap', async () => {
    const result = (await call(viewer(), 'list_workspace_team', { limit: 200 })).result.structuredContent;
    expect(result.members).toHaveLength(2); expect(result.targets).toHaveLength(2);
    expect(result).toMatchObject({ total: 3, totalTargets: 3, nextOffset: 2, nextTargetOffset: 2 });
    const last = (await call(viewer(), 'list_workspace_team', { offset: 2, targetOffset: 2 })).result.structuredContent;
    expect(last.members[0].id).toBe('member-3'); expect(last.targets[0].id).toBe('channel-3');
    expect(last.nextOffset).toBeNull(); expect(last.nextTargetOffset).toBeNull();
  });
  it('reads the resource through the same capped service', async () => {
    const result = (await invoke(viewer(), 'resources/read', { uri: 'msp://settings/team' })).result;
    expect(JSON.parse(result.contents[0].text).members).toHaveLength(2);
    expect(service.read).toHaveBeenCalledWith({ userId: 'actor', workspaceId: 'workspace' });
  });
  it.each(['viewer', 'editor', 'contributor', 'client'])('does not advertise or run team tools for %s', async role => {
    const actor = viewer(role);
    const names = (await invoke(actor, 'tools/list')).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).not.toContain('list_workspace_team'); expect(names).not.toContain('add_workspace_member');
    expect((await call(actor, 'list_workspace_team')).result.structuredContent.code).toBe('forbidden');
    await invoke(actor, 'resources/read', { uri: 'msp://settings/team' });
    expect(service.read).not.toHaveBeenCalled();
  });
  it.each(['add', 'update', 'remove'] as const)('dispatches %s to the transactional domain service without another workspace wrapper', async action => {
    const args = { membershipId: 'target', confirmation: 'forwarded for service validation' };
    const result = (await call(viewer(), `${action}_workspace_member`, args)).result.structuredContent;
    expect(service[action]).toHaveBeenCalledWith({ userId: 'actor', workspaceId: 'workspace' }, args);
    expect(result.id).toBe(`${action === 'add' ? 'added' : action === 'update' ? 'updated' : 'removed'}`);
    expect(service.workspace).not.toHaveBeenCalled();
  });
  it('enforces read-only key permissions even if the creator is an owner', async () => {
    const actor = viewer();
    actor.apiKeyId = 'read-only';
    actor.permissions = { ...actor.permissions!, features: { ...actor.permissions!.features, 'settings/team': { read: true, write: false } } };
    expect((await call(actor, 'add_workspace_member', {})).result.structuredContent.code).toBe('forbidden');
    expect(service.add).not.toHaveBeenCalled();
  });
  it.each([{ offset: -1 }, { limit: '2' }, { targetOffset: 0.5 }, { limit: 201 }, { unknown: true }])('rejects noncanonical paging %j', async args => {
    expect((await call(viewer(), 'list_workspace_team', args)).result.structuredContent.code).toBe('invalid_request');
    expect(service.read).not.toHaveBeenCalled();
  });
  it('preserves typed permission failures and masks unexpected storage details', async () => {
    service.remove.mockRejectedValueOnce(new OperationError('forbidden', 'Only an owner can manage an owner membership.'));
    expect((await call(viewer(), 'remove_workspace_member')).result.structuredContent.code).toBe('forbidden');
    service.read.mockRejectedValueOnce(new Error('private connection credentials'));
    const result = await call(viewer(), 'list_workspace_team');
    expect(result.result.structuredContent.code).toBe('upstream_failure');
    expect(JSON.stringify(result)).not.toContain('private connection');
  });
  it('never exposes workspace team tools in installation-only context', async () => {
    const response = await handleMcpMessage({ scope: 'installation', userId: 'root', isInstanceOwner: true }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_workspace_team' } });
    expect((await response.json()).result.structuredContent.code).toBe('forbidden');
    expect(service.read).not.toHaveBeenCalled();
  });
});
