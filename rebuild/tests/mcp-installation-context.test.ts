import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), save: vi.fn(), workspaces: vi.fn(), activity: vi.fn(), access: vi.fn(), lock: vi.fn(), post: vi.fn(), execute: vi.fn(), diagnostics: vi.fn(), diagnosticRun: vi.fn(), operations: vi.fn(), deletions: vi.fn(), confirmDeletion: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: state.actor }, post: { findMany: state.post }, $executeRaw: state.execute } }));
vi.mock('../src/server/config/store', () => ({ readConfig: state.read, saveConfig: state.save, runtimeConfig: async () => 100 }));
vi.mock('../src/server/root/inbox-deletions', () => ({ listRootInboxDeletions: state.deletions, confirmRootInboxDeletion: state.confirmDeletion }));
vi.mock('../src/server/root/diagnostics', () => ({ listRootDiagnostics: state.diagnostics, runRootDiagnostics: state.diagnosticRun }));
vi.mock('../src/server/root/operations', () => ({ loadRootOperations: state.operations }));
vi.mock('../src/server/root/directory', () => ({ listRootWorkspaces: state.workspaces }));
vi.mock('../src/server/root/activity', () => ({ listRootActivity: state.activity }));
vi.mock('../src/server/root/workspace-access', () => ({ setRootWorkspaceAccess: state.access }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: state.lock, assertWorkspaceNotPurging: vi.fn() }));
import { runRootTool } from '../src/server/mcp/root-tools';
import { handleMcpMessage, type McpInstallationViewer } from '../src/server/mcp/server';

