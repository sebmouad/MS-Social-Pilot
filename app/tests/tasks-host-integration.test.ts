import { OperationError } from '@/lib/operation-error';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const guard = vi.hoisted(() => ({ purging: vi.fn(), operation: vi.fn() }));
vi.mock('../src/server/data-control/guard', () => ({ assertWorkspaceNotPurging: guard.purging, withWorkspaceOperation: guard.operation }));
vi.mock('../src/server/data', () => ({ prisma: { $executeRaw: vi.fn().mockResolvedValue(1), user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() } } }));
vi.mock('../src/server/config/store', () => ({ readConfig: vi.fn(), saveConfig: vi.fn(), runtimeConfig: vi.fn(async (key: string) => key === 'mcp.maxResultItems' ? 100 : undefined) }));
const tasksService = vi.hoisted(() => ({ listTasks: vi.fn(), getTask: vi.fn(), listTaskPostChoices: vi.fn(), performTaskAction: vi.fn() }));
vi.mock('../src/modules/tasks/server/tasks', () => tasksService);

import { handleMcpMessage, type McpViewer } from '../src/server/mcp/server';
import { PAGES, MODULES } from '../src/lib/product';
import { CONFIG_BY_KEY, CONFIG_REGISTRY } from '../src/lib/config/registry';
import { configurationOwner } from '../src/lib/config/ownership';
import { canUseFeature, canUseModule, resolveEntitlements } from '../src/server/entitlements';
import { canAccessFeature, canAccessModule, resolvePermissions, type PermissionSource } from '../src/server/permissions';
import { tasksManifest } from '../src/modules/tasks/manifest';
import { TASKS_CONFIG } from '../src/modules/tasks/config';
import { tasksToolDefinitions, tasksTools, tasksWriteTools } from '../src/modules/tasks/mcp';
import { TASKS_FEATURE_ID, TASKS_TOOL_ACCESS } from '../src/modules/tasks/semantics';

const permissionSource = (role: string, overrides: Partial<PermissionSource> = {}): PermissionSource => ({
  role, workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [], allPages: true, pageAccess: [], ...overrides,
});
const entitlementSource = { workspace: { id: 'workspace-a', disabledModules: [] as string[] }, membership: { userId: 'user-a', disabledModules: [] as string[] }, planFeatures: null };

describe('Tasks catalog and Root ownership', () => {
  it('installs the manifest in the shared catalog with its navigation entry', () => {
    expect(MODULES.map(({ id }) => id)).toContain('tasks');
    expect(PAGES.find(({ id }) => id === TASKS_FEATURE_ID)).toMatchObject({ module: 'tasks', href: '/tasks' });
    expect(MODULES.find(({ id }) => id === 'tasks')?.href).toBe('/tasks');
  });

  it('registers every Tasks setting as active, Root-owned by the tasks module, with defaults that validate', () => {
    expect(TASKS_CONFIG.length).toBeGreaterThan(0);
    for (const setting of TASKS_CONFIG) {
      const registered = CONFIG_BY_KEY.get(setting.key);
      expect(registered, setting.key).toBeDefined();
      expect(registered!.consumption).toBe('active');
      expect(registered!.schema.safeParse(registered!.defaultValue).success, setting.key).toBe(true);
      expect(configurationOwner(setting.key)).toEqual({ kind: 'product', id: 'tasks' });
    }
    expect(CONFIG_REGISTRY.filter(({ key }) => key.startsWith('tasks.')).map(({ key }) => key).sort()).toEqual(TASKS_CONFIG.map(({ key }) => key).sort());
    expect(tasksManifest.rootSettingsPrefixes).toEqual(['tasks.']);
  });

  it('assigns installation availability switches to the Tasks module, not shared controls', () => {
    expect(configurationOwner('entitlements.modules.tasks')).toEqual({ kind: 'product', id: 'tasks' });
    expect(configurationOwner(`entitlements.features.${TASKS_FEATURE_ID}`)).toEqual({ kind: 'product', id: 'tasks' });
  });
});

