import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpToolGroup } from '../src/server/mcp/kit';

const state = vi.hoisted(() => ({ groups: [] as McpToolGroup[], execute: vi.fn(), purge: vi.fn() }));
vi.mock('../src/server/data', () => ({ prisma: {} }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: async () => 7 }));
vi.mock('../src/server/data-control/guard', () => ({
  assertWorkspaceNotPurging: state.purge,
  withWorkspaceOperation: async (_id: string, run: () => Promise<unknown>) => run(),
}));
vi.mock('../src/modules/installed-mcp', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/modules/installed-mcp')>();
  // Exercise the real installed inventory, scope declarations, permissions and RPC host.
  // Domain execution/availability are isolated here; service behavior is tested separately.
  state.groups = actual.installedMcpGroups().map(group => ({
    ...group, init: undefined, available: undefined, listFilter: undefined,
    execute: (...args) => state.execute(group.id, ...args),
  }));
  return { installedMcpGroups: () => state.groups };
});

import { installedMcpGroups } from '../src/modules/installed-mcp';
import { handleMcpMessage } from '../src/server/mcp/server';
import type { McpViewer } from '../src/server/mcp/types';
import { resolvePermissions } from '../src/server/permissions';
import { rootToolDefinitions, rootResources } from '../src/server/mcp/root-tools';
import { MODULES, PAGES } from '../src/lib/product';
import type { Entitlements } from '../src/server/entitlements';

const groups = installedMcpGroups();
const tools = groups.flatMap(group => group.tools.map(tool => ({ group, name: tool.name })));
const resources = groups.flatMap(group => (group.resources ?? []).map(resource => ({ group, resource })));
const permissions = resolvePermissions({ role: 'admin', allPages: true, pageAccess: [], workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [] });
const features = Object.fromEntries(PAGES.map(page => [page.id, true])) as Entitlements['features'];
const modules = Object.fromEntries(MODULES.map(module => [module.id, true])) as Entitlements['modules'];
const viewer: McpViewer = {
  scope: 'workspace', userId: 'synthetic-user', workspaceId: 'synthetic-workspace', role: 'admin',
  workspace: { id: 'synthetic-workspace', name: 'Example studio', timezone: 'UTC' },
  permissions, entitlements: { workspaceId: 'synthetic-workspace', modules, features, platformCapabilities: {} },
  apiKeyId: 'synthetic-key', maxResultItems: 7,
};
const ceilings = [
  { label: 'channel-only', pageScope: { all: false as const, ids: ['channel-a'] }, allowedAdAccountIds: [] },
  { label: 'account-only', pageScope: { all: false as const, ids: [] }, allowedAdAccountIds: ['account-a'] },
  { label: 'account-restricted with all channels', pageScope: { all: true as const }, allowedAdAccountIds: ['account-a'] },
  { label: 'empty', pageScope: { all: false as const, ids: [] }, allowedAdAccountIds: [] },
];
const scoped = (ceiling: typeof ceilings[number]): McpViewer => ({
  ...viewer, resourceRestricted: true, allowedAdAccountIds: ceiling.allowedAdAccountIds,
  adAccountTargetScope: { all: true }, permissions: { ...permissions, pageScope: ceiling.pageScope },
});
const rpc = async (who: McpViewer, method: string, params: Record<string, unknown> = {}) =>
  (await handleMcpMessage(who, { jsonrpc: '2.0', id: 1, method, params })).json();

beforeEach(() => {
  vi.clearAllMocks();
  state.execute.mockImplementation(async (group, actor, name, args, cap) => ({ group, name, args, cap, workspaceId: actor.workspaceId }));
});

