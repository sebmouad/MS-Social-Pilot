import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Only persistence, current-access loading, request context and lock scheduling are
// faked. Installed declarations, bearer narrowing, host, module executors, Tasks
// authorization/validation/SQL/audit and REST handlers all execute unchanged.
// This is in-process execution evidence, not PostgreSQL or live MCP evidence.
const fixture = vi.hoisted(() => ({
  query: vi.fn(), execute: vi.fn(), transaction: vi.fn(), user: vi.fn(),
  workspaces: vi.fn(), permissions: vi.fn(), entitlements: vi.fn(), config: vi.fn(),
  posts: vi.fn(), targets: vi.fn(), context: vi.fn(),
  role: 'owner', member: true, uuid: 0, auditCount: 1,
  key: {} as Record<string, unknown>,
}));
vi.mock('node:crypto', async original => ({
  ...await original<typeof import('node:crypto')>(),
  randomUUID: () => `00000000-0000-4000-8000-${String(++fixture.uuid).padStart(12, '0')}`,
}));
vi.mock('@/server/data', () => ({
  prisma: {
    $queryRaw: fixture.query, $executeRaw: fixture.execute, $transaction: fixture.transaction,
    user: { findUnique: fixture.user }, post: { findMany: fixture.posts }, target: { findMany: fixture.targets },
  }, listWorkspaces: fixture.workspaces,
}));
vi.mock('@/server/config/store', () => ({ runtimeConfig: fixture.config }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: fixture.permissions }));
vi.mock('@/server/entitlements', async original => ({
  ...await original<typeof import('@/server/entitlements')>(), loadEntitlements: fixture.entitlements,
}));
vi.mock('@/server/data-control/guard', () => ({
  assertWorkspaceNotPurging: vi.fn(),
  withWorkspaceOperation: async (_workspaceId: string, run: () => Promise<unknown>) => run(),
}));
vi.mock('@/server/context', () => ({ requireViewer: fixture.context }));
vi.mock('@/server/request-origin', () => ({ requestOrigin: () => 'https://example.test' }));

import { CONFIG_BY_KEY } from '@/lib/config/registry';
import { MODULES, PAGES } from '@/lib/product';
import { installedMcpGroups } from '@/modules/installed-mcp';
import { authenticateBearerHeader } from '@/server/mcp/bearer';
import { handleMcpMessage } from '@/server/mcp/server';
import type { McpViewer } from '@/server/mcp/types';
import { resolvePermissions } from '@/server/permissions';
import type { Entitlements } from '@/server/entitlements';
import { getTask, listTaskPostChoices, listTasks, performTaskAction } from '@/modules/tasks/server/tasks';
import { GET, POST } from '@/app/api/tasks/route';

const token = `mcp_${'synthetic'.repeat(6)}`;
const authorization = `Bearer ${token}`;
const featureIds = PAGES.map(page => page.id);
const groups = installedMcpGroups();
const inventory = groups.flatMap(group => group.tools.map(tool => ({ group, name: tool.name })));
const writes = inventory.filter(({ group, name }) => [...group.writeTools ?? []].includes(name));
const workspaceTools = inventory.filter(({ group, name }) => group.scope.workspaceTools?.includes(name));
const entitlements: Entitlements = {
  workspaceId: 'workspace-a',
  modules: Object.fromEntries(MODULES.map(module => [module.id, true])) as Entitlements['modules'],
  features: Object.fromEntries(featureIds.map(id => [id, true])) as Entitlements['features'],
  platformCapabilities: {},
};
const permissions = (role = fixture.role) => resolvePermissions({
  role, allPages: true, pageAccess: [], workspaceDisabledModules: [], memberDisabledModules: [], clientAccess: [],
});
const sql = (query: unknown) => (query as { sql?: string; strings?: readonly string[] }).sql
  ?? (query as { strings?: readonly string[] }).strings?.join('?')
  ?? (Array.isArray(query) ? query.join('?') : '');
