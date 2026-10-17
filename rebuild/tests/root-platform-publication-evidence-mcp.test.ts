import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), action: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: { user: { findUnique: state.actor } } }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async () => 9 }));
vi.mock('../src/server/root/platform-publication-evidence', () => ({ readRootPlatformPublicationEvidence: state.read, runRootPlatformPublicationAction: state.action }));
import { handleMcpMessage, type McpInstallationViewer } from '../src/server/mcp/server';
import { runRootTool } from '../src/server/mcp/root-tools';

const root: McpInstallationViewer = { scope: 'installation', userId: 'root', isInstanceOwner: true, maxResultItems: 7 };
const invoke = (method: string, params = {}) => handleMcpMessage(root, { jsonrpc: '2.0', id: 1, method, params });
const call = (name: string, args = {}) => invoke('tools/call', { name, arguments: args });
beforeEach(() => { vi.clearAllMocks(); state.actor.mockResolvedValue({ isInstanceOwner: true, disabledAt: null }); state.read.mockResolvedValue({ providerId: 'platform', title: 'Evidence', columns: [], items: [], truncated: false }); state.action.mockResolvedValue({ ok: true, actionId: 'module_action', subjectId: 'row_1', operationId: 'receipt_1', state: 'confirmed', message: 'Receipt recorded.' }); });

describe('Root platform publication evidence MCP', () => {
  it('exposes a required-provider read tool and bounds it by the installation result ceiling', async () => {
    const tools = (await (await invoke('tools/list')).json()).result.tools;
    const definition = tools.find((tool: { name: string }) => tool.name === 'get_root_platform_publication_evidence');
    expect(definition.inputSchema.required).toEqual(['providerId']);
    await call('get_root_platform_publication_evidence', { providerId: 'platform', operationId: 'op_1' });
    expect(state.read).toHaveBeenCalledWith('root', { providerId: 'platform', operationId: 'op_1', resultCap: 7 });
  });
  it('serves an aggregate resource through the same Root service and cap', async () => {
    const listed = await (await invoke('resources/list')).json();
    expect(listed.result.resources.map((resource: { uri: string }) => resource.uri)).toContain('msp://root/platform-publication-evidence');
    const response = await (await invoke('resources/read', { uri: 'msp://root/platform-publication-evidence' })).json();
    expect(JSON.parse(response.result.contents[0].text)).toEqual({ providerId: 'platform', title: 'Evidence', columns: [], items: [], truncated: false });
    expect(state.read).toHaveBeenCalledWith('root', { resultCap: 7 });
  });
  it('validates tool arguments and denies workspace keys without touching the service', async () => {
    const invalid = await (await call('get_root_platform_publication_evidence', { operationId: 'op_1' })).json();
    expect(invalid.result.isError).toBe(true); expect(state.read).not.toHaveBeenCalled();
    await expect(runRootTool({ userId: 'root', isInstanceOwner: true, apiKeyId: 'workspace_key' }, 'get_root_platform_publication_evidence', { providerId: 'platform' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(state.read).not.toHaveBeenCalled();
  });
  it('publishes and dispatches the module-generic acknowledged Root action tool', async () => {
    const tools = (await (await invoke('tools/list')).json()).result.tools;
    const definition = tools.find((tool: { name: string }) => tool.name === 'run_root_platform_publication_action');
    expect(definition.inputSchema.required).toEqual(['providerId', 'actionId', 'subjectId', 'confirmation', 'acknowledged']);
    const input = { providerId: 'platform', actionId: 'module_action', subjectId: 'row_1', confirmation: 'MODULE CONFIRM', acknowledged: true };
    const result = await (await call('run_root_platform_publication_action', input)).json();
    expect(result.result.structuredContent).toMatchObject({ state: 'confirmed', ok: true });
    expect(state.action).toHaveBeenCalledWith('root', input);
    await expect(runRootTool({ userId: 'root', isInstanceOwner: true, apiKeyId: 'workspace_key' }, 'run_root_platform_publication_action', input)).rejects.toMatchObject({ code: 'forbidden' });
  });
});