describe('Tasks entitlements and permissions', () => {
  it('is available by default and removable only through the installation module or feature switch', () => {
    expect(canUseModule(resolveEntitlements(entitlementSource), 'tasks')).toBe(true);
    expect(canUseFeature(resolveEntitlements(entitlementSource), TASKS_FEATURE_ID)).toBe(true);
    expect(canUseFeature(resolveEntitlements({ ...entitlementSource, installationAvailability: { 'entitlements.modules.tasks': false } }), TASKS_FEATURE_ID)).toBe(false);
    expect(canUseModule(resolveEntitlements({ ...entitlementSource, installationAvailability: { 'entitlements.modules.tasks': false } }), 'tasks')).toBe(false);
    expect(canUseFeature(resolveEntitlements({ ...entitlementSource, installationAvailability: { [`entitlements.features.${TASKS_FEATURE_ID}`]: false } }), TASKS_FEATURE_ID)).toBe(false);
    // Root's workspace and member module switches carry a supported `tasks` token like the other product modules.
    expect(canUseFeature(resolveEntitlements({ ...entitlementSource, workspace: { ...entitlementSource.workspace, disabledModules: ['tasks'] } }), TASKS_FEATURE_ID)).toBe(false);
    expect(canUseModule(resolveEntitlements({ ...entitlementSource, membership: { ...entitlementSource.membership, disabledModules: ['tasks'] } }), 'tasks')).toBe(false);
    expect(canAccessFeature(resolvePermissions(permissionSource('owner', { workspaceDisabledModules: ['tasks'] })), TASKS_FEATURE_ID, 'read')).toBe(false);
    expect(canAccessFeature(resolvePermissions(permissionSource('editor', { memberDisabledModules: ['tasks'] })), TASKS_FEATURE_ID, 'write')).toBe(false);
  });

  it('is not tied to a plan switch and is denied to everyone in a suspended workspace', () => {
    expect(canUseFeature(resolveEntitlements({ ...entitlementSource, planFeatures: ['product_v2', 'posts'] }), TASKS_FEATURE_ID)).toBe(true);
    expect(canUseModule(resolveEntitlements({ ...entitlementSource, workspace: { ...entitlementSource.workspace, suspendedAt: new Date() } }), 'tasks')).toBe(false);
  });

  it('grants roles the documented read/write access and keeps clients out', () => {
    const access = (role: string, action: 'read' | 'write') => canAccessFeature(resolvePermissions(permissionSource(role)), TASKS_FEATURE_ID, action);
    for (const role of ['owner', 'admin', 'editor', 'contributor']) {
      expect([role, access(role, 'read')]).toEqual([role, true]);
      expect([role, access(role, 'write')]).toEqual([role, true]);
    }
    expect(access('viewer', 'read')).toBe(true);
    expect(access('viewer', 'write')).toBe(false);
    expect(access('client', 'read')).toBe(false);
    expect(access('client', 'write')).toBe(false);
    expect(access('mystery', 'read')).toBe(false);
    expect(canAccessModule(resolvePermissions(permissionSource('client')), 'tasks')).toBe(false);
  });

  it('does not widen other modules through the Tasks exception', () => {
    const owner = resolvePermissions(permissionSource('owner', { memberDisabledModules: ['publishing/posts'] }));
    expect(canAccessFeature(owner, TASKS_FEATURE_ID, 'write')).toBe(true);
    expect(canAccessFeature(owner, 'publishing/posts', 'read')).toBe(false);
    // Contributors still cannot reach the team, workspace or MCP settings through the Tasks exception.
    const contributor = resolvePermissions(permissionSource('contributor'));
    expect(canAccessFeature(contributor, 'settings/team', 'read')).toBe(false);
    expect(canAccessFeature(contributor, 'settings/mcp', 'write')).toBe(false);
  });
});

const viewerFor = (overrides: Partial<McpViewer> = {}, source: Partial<PermissionSource> = {}, role = 'owner'): McpViewer => ({
  scope: 'workspace', userId: 'user-a', workspaceId: 'workspace-a', role,
  workspace: { id: 'workspace-a', name: 'Alpha', timezone: 'UTC' },
  entitlements: resolveEntitlements(entitlementSource),
  permissions: resolvePermissions(permissionSource(role, source)),
  ...overrides,
});
const rpc = (viewer: McpViewer, method: string, params: Record<string, unknown> = {}) => handleMcpMessage(viewer, { jsonrpc: '2.0', id: 1, method, params });
const body = async (response: Response) => response.json() as Promise<{ result?: any; error?: { message: string } }>;
const listed = async (viewer: McpViewer) => ((await body(await rpc(viewer, 'tools/list'))).result.tools as { name: string }[]).map(tool => tool.name);