const installation: McpInstallationViewer = { scope: 'installation', userId: 'root', isInstanceOwner: true, maxResultItems: 10 };
const invoke = (method: string, params = {}) => handleMcpMessage(installation, { jsonrpc: '2.0', id: 1, method, params });
const call = (name: string, args = {}) => invoke('tools/call', { name, arguments: args });
beforeEach(() => {
  vi.clearAllMocks();
  state.actor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null });
  state.read.mockResolvedValue([{ key: 'meta.appSecret', value: '', isSet: true }]);
  state.save.mockResolvedValue(undefined);
  state.workspaces.mockResolvedValue({ workspaces: [] });
  state.activity.mockResolvedValue({ items: [] });
  state.access.mockResolvedValue({ changed: true, suspended: false });
});
describe('installation-only MCP context', () => {
  it('initializes and lists only Root tools/resources without a workspace identity', async () => {
    expect(installation).not.toHaveProperty('workspaceId');
    const initialized = await (await invoke('initialize')).json();
    expect(initialized.result.instructions).toContain('Private installation access');
    const names = (await (await invoke('tools/list')).json()).result.tools.map((tool: { name: string }) => tool.name);
    expect(names.sort()).toEqual(['confirm_root_inbox_deletion', 'get_root_config', 'get_root_diagnostics', 'get_root_operations', 'list_root_activity', 'list_root_inbox_deletions', 'list_root_post_deletions', 'list_root_users', 'list_root_workspaces', 'manage_root_user', 'record_root_post_deletion_outcome', 'run_root_diagnostics', 'set_root_config', 'set_root_workspace_access']);
    const resources = (await (await invoke('resources/list')).json()).result.resources.map((resource: { uri: string }) => resource.uri);
    expect(resources.sort()).toEqual(['msp://root/activity', 'msp://root/config', 'msp://root/diagnostics', 'msp://root/inbox-deletions', 'msp://root/operations', 'msp://root/post-deletions', 'msp://root/users', 'msp://root/workspaces']);
  });
  it('rejects forced workspace calls before write locks or data/provider queries', async () => {
    for (const name of ['list_posts', 'create_draft', 'delete_workspace_data', 'get_live_ad_status']) {
      expect((await (await call(name)).json()).result.structuredContent.code).toBe('forbidden');
    }
    for (const uri of ['msp://workspace', 'msp://posts', 'msp://ads/performance']) expect((await (await invoke('resources/read', { uri })).json()).error).toBeDefined();
    expect(state.lock).not.toHaveBeenCalled();
    expect(state.post).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
    expect(state.actor).not.toHaveBeenCalled();
  });
  it('uses shared Root services and caps without a workspace lock', async () => {
    await call('list_root_activity', { limit: 100 });
    expect(state.activity).toHaveBeenCalledWith('root', { limit: 100 }, 10);
    await invoke('resources/read', { uri: 'msp://root/workspaces' });
    expect(state.workspaces).toHaveBeenCalledWith({ q: undefined, page: undefined }, 10);
    await call('set_root_workspace_access', { workspaceId: 'workspace-a', suspended: false, confirmation: 'RESTORE WORKSPACE workspace-a' });
    expect(state.access).toHaveBeenCalledWith('root', 'workspace-a', false, 'RESTORE WORKSPACE workspace-a');
    expect(state.lock).not.toHaveBeenCalled();
  });
  it('rejects non-object Root arguments before domain reads', async () => {
    for (const input of [null, [], 'wrong']) {
      const response = await invoke('tools/call', { name: 'get_root_config', arguments: input });
      expect((await response.json()).result.structuredContent.code).toBe('invalid_request');
    }
    expect(state.read).not.toHaveBeenCalled();
  });
  it.each([null, { isInstanceOwner: false, disabledAt: null }, { isInstanceOwner: true, disabledAt: new Date() }])('rechecks current owner authority before Root data or mutations', async actor => {
    state.actor.mockResolvedValue(actor);
    for (const name of ['list_root_inbox_deletions', 'confirm_root_inbox_deletion', 'get_root_diagnostics', 'run_root_diagnostics', 'get_root_operations', 'get_root_config', 'set_root_config', 'list_root_workspaces', 'list_root_activity', 'set_root_workspace_access', 'list_root_users', 'manage_root_user']) expect((await (await call(name)).json()).result.structuredContent.code).toBe('forbidden');
    expect(state.read).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled(); expect(state.activity).not.toHaveBeenCalled(); expect(state.workspaces).not.toHaveBeenCalled(); expect(state.access).not.toHaveBeenCalled();
  });
  it('routes private diagnostics and worker reads to shared services with caps and exact run arguments', async () => {
    state.operations.mockResolvedValue({ runs: [] }); state.diagnostics.mockResolvedValue({ history: [] }); state.diagnosticRun.mockResolvedValue({ auditRecorded: false, warning: 'Keep receipt.' });
    await call('get_root_operations', { moduleId: 'inbox' }); expect(state.operations).toHaveBeenCalledWith('root', 'inbox', 10);
    await call('get_root_diagnostics', { scope: 'platform:facebook' }); expect(state.diagnostics).toHaveBeenCalledWith('root', 'platform:facebook', 10);
    const args = { scope: 'platform:facebook', connectionId: 'connection', confirmation: 'RUN DIAGNOSTICS platform:facebook' };
    const result = await (await call('run_root_diagnostics', args)).json(); expect(state.diagnosticRun).toHaveBeenCalledWith('root', args); expect(result.result.structuredContent.auditRecorded).toBe(false);
    await invoke('resources/read', { uri: 'msp://root/diagnostics' }); expect(state.diagnostics).toHaveBeenCalledWith('root', 'shared', 10);
  });
  it('refuses owner-created workspace keys for every new diagnostic capability before services', async () => {
    for (const name of ['get_root_operations', 'get_root_diagnostics', 'run_root_diagnostics', 'list_root_inbox_deletions', 'confirm_root_inbox_deletion']) await expect(runRootTool({ userId: 'root', isInstanceOwner: true, apiKeyId: 'workspace-key' }, name, {})).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.actor).not.toHaveBeenCalled(); expect(state.operations).not.toHaveBeenCalled(); expect(state.diagnostics).not.toHaveBeenCalled(); expect(state.diagnosticRun).not.toHaveBeenCalled();
  });
  it('shares bounded private deletion history and exact operator attestation through tools/resources', async () => {
    state.deletions.mockResolvedValue({ items: [] });
    state.confirmDeletion.mockResolvedValue({ ok: true, operationId: 'operation', state: 'remote_confirmed' });
    await invoke('resources/read', { uri: 'msp://root/inbox-deletions' });
    expect(state.deletions).toHaveBeenCalledWith('root', 10);
    const args = { operationId: 'operation', verifiedOnPlatform: true, confirmation: 'CONFIRM REMOTE DELETION operation' };
    const response = await (await call('confirm_root_inbox_deletion', args)).json();
    expect(state.confirmDeletion).toHaveBeenCalledWith('root', args);
    expect(response.result.structuredContent.state).toBe('remote_confirmed');
    expect(state.lock).not.toHaveBeenCalled(); // Domain service owns its lifecycle locks.
    expect(state.execute).not.toHaveBeenCalled(); // Atomic domain audit only.
  });
  it('validates config types/keys/confirmation, retains the atomic domain audit and masks unexpected failures', async () => {
    for (const input of [
      { key: 'mcp.enabled', value: 'false', confirmation: 'SET ROOT CONFIG mcp.enabled' },
      { key: 'mcp.enabled', value: false, clear: 'true', confirmation: 'SET ROOT CONFIG mcp.enabled' },
      { key: 'unknown', value: false, confirmation: 'SET ROOT CONFIG unknown' },
      { key: 'mcp.enabled', value: false, confirmation: 'yes' },
    ]) expect((await (await call('set_root_config', input)).json()).result.structuredContent.code).toBe('invalid_request');
    expect(state.save).not.toHaveBeenCalled();
    const input = { key: 'mcp.enabled', value: true, confirmation: 'SET ROOT CONFIG mcp.enabled' };
    expect((await (await call('set_root_config', input)).json()).result.structuredContent.saved).toBe(true);
    expect(state.save).toHaveBeenCalledWith({ key: 'mcp.enabled', value: true, clear: false }, 'root');
    expect(state.execute).not.toHaveBeenCalled();
    state.read.mockRejectedValueOnce(new Error('postgres://private-password@host'));
    const failure = (await (await call('get_root_config')).json()).result;
    expect(failure.structuredContent.code).toBe('upstream_failure');
    expect(JSON.stringify(failure)).not.toContain('private-password');
  });
});