const values = (query: unknown, rest: unknown[]) => Array.isArray(query) ? rest : (query as { values?: unknown[] }).values ?? rest;
const task = {
  id: 'task-a', title: 'Prepare launch', notes: null, status: 'todo', assigneeId: null,
  dueOn: null, postId: null, createdById: 'user-a', createdByName: 'Example owner',
  commentCount: 0, createdAt: new Date('2026-10-20T12:00:00Z'), updatedAt: new Date('2026-10-20T12:00:00Z'),
};
const rpc = async (viewer: McpViewer, name: string, args: unknown = {}) => {
  const response = await handleMcpMessage(viewer, {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args },
  });
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body.error).toBeUndefined();
  expect(JSON.parse(body.result.content[0].text)).toEqual(body.result.structuredContent);
  return body.result;
};
async function key(role = 'owner', mode: 'all' | 'selected' | 'readonly' = 'all') {
  fixture.role = role;
  fixture.key = {
    id: 'key-a', workspaceId: 'workspace-a', createdById: 'user-a', readFeatures: featureIds,
    writeFeatures: mode === 'readonly' ? [] : featureIds,
    resourceScope: mode === 'selected'
      ? { version: 1, mode: 'selected', ids: ['channel-a'], adAccountIds: [] }
      : { version: 1, mode: 'all' },
  };
  const viewer = await authenticateBearerHeader(authorization);
  expect(viewer).not.toBeNull();
  // Authentication updates lastUsedAt; mutation assertions start after that write.
  fixture.execute.mockClear();
  fixture.query.mockClear();
  return viewer!;
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.member = true; fixture.role = 'owner'; fixture.uuid = 0; fixture.auditCount = 1;
  fixture.config.mockImplementation(async (name: string) => {
    if (name === 'mcp.enabled') return true;
    if (name === 'mcp.authenticatedRoles') return ['owner', 'editor', 'viewer'];
    if (name === 'mcp.maxResultItems' || name === 'tasks.pageLimit') return 2;
    const entry = CONFIG_BY_KEY.get(name);
    if (!entry) throw new Error(`Unconfigured test dependency: ${name}`);
    return entry.defaultValue;
  });
  fixture.user.mockResolvedValue({ id: 'user-a', disabledAt: null });
  fixture.workspaces.mockImplementation(async () => fixture.member ? [{
    role: fixture.role, workspace: { id: 'workspace-a', name: 'Example studio', timezone: 'UTC' },
  }] : []);
  fixture.permissions.mockImplementation(async () => permissions());
  fixture.entitlements.mockResolvedValue(entitlements);
  fixture.context.mockImplementation(async () => ({ user: { id: 'user-a' }, workspaceId: 'workspace-a' }));
  fixture.targets.mockResolvedValue([]);
  fixture.posts.mockResolvedValue([
    { id: 'post-draft', message: 'Prepare the autumn launch', status: 'draft' },
    { id: 'post-scheduled', message: 'Announce the studio collection', status: 'scheduled' },
    { id: 'post-published', message: 'Meet the studio team', status: 'published' },
  ]);
  fixture.query.mockImplementation(async (query: unknown, ...rest: unknown[]) => {
    const text = sql(query); const bound = values(query, rest);
    if (text.includes('FROM mcp_api_keys')) return [fixture.key];
    if (text.includes('FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w')) {
      return fixture.member && bound.includes('workspace-a') && bound.includes('user-a')
        ? [{ role: fixture.role, timezone: 'UTC', suspendedAt: null, allPages: true }] : [];
    }
    if (text.includes('FROM workspace_data_purges')) return [];
    if (text.includes('SELECT u.id, u.name')) return [{ id: 'user-a', name: 'Example owner' }];
    if (text.includes('GROUP BY t.status')) return [{ status: 'todo', total: 3, overdue: 0 }];
    if (text.includes('FROM tasks t LEFT JOIN')) return bound.includes('foreign-task') ? []
      : bound.includes('task-a') ? [task] : [task, { ...task, id: 'task-b', title: 'Review collection photos' }, { ...task, id: 'task-c', title: 'Approve launch calendar' }];
    if (text.includes('FROM task_comments c LEFT JOIN')) return [];
    if (text.includes('FROM task_comments WHERE id')) return bound.includes('foreign-comment') ? [] : [{ taskId: 'task-a', authorId: 'user-a' }];
    if (text.includes('FROM tasks WHERE id')) return bound.includes('foreign-task') ? [] : [task];
    throw new Error(`Unhandled synthetic query: ${text}`);
  });
  fixture.execute.mockImplementation(async (query: unknown) => {
    if (sql(query).includes('INSERT INTO activity_logs')) return fixture.auditCount;
    if (sql(query).includes('FROM unnest')) return 2;
    return 1;
  });
  fixture.transaction.mockImplementation(async run => run({ $queryRaw: fixture.query, $executeRaw: fixture.execute, post: { findMany: fixture.posts } }));
});