describe('Tasks MCP host wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.operation.mockImplementation((_id: string, run: () => Promise<unknown>) => run());
    guard.purging.mockResolvedValue(undefined);
    tasksService.listTasks.mockResolvedValue({ tasks: [], hasMore: false });
    tasksService.performTaskAction.mockResolvedValue({ ok: true });
  });

  it('keeps definitions, access map and write set consistent', () => {
    expect(tasksToolDefinitions.map(({ name }) => name).sort()).toEqual(Object.keys(TASKS_TOOL_ACCESS).sort());
    expect([...tasksTools].sort()).toEqual(Object.keys(TASKS_TOOL_ACCESS).sort());
    expect([...tasksWriteTools].sort()).toEqual(['add_task_checklist_item', 'add_task_comment', 'create_task', 'create_task_checklist', 'delete_task', 'delete_task_checklist_item', 'delete_task_comment', 'move_task', 'set_task_checklist_item', 'update_task']);
  });

  it('advertises read and write tools to a writer, only read tools to a viewer, and none to a client or disabled module', async () => {
    expect(await listed(viewerFor())).toEqual(expect.arrayContaining([...tasksTools]));
    const viewerRole = await listed(viewerFor({}, {}, 'viewer'));
    expect(viewerRole).toEqual(expect.arrayContaining(['list_tasks', 'get_task', 'list_task_post_choices']));
    for (const name of tasksWriteTools) expect(viewerRole).not.toContain(name);
    for (const role of ['client']) for (const name of tasksTools) expect(await listed(viewerFor({}, {}, role))).not.toContain(name);
    const disabled = viewerFor({ entitlements: resolveEntitlements({ ...entitlementSource, installationAvailability: { 'entitlements.modules.tasks': false } }) });
    for (const name of tasksTools) expect(await listed(disabled)).not.toContain(name);
  });

  it('applies a key feature ceiling: a read-only key sees reads only and a key without Tasks sees nothing', async () => {
    const readOnly = viewerFor();
    const permissions = resolvePermissions(permissionSource('owner'));
    const restricted = (read: boolean, write: boolean) => ({ ...permissions, features: { ...permissions.features, [TASKS_FEATURE_ID]: { read, write } } });
    const readKey = { ...readOnly, apiKeyId: 'key-1', permissions: restricted(true, false) };
    const names = await listed(readKey);
    expect(names).toContain('list_tasks');
    expect(names).not.toContain('create_task');
    const none = await listed({ ...readOnly, apiKeyId: 'key-2', permissions: restricted(false, false) });
    for (const name of tasksTools) expect(none).not.toContain(name);
  });

  it('dispatches reads with the key channel ceiling and the result cap, without the workspace operation lock', async () => {
    const viewer = viewerFor({ maxResultItems: 7 }, { allPages: false, pageAccess: [{ targetId: 'channel-1' }] }, 'editor');
    const response = await body(await rpc(viewer, 'tools/call', { name: 'list_tasks', arguments: { status: 'todo' } }));
    expect(response.result.isError).toBeUndefined();
    expect(tasksService.listTasks).toHaveBeenCalledWith(
      { userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: ['channel-1'], permissionCeiling: viewer.permissions },
      { status: 'todo' },
      { maxItems: 7 },
    );
    expect(guard.operation).not.toHaveBeenCalled();
  });

  it('serializes writes through the purge guard and workspace lock and requires the exact confirmation', async () => {
    const viewer = viewerFor();
    tasksService.performTaskAction.mockRejectedValueOnce(new OperationError('invalid_request', 'Type the exact confirmation text to continue.'));
    const refused = await body(await rpc(viewer, 'tools/call', { name: 'create_task', arguments: { title: 'Plan', confirmation: 'yes' } }));
    expect(refused.result.isError).toBe(true);
    expect(tasksService.performTaskAction).toHaveBeenCalledWith(expect.anything(), { action: 'task.create', title: 'Plan', confirmation: 'yes' });
    const accepted = await body(await rpc(viewer, 'tools/call', { name: 'create_task', arguments: { title: 'Plan', confirmation: 'CREATE TASK Plan' } }));
    expect(accepted.result.isError).toBeUndefined();
    expect(guard.purging).toHaveBeenCalledWith('workspace-a');
    // The Tasks service owns its single workspace/purge/actor transaction; the MCP host must not open a second one.
    expect(guard.operation).not.toHaveBeenCalled();
    expect(tasksService.performTaskAction).toHaveBeenCalledWith(
      { userId: 'user-a', workspaceId: 'workspace-a', allowedTargetIds: undefined, permissionCeiling: viewer.permissions },
      expect.objectContaining({ action: 'task.create', title: 'Plan', confirmation: 'CREATE TASK Plan' }),
    );
  });

  it('refuses a write without write permission before reaching the service', async () => {
    const viewer = viewerFor({}, {}, 'viewer');
    const response = await body(await rpc(viewer, 'tools/call', { name: 'delete_task', arguments: { id: 'task-1', confirmation: 'DELETE TASK task-1' } }));
    expect(response.result.isError).toBe(true);
    expect(tasksService.performTaskAction).not.toHaveBeenCalled();
  });

  it('does not run Tasks tools for an installation-scope identity', async () => {
    const response = await body(await handleMcpMessage({ scope: 'installation', userId: 'owner', isInstanceOwner: true }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tasks', arguments: {} } }));
    expect(response.result?.isError).toBe(true);
    expect(tasksService.listTasks).not.toHaveBeenCalled();
  });

  it('lists and reads the Tasks resource only when the feature is available', async () => {
    const viewer = viewerFor();
    const resources = (await body(await rpc(viewer, 'resources/list'))).result.resources as { uri: string }[];
    expect(resources.map(({ uri }) => uri)).toContain('msp://tasks');
    const read = await body(await rpc(viewer, 'resources/read', { uri: 'msp://tasks' }));
    expect(read.result.contents[0].uri).toBe('msp://tasks');
    expect(tasksService.listTasks).toHaveBeenCalledTimes(1);

    const noTasks = viewerFor({ entitlements: resolveEntitlements({ ...entitlementSource, installationAvailability: { 'entitlements.modules.tasks': false } }) });
    const hidden = (await body(await rpc(noTasks, 'resources/list'))).result.resources as { uri: string }[];
    expect(hidden.map(({ uri }) => uri)).not.toContain('msp://tasks');
  });
});