describe('installed MCP inventory and restricted-key RPC enforcement', () => {
  it('covers every installed group and has disjoint, complete tool classifications', () => {
    expect(groups.length).toBeGreaterThan(20);
    expect(new Set(tools.map(tool => tool.name)).size).toBe(tools.length);
    for (const group of groups) {
      const classified = [...group.scope.resourceTools ?? [], ...group.scope.workspaceTools ?? []];
      expect(new Set(classified).size, group.id).toBe(classified.length);
      expect(classified.sort(), group.id).toEqual(group.tools.map(tool => tool.name).sort());
      for (const { name } of group.tools) expect(group.features[name], `${group.id}/${name}`).toBeTruthy();
      for (const resource of group.resources ?? []) {
        expect(group.tools.some(tool => tool.name === resource.readTool), resource.uri).toBe(true);
        expect([...group.writeTools ?? []], resource.uri).not.toContain(resource.readTool);
      }
    }
  });

  describe.each(ceilings)('$label credential', ceiling => {
    const who = scoped(ceiling);
    it('hides workspace-wide tools/resources while retaining reviewed resource-safe declarations', async () => {
      const names = (await rpc(who, 'tools/list')).result.tools.map((tool: { name: string }) => tool.name);
      for (const name of names) expect(tools.some(tool => tool.name === name && tool.group.scope.resourceTools?.includes(name)), name).toBe(true);
      const uris = (await rpc(who, 'resources/list')).result.resources.map((resource: { uri: string }) => resource.uri);
      for (const uri of uris) expect(uri === 'msp://workspace' || resources.some(item => item.resource.uri === uri && item.group.scope.resources?.includes(uri) && item.group.scope.resourceTools?.includes(item.resource.readTool)), uri).toBe(true);
      expect(state.execute).not.toHaveBeenCalled();
    });

    it.each(tools.filter(({ group, name }) => group.scope.workspaceTools?.includes(name)))('refuses direct $name calls before domain execution', async ({ name }) => {
      const result = await rpc(who, 'tools/call', { name, arguments: { confirmation: 'CONFIRMED', targetIds: ['channel-b'], adAccountId: 'account-b' } });
      expect(result.result?.structuredContent?.code).toBe('forbidden');
      expect(state.execute).not.toHaveBeenCalled();
      expect(state.purge).not.toHaveBeenCalled();
    });

    it.each(resources.filter(({ group, resource }) => !group.scope.resources?.includes(resource.uri) || !group.scope.resourceTools?.includes(resource.readTool)))('refuses direct $resource.uri reads', async ({ resource }) => {
      expect((await rpc(who, 'resources/read', { uri: resource.uri })).error?.message).toBe('Resource unavailable.');
      expect(state.execute).not.toHaveBeenCalled();
    });

    it.each(resources.filter(({ group, resource }) => group.scope.resources?.includes(resource.uri) && group.scope.resourceTools?.includes(resource.readTool)))('$resource.uri dispatches identically to its read tool with the same viewer and cap', async ({ group, resource }) => {
      const read = await rpc(who, 'resources/read', { uri: resource.uri });
      expect(read.error).toBeUndefined();
      const contents = JSON.parse(read.result.contents[0].text);
      expect(state.execute).toHaveBeenLastCalledWith(group.id, who, resource.readTool, resource.readArgs ?? {}, 7);
      const called = await rpc(who, 'tools/call', { name: resource.readTool, arguments: resource.readArgs ?? {} });
      expect(called.result.structuredContent).toEqual(contents);
    });
  });

  it.each(rootToolDefinitions)('refuses Root tool $name even when the key owner is the instance owner', async ({ name }) => {
    const response = await rpc({ ...viewer, isInstanceOwner: true }, 'tools/call', { name });
    expect(response.result?.structuredContent?.code).toBe('forbidden');
    expect(state.execute).not.toHaveBeenCalled();
  });

  it.each(rootResources)('refuses Root resource $uri to a restricted instance-owner key', async ({ uri }) => {
    expect((await rpc({ ...scoped(ceilings[0]!), isInstanceOwner: true }, 'resources/read', { uri })).error).toBeDefined();
    expect(state.execute).not.toHaveBeenCalled();
  });
});

describe('read-only and revoked feature ceilings across every installed module', () => {
  const readonly: McpViewer = { ...viewer, resourceRestricted: false, permissions: {
    ...permissions, features: Object.fromEntries(Object.keys(features).map(feature => [feature, { read: true, write: false }])) as typeof permissions.features,
  } };
  const writes = tools.filter(({ group, name }) => [...group.writeTools ?? []].includes(name));

  it('lists no write tools for an otherwise fully privileged admin key', async () => {
    const names = (await rpc(readonly, 'tools/list')).result.tools.map((tool: { name: string }) => tool.name);
    expect(names.length).toBeGreaterThan(30);
    for (const { name } of writes) expect(names).not.toContain(name);
  });

  it.each(writes)('refuses $name on direct call despite supplied confirmation', async ({ name }) => {
    const result = await rpc(readonly, 'tools/call', { name, arguments: { confirmation: 'CONFIRMED' } });
    expect(result.result?.structuredContent?.code).toBe('forbidden');
    expect(state.execute).not.toHaveBeenCalled();
    expect(state.purge).not.toHaveBeenCalled();
  });

  it.each(resources)('refuses $resource.uri after read permission is removed', async ({ resource }) => {
    if (resource.feature === null) return;
    const denied: McpViewer = { ...viewer, resourceRestricted: false, permissions: { ...permissions, features: {
      ...permissions.features, [resource.feature]: { read: false, write: false },
    } } };
    const response = await rpc(denied, 'resources/read', { uri: resource.uri });
    expect(response.error, resource.uri).toBeDefined();
    expect(state.execute).not.toHaveBeenCalled();
  });

  it.each(resources)('refuses $resource.uri after its entitlement is removed', async ({ resource }) => {
    if (resource.feature === null) return;
    const denied: McpViewer = { ...viewer, resourceRestricted: false, entitlements: {
      ...viewer.entitlements, features: { ...features, [resource.feature]: false },
    } };
    const response = await rpc(denied, 'resources/read', { uri: resource.uri });
    expect(response.error, resource.uri).toBeDefined();
    expect(state.execute).not.toHaveBeenCalled();
  });

  it.each(resources.filter(({ resource }) => resource.managerOnly))('refuses manager-only $resource.uri on direct read by an otherwise authorized member', async ({ resource }) => {
    const denied = { ...viewer, role: 'editor', resourceRestricted: false };
    expect((await rpc(denied, 'resources/read', { uri: resource.uri })).error).toBeDefined();
    expect(state.execute).not.toHaveBeenCalled();
  });
});