describe('real bearer and installed host refusal matrix (no mocked module executors)', () => {
  it('hashes the synthetic token and intersects selected resources with current permissions', async () => {
    const viewer = await key('editor', 'selected');
    expect(viewer).toMatchObject({ role: 'editor', apiKeyId: 'key-a', resourceRestricted: true, allowedAdAccountIds: [], permissions: { pageScope: { all: false, ids: ['channel-a'] } } });
    await authenticateBearerHeader(authorization);
    expect(fixture.query.mock.calls.some(([query, ...rest]) => values(query, rest).includes(createHash('sha256').update(token).digest('hex')))).toBe(true);
    fixture.member = false;
    expect(await authenticateBearerHeader(authorization)).toBeNull();
  });

  it.each(inventory)('$name | owner | rejects malformed arguments without domain writes', async ({ name }) => {
    const result = await rpc(await key(), name, []);
    expect(result.isError).toBe(true);
    expect(['invalid_request', 'forbidden']).toContain(result.structuredContent.code);
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it.each(workspaceTools)('$name | limited editor | refuses workspace-wide operation', async ({ name }) => {
    const result = await rpc(await key('editor', 'selected'), name, { confirmation: 'CONFIRMED' });
    expect(result).toMatchObject({ isError: true, structuredContent: { code: 'forbidden' } });
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it.each(writes)('$name | read-only owner | refuses direct write with supplied confirmation', async ({ name }) => {
    const result = await rpc(await key('owner', 'readonly'), name, { confirmation: 'CONFIRMED' });
    expect(result).toMatchObject({ isError: true, structuredContent: { code: 'forbidden' } });
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it.each(inventory)('$name | viewer without feature grants | refuses direct call', async ({ name }) => {
    const viewer = await key('viewer', 'readonly');
    fixture.key.readFeatures = [];
    const denied = await authenticateBearerHeader(authorization);
    expect(denied?.userId).toBe(viewer.userId);
    fixture.execute.mockClear();
    const result = await rpc(denied!, name);
    expect(result).toMatchObject({ isError: true, structuredContent: { code: 'forbidden' } });
    expect(fixture.execute).not.toHaveBeenCalled();
  });
});

const actions = [
  { name: 'create_task', action: 'task.create', args: { title: 'Launch' }, confirmation: 'CREATE TASK Launch', audit: 'tasks.created' },
  { name: 'create_task_checklist', action: 'task.createMany', args: { titles: ['Draft', 'Review'] }, confirmation: 'CREATE 2 TASKS', audit: 'tasks.created_many' },
  { name: 'update_task', action: 'task.update', args: { id: 'task-a', title: 'Updated launch' }, confirmation: 'UPDATE TASK task-a', audit: 'tasks.updated' },
  { name: 'move_task', action: 'task.transition', args: { id: 'task-a', status: 'doing' }, confirmation: 'MOVE TASK task-a TO doing', audit: 'tasks.status_changed' },
  { name: 'delete_task', action: 'task.delete', args: { id: 'task-a' }, confirmation: 'DELETE TASK task-a', audit: 'tasks.deleted' },
  { name: 'add_task_comment', action: 'comment.add', args: { taskId: 'task-a', body: 'Synthetic private comment' }, confirmation: 'COMMENT ON TASK task-a', audit: 'tasks.comment_added' },
  { name: 'delete_task_comment', action: 'comment.delete', args: { id: 'comment-a' }, confirmation: 'DELETE TASK COMMENT comment-a', audit: 'tasks.comment_deleted' },
];
const actorFor = (viewer: McpViewer) => ({ userId: viewer.userId, workspaceId: viewer.workspaceId, permissionCeiling: viewer.permissions });
const auditCalls = () => fixture.execute.mock.calls.filter(([query]) => sql(query).includes('INSERT INTO activity_logs'));

describe('Tasks real host → module → shared UI/REST service → synthetic persistence', () => {
  it.each(['owner', 'viewer'])('list_tasks | %s | equals REST and shared screen service result', async role => {
    const viewer = await key(role, role === 'viewer' ? 'readonly' : 'all');
    const result = await rpc(viewer, 'list_tasks');
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(await listTasks(actorFor(viewer), {}, { maxItems: 2 }));
    expect(result.structuredContent).toEqual(await (await GET(new Request('https://example.test/api/tasks'))).json());
    expect(result.structuredContent.tasks[0].canEdit).toBe(role === 'owner');
    expect(result.structuredContent.tasks).toHaveLength(2);
    expect(result.structuredContent.hasMore).toBe(true);
  });

  it('get_task and list_task_post_choices | owner | equal shared service output', async () => {
    const viewer = await key();
    expect((await rpc(viewer, 'get_task', { id: 'task-a' })).structuredContent)
      .toEqual(await getTask(actorFor(viewer), 'task-a', { maxItems: 2 }));
    const choices = (await rpc(viewer, 'list_task_post_choices')).structuredContent;
    expect(choices).toEqual(await listTaskPostChoices(actorFor(viewer), {}, { maxItems: 2 }));
    expect(choices.posts).toHaveLength(2);
    expect(choices.hasMore).toBe(true);
  });

  it.each(actions)('$name | owner | exact confirmation, REST/service equality, scoped audit', async test => {
    const viewer = await key();
    for (const confirmation of [undefined, 'CONFIRMED', `${test.confirmation} `, `${test.confirmation} other`]) {
      const invalidArgs = { ...test.args, ...(confirmation === undefined ? {} : { confirmation }) };
      const result = await rpc(viewer, test.name, invalidArgs);
      expect(result).toMatchObject({ isError: true, structuredContent: { code: 'invalid_request' } });
      await expect(performTaskAction(actorFor(viewer), { ...invalidArgs, action: test.action }))
        .rejects.toMatchObject({ code: 'invalid_request', message: result.structuredContent.error });
      const rest = await POST(new Request('https://example.test/api/tasks', {
        method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' },
        body: JSON.stringify({ ...invalidArgs, action: test.action }),
      }));
      expect(rest.status).toBe(400);
      expect(await rest.json()).toEqual(result.structuredContent);
      expect(fixture.execute).not.toHaveBeenCalled();
    }
    const args = { ...test.args, confirmation: test.confirmation };
    const result = await rpc(viewer, test.name, args);
    expect(result.isError).toBeUndefined();
    const audits = auditCalls();
    expect(audits).toHaveLength(1);
    expect(values(audits[0][0], audits[0].slice(1))).toEqual(expect.arrayContaining(['workspace-a', 'user-a', test.audit]));
    expect(JSON.stringify(audits)).not.toContain('Synthetic private comment');
    fixture.uuid = 0;
    expect(result.structuredContent).toEqual(await performTaskAction(actorFor(viewer), { ...args, action: test.action }, { maxItems: 2 }));
    fixture.uuid = 0;
    const rest = await POST(new Request('https://example.test/api/tasks', {
      method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' },
      body: JSON.stringify({ ...args, action: test.action }),
    }));
    expect(rest.status).toBe(200);
    expect(await rest.json()).toEqual(result.structuredContent);
  });

  it.each(actions)('$name | viewer | real supplied confirmation never reaches persistence', async test => {
    const result = await rpc(await key('viewer', 'readonly'), test.name, { ...test.args, confirmation: test.confirmation });
    expect(result).toMatchObject({ isError: true, structuredContent: { code: 'forbidden' } });
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it('list_task_post_choices | limited editor | keeps key resource ceiling in the Publishing query', async () => {
    const viewer = await key('editor', 'selected');
    expect((await rpc(viewer, 'list_task_post_choices')).isError).toBeUndefined();
    expect(fixture.targets).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: 'workspace-a', id: { in: ['channel-a'] } }) }));
    expect(fixture.posts).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ workspaceId: 'workspace-a' })]) }) }));
  });

  it.each([
    { name: 'get_task', args: { id: 'foreign-task' } },
    { name: 'update_task', args: { id: 'foreign-task', title: 'Changed', confirmation: 'UPDATE TASK foreign-task' } },
    { name: 'delete_task_comment', args: { id: 'foreign-comment', confirmation: 'DELETE TASK COMMENT foreign-comment' } },
  ])('$name | owner | foreign workspace record is unavailable and unaudited', async test => {
    const result = await rpc(await key(), test.name, test.args);
    expect(result).toMatchObject({ isError: true, structuredContent: { code: 'not_found' } });
    expect(fixture.execute).not.toHaveBeenCalled();
    const recordQueries = fixture.query.mock.calls.filter(([query]) => /FROM tasks|FROM task_comments/.test(sql(query)));
    expect(recordQueries.length).toBeGreaterThan(0);
    for (const [query, ...rest] of recordQueries) {
      expect(sql(query)).toContain('"workspaceId" =');
      expect(values(query, rest)).toContain('workspace-a');
    }
  });

  it('create_task | stale owner | repeats current membership check before writing', async () => {
    const viewer = await key();
    fixture.member = false;
    expect(await rpc(viewer, 'create_task', { title: 'Launch', confirmation: 'CREATE TASK Launch' }))
      .toMatchObject({ isError: true, structuredContent: { code: 'forbidden' } });
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it('create_task | owner demoted during transaction | locked role check wins', async () => {
    const viewer = await key();
    fixture.transaction.mockImplementation(async run => {
      fixture.role = 'viewer';
      return run({ $queryRaw: fixture.query, $executeRaw: fixture.execute });
    });
    expect(await rpc(viewer, 'create_task', { title: 'Launch', confirmation: 'CREATE TASK Launch' }))
      .toMatchObject({ isError: true, structuredContent: { code: 'forbidden' } });
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(fixture.query.mock.calls.some(([query]) => sql(query).includes('FOR SHARE OF m, u, w'))).toBe(true);
  });

  it('create_task_checklist | owner | refuses a batch above the real bearer result ceiling whole', async () => {
    expect(await rpc(await key(), 'create_task_checklist', {
      titles: ['Draft', 'Review', 'Approve'], confirmation: 'CREATE 3 TASKS',
    })).toMatchObject({ isError: true, structuredContent: { code: 'invalid_request' } });
    expect(fixture.execute).not.toHaveBeenCalled();
  });

  it('create_task | owner | failed audit never returns success', async () => {
    const viewer = await key(); fixture.auditCount = 0;
    expect(await rpc(viewer, 'create_task', { title: 'Launch', confirmation: 'CREATE TASK Launch' }))
      .toMatchObject({ isError: true, structuredContent: { code: 'unavailable' } });
    expect(auditCalls()).toHaveLength(1);
    // Rollback/atomicity require PostgreSQL; the synthetic transaction does not prove them.
  });

  it('list_tasks | owner | hides raw database credentials and SQL from failures', async () => {
    const viewer = await key();
    fixture.query.mockRejectedValueOnce(new Error('postgres://secret-password@host SELECT private_customer access_token=secret-token'));
    const result = await rpc(viewer, 'list_tasks');
    expect(result).toMatchObject({ isError: true, structuredContent: { code: 'upstream_failure' } });
    expect(JSON.stringify(result)).not.toMatch(/secret-password|private_customer|secret-token|postgres:/);
  });
});
