import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn(), disable: vi.fn(), sessions: vi.fn(), reset: vi.fn(), lock: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: state.actor } } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async () => 10 }));
vi.mock('../src/server/root/users', () => ({ loadRootUsers: state.list }));
vi.mock('../src/server/root/user-controls', () => ({ setRootUserDisabled: state.disable, revokeRootUserSessions: state.sessions, resetRootUserTwoStep: state.reset }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: state.lock, assertWorkspaceNotPurging: vi.fn() }));
import { handleMcpMessage, type McpInstallationViewer } from '../src/server/mcp/server';
import { runRootTool } from '../src/server/mcp/root-tools';
import { OperationError } from '../src/lib/operation-error';

const actor: McpInstallationViewer = { scope: 'installation', userId: 'root', isInstanceOwner: true, maxResultItems: 7 };
const invoke = (method: string, params = {}) => handleMcpMessage(actor, { jsonrpc: '2.0', id: 1, method, params });
const call = (name: string, args = {}) => invoke('tools/call', { name, arguments: args });
beforeEach(() => {
  vi.clearAllMocks();
  state.actor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
  state.list.mockResolvedValue({ users: [], total: 0, installationTotal: 3, status: 'all' });
  state.disable.mockResolvedValue({ changed: true, sessionsRevoked: 2 });
  state.sessions.mockResolvedValue({ sessionsRevoked: 2 });
  state.reset.mockResolvedValue({ sessionsRevoked: 2 });
});
describe('private user MCP workflow', () => {
  it('discovers user tools/resource and calls the bounded directory service', async () => {
    const names = (await (await invoke('tools/list')).json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('list_root_users'); expect(names).toContain('manage_root_user');
    const filters = { q: 'Member', status: 'disabled', page: 2 };
    await call('list_root_users', filters);
    expect(state.list).toHaveBeenCalledWith('root', { ...filters, page: '2' }, 7);
    const resource = await (await invoke('resources/read', { uri: 'msp://root/users' })).json();
    expect(state.list).toHaveBeenLastCalledWith('root', {}, 7);
    expect(JSON.parse(resource.result.contents[0].text).installationTotal).toBe(3);
  });
  it.each(['disable', 'enable', 'sign-out', 'reset-two-step'])('dispatches %s only through the shared audited service', async action => {
    const args = { userId: 'target', action, confirmation: 'exact confirmation for service validation' };
    const result = (await (await call('manage_root_user', args)).json()).result;
    expect(result.structuredContent).toMatchObject({ userId: 'target', action, sessionsRevoked: 2 });
    if (action === 'disable' || action === 'enable') expect(state.disable).toHaveBeenCalledWith('root', 'target', action === 'disable', args.confirmation);
    else expect(action === 'sign-out' ? state.sessions : state.reset).toHaveBeenCalledWith('root', 'target', args.confirmation);
    expect(state.lock).not.toHaveBeenCalled();
  });
  it.each([
    { userId: 'target', action: 'delete', confirmation: 'yes' }, { userId: 2, action: 'disable', confirmation: 'yes' },
    { userId: 'target', action: 'disable', confirmation: true }, { userId: 'target', action: 'disable', confirmation: 'yes', isInstanceOwner: true },
  ])('rejects invalid controls before a mutation: %j', async input => {
    expect((await (await call('manage_root_user', input)).json()).result.structuredContent.code).toBe('invalid_request');
    expect(state.disable).not.toHaveBeenCalled(); expect(state.sessions).not.toHaveBeenCalled(); expect(state.reset).not.toHaveBeenCalled();
  });
  it('denies workspace keys even if their creator is Root', async () => {
    await expect(runRootTool({ userId: 'root', isInstanceOwner: true, apiKeyId: 'key' }, 'list_root_users', {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(runRootTool({ userId: 'root', isInstanceOwner: true, apiKeyId: 'key' }, 'manage_root_user', {})).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.list).not.toHaveBeenCalled(); expect(state.disable).not.toHaveBeenCalled();
  });
  it('preserves shared-service errors and masks raw store failures', async () => {
    state.sessions.mockRejectedValueOnce(new OperationError('invalid_request', 'Enter the exact confirmation shown.'));
    const input = { userId: 'target', action: 'sign-out', confirmation: 'wrong' };
    expect((await (await call('manage_root_user', input)).json()).result.structuredContent.code).toBe('invalid_request');
    state.list.mockRejectedValueOnce(new Error('postgres://private-password@db'));
    const result = (await (await call('list_root_users')).json()).result;
    expect(result.structuredContent.code).toBe('upstream_failure');
    expect(JSON.stringify(result)).not.toContain('private-password');
  });
});
