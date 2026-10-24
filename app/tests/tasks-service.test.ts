import { customerCopy } from '@/modules/tasks/ui/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: { $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(), post: { findMany: vi.fn() } },
  config: vi.fn(), workspace: vi.fn(), purging: vi.fn(), permissions: vi.fn(), entitlements: vi.fn(),
  resolve: vi.fn(), canModule: vi.fn(), canFeature: vi.fn(), canAccess: vi.fn(), selected: vi.fn(), visibility: vi.fn(),
}));
vi.mock('../src/server/data', () => ({ prisma: mocks.prisma }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: mocks.config }));
vi.mock('../src/server/data-control/guard', () => ({ withWorkspaceOperation: mocks.workspace, assertWorkspaceNotPurging: mocks.purging }));
vi.mock('../src/server/permissions/loader', () => ({ loadPermissions: mocks.permissions }));
vi.mock('../src/server/permissions', () => ({ canAccessFeature: mocks.canAccess, resolvePermissions: mocks.resolve }));
vi.mock('../src/server/entitlements', () => ({ loadEntitlements: mocks.entitlements, canUseModule: mocks.canModule, canUseFeature: mocks.canFeature }));
vi.mock('../src/modules/publishing/server/read-scope', () => ({ selectedPublishingTargetIds: mocks.selected, publishingPostVisibilityWhere: mocks.visibility }));

import { getTask, listTaskPostChoices, listTasks, performTaskAction } from '../src/modules/tasks/server/tasks';
import { effectiveTargetIds } from '../src/modules/tasks/server/access';
import { TASK_TRANSITIONS, taskConfirmations } from '../src/modules/tasks/tasks';
import { tasksToolDefinitions, tasksWriteTools, executeTasksTool } from '../src/modules/tasks/mcp';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const caps: Record<string, number> = {
  'tasks.titleMaxCharacters': 20, 'tasks.notesMaxCharacters': 50, 'tasks.commentMaxCharacters': 30, 'tasks.pageLimit': 2,
  'tasks.commentHistoryLimit': 50, 'tasks.assigneeLimit': 10, 'tasks.postChoiceLimit': 2, 'tasks.workflowRowLimit': 3, 'tasks.workflowGapMaxDays': 7,
  'tasks.transactionTimeoutMs': 5000, 'tasks.transactionMaxWaitMs': 500, 'tasks.checklistLimit': 3, 'tasks.checklistItemMaxCharacters': 40,
};
const sqlText = (query: unknown) => typeof query === 'string' ? query : (query as { sql?: string; strings?: string[] })?.sql ?? (query as { strings?: string[] })?.strings?.join('?') ?? (query as string[])?.join('?') ?? '';
const valuesOf = (query: unknown): unknown[] => (query as { values?: unknown[] })?.values ?? [];
let role: string | null = 'editor'; let suspended: Date | null = null; let taskRow: Record<string, unknown> | null = null; let taskRows: Record<string, unknown>[] = [];
let assignable = true; let postFound = true; let commentRow: Record<string, unknown> | null = null; let auditCount = 1; let scope: { all: boolean; ids: string[] } = { all: true, ids: [] };
let itemRow: Record<string, unknown> | null = null; let itemRows: Record<string, unknown>[] = []; let checklistRows: Record<string, unknown>[] = []; let checklistTotal = 0; let hiddenUnlinked = 0;
let purgeStatus: string | null = null;
let freshWrite = true; let moduleOn = true; let featureOn = true; let access = { read: true, write: true }; let commentRows: Record<string, unknown>[] = [];
const audits: string[] = []; const writes: Array<{ sql: string; values: unknown[] }> = [];
const updatedAt = new Date('2026-10-18T10:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks(); purgeStatus = null; role = 'editor'; suspended = null; taskRow = { id: 't1', title: 'Old', notes: null, status: 'todo', assigneeId: null, dueOn: null, postId: null, createdById: 'someone', updatedAt };
  taskRows = []; commentRows = []; assignable = true; postFound = true; commentRow = null; auditCount = 1; scope = { all: true, ids: [] }; moduleOn = true; featureOn = true; access = { read: true, write: true };
  itemRow = null; itemRows = []; checklistRows = []; checklistTotal = 0; hiddenUnlinked = 0;
  audits.length = 0; writes.length = 0;
  mocks.config.mockImplementation(async (key: string) => key === 'tasks.customerCopy' ? customerCopy : caps[key]);
  mocks.purging.mockResolvedValue(undefined);
  mocks.permissions.mockImplementation(async () => ({ pageScope: scope.all ? { all: true } : { all: false, ids: scope.ids } }));
  mocks.entitlements.mockImplementation(async () => ({ workspaceId: 'workspace-a' }));
  mocks.canModule.mockImplementation(() => moduleOn);
  mocks.canFeature.mockImplementation((_e: unknown, feature: string) => feature === 'tasks/board' ? featureOn : true);
  freshWrite = true;
  mocks.resolve.mockImplementation(() => ({ fresh: true }));
  // Key ceilings are marked objects; `fresh` is the in-transaction re-resolution; anything else is the member's current grants.
  mocks.canAccess.mockImplementation((p: { ceiling?: Record<string, { read: boolean; write: boolean }>; fresh?: boolean }, feature: string, mode: 'read' | 'write') => {
    if (p?.ceiling) return p.ceiling[feature]?.[mode] ?? false;
    if (p?.fresh) return feature === 'tasks/board' ? freshWrite : true;
    return feature === 'tasks/board' ? access[mode] : true;
  });
  mocks.selected.mockResolvedValue(['channel-1']);
  mocks.visibility.mockReturnValue({ workspaceId: 'workspace-a', OR: [] });
  mocks.prisma.post.findMany.mockImplementation(async () => postFound ? [{ id: 'post-a', message: 'Hello world', status: 'draft' }] : []);
  mocks.workspace.mockImplementation(async (_id: string, operation: () => Promise<unknown>) => operation());
  mocks.prisma.$transaction.mockImplementation(async (operation: (tx: typeof mocks.prisma) => Promise<unknown>) => operation(mocks.prisma));
  mocks.prisma.$queryRaw.mockImplementation(async (query: unknown) => {
    const sql = sqlText(query);
    if (sql.includes('FOR SHARE OF m, u, w')) return role ? [{ role, suspendedAt: suspended }] : [];
    if (sql.includes('SELECT status::text FROM workspace_data_purges')) return purgeStatus ? [{ status: purgeStatus }] : [];
    if (sql.includes('FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w')) return role ? [{ role, timezone: 'UTC', suspendedAt: suspended }] : [];
    if (sql.includes('SELECT m."userId" AS id')) return assignable ? [{ id: 'user-b' }] : [];
    if (sql.includes('GROUP BY t.status')) return [{ status: 'todo', total: 3, overdue: 1 }, { status: 'done', total: 2, overdue: 0 }];
    // The task list/detail SELECT embeds a comment-count subquery, so match it before the comment page.
    if (sql.includes('FROM tasks t LEFT JOIN')) return taskRows;
    if (sql.includes('FROM task_comments c')) return commentRows;
    if (sql.includes('FROM task_comments WHERE id')) return commentRow ? [commentRow] : [];
    if (sql.includes('FROM task_checklist_items i JOIN tasks')) return itemRow ? [itemRow] : [];
    if (sql.includes('FROM task_checklist_items') && sql.includes('COUNT(*)') && !sql.includes('GROUP BY')) return [{ total: checklistTotal, top: checklistTotal - 1 }];
    if (sql.includes('GROUP BY "taskId"')) return checklistRows;
    if (sql.includes('FROM task_checklist_items')) return itemRows;
    if (sql.includes('SELECT id FROM tasks')) return taskRow ? [{ id: 't1' }] : [];
    if (sql.includes('FROM tasks WHERE id')) return taskRow ? [taskRow] : [];
    if (sql.includes('SELECT u.id, u.name')) return [{ id: 'user-b', name: 'Bea' }];
    if (sql.includes('t."postId" IS NULL')) return [{ total: hiddenUnlinked }];
    if (sql.includes('FROM tasks t')) return taskRows;
    return [];
  });
  mocks.prisma.$executeRaw.mockImplementation(async (query: unknown, ...rest: unknown[]) => {
    const sql = sqlText(query);
    if (sql.includes('activity_logs')) { if (auditCount) audits.push(sql); return auditCount; }
    writes.push({ sql, values: rest.length ? rest : valuesOf(query) }); return sql.includes('FROM unnest') ? 3 : 1;
  });
});

const listed = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, title: `T${i}`, notes: null, status: 'todo', assigneeId: null, assigneeName: null, dueOn: '2020-01-01', postId: null, createdById: actor.userId, createdByName: 'Me', commentCount: 0, createdAt: new Date(), updatedAt: new Date() }));
const create = (extra: Record<string, unknown> = {}) => ({ action: 'task.create', title: 'x', confirmation: taskConfirmations.create(String(extra.title ?? 'x')), ...extra });

describe('task reads', () => {
  it('denies clients, non-members and malformed ids', async () => {
    role = 'client'; await expect(listTasks(actor)).rejects.toMatchObject({ code: 'forbidden' });
    role = null; await expect(listTasks(actor)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(getTask(actor, 'bad id!')).rejects.toMatchObject({ code: 'not_found' });
  });
  it('requires the Tasks module and feature entitlement and read permission at the service boundary', async () => {
    moduleOn = false; await expect(listTasks(actor)).rejects.toMatchObject({ code: 'forbidden' });
    moduleOn = true; featureOn = false; await expect(getTask(actor, 't1')).rejects.toMatchObject({ code: 'forbidden' });
    featureOn = true; access = { read: false, write: false }; await expect(listTasks(actor)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(listTaskPostChoices(actor)).rejects.toMatchObject({ code: 'forbidden' });
    mocks.entitlements.mockResolvedValueOnce(null); access = { read: true, write: true }; await expect(listTasks(actor)).rejects.toMatchObject({ code: 'forbidden' });
    expect(mocks.canModule).toHaveBeenCalledWith(expect.anything(), 'tasks');
    expect(mocks.canFeature).toHaveBeenCalledWith(expect.anything(), 'tasks/board');
  });
  it('scopes every list query to the workspace, pages by configuration and flags overdue', async () => {
    taskRows = listed(3); role = 'viewer';
    const result = await listTasks(actor, { limit: 1000 });
    expect(result.tasks).toHaveLength(2); expect(result.hasMore).toBe(true); expect(result.canCreate).toBe(false);
    expect(result.tasks[0]).toMatchObject({ overdue: true, canEdit: false, canDelete: false });
    expect(result.summary).toEqual({ todo: 3, doing: 0, done: 2, overdue: 1 });
    const call = mocks.prisma.$queryRaw.mock.calls.find(item => sqlText(item[0]).includes('FROM tasks t LEFT JOIN'))!;
    expect(sqlText(call[0])).toContain('t."workspaceId" ='); expect(valuesOf(call[0])).toContain('workspace-a');
  });
  it('lets an MCP result ceiling shrink pages, assignees and comment history, never grow them', async () => {
    taskRows = listed(3);
    expect((await listTasks(actor, {}, { maxItems: 1 })).tasks).toHaveLength(1);
    expect((await listTasks(actor, {}, { maxItems: 500 })).tasks).toHaveLength(2);
    commentRows = [1, 2, 3].map(n => ({ id: `c${n}`, authorId: null, authorName: null, body: 'b', createdAt: new Date() })); taskRows = listed(1);
    const detail = await getTask(actor, 't0', { maxItems: 2 });
    expect(detail.comments).toHaveLength(2); expect(detail.commentsHasMore).toBe(true);
    await expect(getTask(actor, 't0', { commentOffset: -1 })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('shows a linked post only when Publishing visibility allows it and never describes a hidden one', async () => {
    taskRows = [{ ...listed(1)[0], postId: 'post-a' }];
    expect((await listTasks(actor)).tasks[0]).toMatchObject({ post: { id: 'post-a', preview: 'Hello world' }, postHidden: false });
    postFound = false;
    expect((await listTasks(actor)).tasks[0]).toMatchObject({ post: null, postHidden: true });
    postFound = true; mocks.canFeature.mockImplementation((_e: unknown, feature: string) => feature !== 'publishing/posts');
    const hidden = (await listTasks(actor)).tasks[0]!;
    expect(hidden).toMatchObject({ post: null, postHidden: true }); expect(JSON.stringify(hidden)).not.toContain('Hello world');
  });
  it('narrows grants by a key ceiling and passes the result to Publishing visibility', async () => {
    expect(effectiveTargetIds({ all: true }, undefined)).toBeUndefined();
    expect(effectiveTargetIds({ all: true }, ['a', 'b'])).toEqual(['a', 'b']);
    expect(effectiveTargetIds({ all: false, ids: ['a', 'c'] }, undefined)).toEqual(['a', 'c']);
    expect(effectiveTargetIds({ all: false, ids: ['a', 'c'] }, ['a', 'b'])).toEqual(['a']);
    expect(effectiveTargetIds({ all: false, ids: [] }, ['a'])).toEqual([]);
    scope = { all: false, ids: ['a', 'c'] }; taskRows = [{ ...listed(1)[0], postId: 'post-a' }];
    await listTasks({ ...actor, allowedTargetIds: ['a', 'b'] });
    expect(mocks.selected).toHaveBeenCalledWith('workspace-a', expect.anything(), ['a']);
    expect(mocks.visibility).toHaveBeenCalledWith('workspace-a', ['channel-1'], actor.userId);
  });
  it('lets an all-channel member read every post without an author restriction', async () => {
    taskRows = [{ ...listed(1)[0], postId: 'post-a' }];
    await listTasks(actor);
    expect(mocks.selected).toHaveBeenCalledWith('workspace-a', expect.anything(), undefined);
    expect(mocks.visibility).toHaveBeenCalledWith('workspace-a', ['channel-1'], undefined);
  });
  it('pages the post choices by configuration and reports an unavailable Publishing feature', async () => {
    mocks.prisma.post.findMany.mockResolvedValue([1, 2, 3].map(n => ({ id: `p${n}`, message: `Post ${n}`, status: 'draft' })));
    const page = await listTaskPostChoices(actor, { q: 'post' });
    expect(page.posts).toHaveLength(2); expect(page.hasMore).toBe(true);
    expect(mocks.prisma.post.findMany.mock.calls[0]![0]).toMatchObject({ take: 3, skip: 0 });
    mocks.canFeature.mockImplementation((_e: unknown, feature: string) => feature !== 'publishing/posts');
    expect(await listTaskPostChoices(actor)).toMatchObject({ posts: [], available: false });
    await expect(listTaskPostChoices(actor, { extra: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('rejects malformed filters before any query', async () => {
    await expect(listTasks(actor, { status: 'archived' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(listTasks(actor, { surprise: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('reports an unusable configuration as unavailable', async () => {
    caps['tasks.pageLimit'] = 0; try { await expect(listTasks(actor)).rejects.toMatchObject({ code: 'unavailable' }); } finally { caps['tasks.pageLimit'] = 2; }
  });
  it('does not read while the workspace is being erased', async () => {
    mocks.purging.mockRejectedValue(Object.assign(new Error('purging'), { code: 'unavailable' }));
    await expect(listTasks(actor)).rejects.toThrow('purging');
  });
});

describe('task writes', () => {
  it('blocks viewers, clients, suspended workspaces, missing write permission and members who lose their role mid-write', async () => {
    for (const denied of ['viewer', 'client']) { role = denied; await expect(performTaskAction(actor, create())).rejects.toMatchObject({ code: 'forbidden' }); }
    role = 'editor'; suspended = new Date(); await expect(performTaskAction(actor, create())).rejects.toMatchObject({ code: 'forbidden' });
    suspended = null; access = { read: true, write: false }; await expect(performTaskAction(actor, create())).rejects.toMatchObject({ code: 'forbidden' });
    featureOn = false; access = { read: true, write: true }; await expect(performTaskAction(actor, create())).rejects.toMatchObject({ code: 'forbidden' });
    featureOn = true; expect(writes).toHaveLength(0);
    const original = mocks.prisma.$queryRaw.getMockImplementation()!;
    mocks.prisma.$queryRaw.mockImplementation(async (query: unknown) => (sqlText(query).includes('FOR SHARE OF m, u, w') ? [] : original(query)));
    await expect(performTaskAction(actor, create())).rejects.toMatchObject({ code: 'forbidden' });
    mocks.prisma.$queryRaw.mockImplementation(async (query: unknown) => (sqlText(query).includes('FOR SHARE OF m, u, w') ? [{ role: 'editor', suspendedAt: new Date() }] : original(query)));
    await expect(performTaskAction(actor, create())).rejects.toMatchObject({ code: 'forbidden' });
    expect(writes).toHaveLength(0);
  });
  it('guards workspace, purge and actor inside one transaction without a nested operation lock', async () => {
    await performTaskAction(actor, create());
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.$queryRaw.mock.calls.some(([query]) => sqlText(query).includes('workspace_data_purges'))).toBe(true);
    expect(writes).toHaveLength(1);
  });
  it.each(['requested', 'db_deleted'])('refuses writes while erasure is %s and accepts a completed purge row', async status => {
    purgeStatus = status;
    await expect(performTaskAction(actor, create())).rejects.toMatchObject({ code: 'conflict' });
    expect(writes).toHaveLength(0);
    purgeStatus = 'completed';
    await expect(performTaskAction(actor, create())).resolves.toMatchObject({ ok: true });
  });
  it('stamps task changes with the statement clock so an optimistic token never moves backwards', async () => {
    await performTaskAction(actor, { action: 'task.transition', id: 't1', status: 'doing', confirmation: 'MOVE TASK t1 TO doing' });
    await performTaskAction(actor, { action: 'task.update', id: 't1', confirmation: 'UPDATE TASK t1', title: 'New' });
    const updates = writes.filter(write => write.sql.includes('UPDATE tasks'));
    expect(updates).toHaveLength(2);
    for (const update of updates) expect(update.sql).toContain('clock_timestamp()');
  });
  it('creates a task with limits, assignee check and audit', async () => {
    const result = await performTaskAction(actor, create({ title: ' Plan ', assigneeId: 'user-b', dueOn: '2026-12-01' }));
    expect(result).toMatchObject({ ok: true, action: 'task.create' });
    expect(writes[0]!.sql).toContain('INSERT INTO tasks'); expect(audits[0]).toContain('activity_logs');
    await expect(performTaskAction(actor, create({ title: 'x'.repeat(21) }))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(performTaskAction(actor, create({ title: '   ' }))).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(performTaskAction(actor, create({ dueOn: '2026-02-31' }))).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('rejects assignees or posts outside the workspace and access', async () => {
    assignable = false; await expect(performTaskAction(actor, create({ assigneeId: 'outsider' }))).rejects.toMatchObject({ code: 'invalid_request' });
    assignable = true; postFound = false; await expect(performTaskAction(actor, create({ postId: 'foreign' }))).rejects.toMatchObject({ code: 'invalid_request' });
    expect(writes).toHaveLength(0);
    postFound = true; await expect(performTaskAction(actor, create({ postId: 'post-a' }))).resolves.toMatchObject({ ok: true });
  });
  it('refuses a post link when the member cannot use Publishing posts', async () => {
    mocks.canFeature.mockImplementation((_e: unknown, feature: string) => feature !== 'publishing/posts');
    await expect(performTaskAction(actor, create({ postId: 'post-a' }))).rejects.toMatchObject({ code: 'invalid_request' });
    expect(writes).toHaveLength(0);
  });
  it('rolls back (no success) when the audit record cannot be written', async () => {
    auditCount = 0; await expect(performTaskAction(actor, create())).rejects.toMatchObject({ code: 'unavailable' });
  });
  it('creates a checklist in one insert with bounded size, computed due dates and a single audit', async () => {
    const result = await performTaskAction(actor, { action: 'task.createMany', confirmation: 'CREATE 3 TASKS', titles: [' A ', 'B', 'C'], assigneeId: 'user-b', startOn: '2026-12-30', gapDays: 2 });
    expect(result).toMatchObject({ ok: true, action: 'task.createMany' }); expect((result as { ids: string[] }).ids).toHaveLength(3);
    expect(writes).toHaveLength(1); expect(writes[0]!.sql).toContain('unnest'); expect(audits).toHaveLength(1);
    expect(writes[0]!.values).toContainEqual(['2026-12-30', '2027-01-01', '2027-01-03']);
    expect(writes[0]!.values).toContainEqual(['A', 'B', 'C']);
    await performTaskAction(actor, { action: 'task.createMany', confirmation: 'CREATE 3 TASKS', titles: ['A', 'B', 'C'] });
    expect(writes[1]!.values).toContainEqual(['', '', '']);
  });
  it('refuses oversize, invalid or overflowing checklists without writing', async () => {
    const run = (value: Record<string, unknown>) => performTaskAction(actor, { action: 'task.createMany', confirmation: taskConfirmations.createMany(Array.isArray(value.titles) ? value.titles.length : 1), titles: ['A'], ...value });
    await expect(run({ titles: ['A', 'B', 'C', 'D'] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(run({ titles: ['A', '  '] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(run({ titles: ['x'.repeat(21)] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(run({ startOn: '2026-01-01', gapDays: 8 })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(run({ titles: [] })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(run({ titles: ['A', 'B'], startOn: '9999-12-31', gapDays: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
    assignable = false; await expect(run({ assigneeId: 'outsider' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(writes).toHaveLength(0);
  });
  it('allows a move between any two different statuses and detects concurrent change', async () => {
    expect(TASK_TRANSITIONS.done).toEqual(['todo', 'doing']);
    taskRow = { ...taskRow!, status: 'done' };
    await expect(performTaskAction(actor, { action: 'task.transition', id: 't1', status: 'doing', confirmation: 'MOVE TASK t1 TO doing' })).resolves.toMatchObject({ ok: true });
    await expect(performTaskAction(actor, { action: 'task.transition', id: 't1', status: 'done', confirmation: 'MOVE TASK t1 TO done' })).rejects.toMatchObject({ code: 'conflict' });
    taskRow = { ...taskRow!, status: 'todo' };
    mocks.prisma.$executeRaw.mockResolvedValueOnce(0);
    await expect(performTaskAction(actor, { action: 'task.transition', id: 't1', status: 'done', confirmation: 'MOVE TASK t1 TO done' })).rejects.toMatchObject({ code: 'conflict' });
  });
  it('limits contributors to tasks they created or are assigned', async () => {
    role = 'contributor';
    await expect(performTaskAction(actor, { action: 'task.transition', id: 't1', status: 'doing', confirmation: 'MOVE TASK t1 TO doing' })).rejects.toMatchObject({ code: 'forbidden' });
    taskRow = { ...taskRow!, assigneeId: actor.userId };
    await expect(performTaskAction(actor, { action: 'task.transition', id: 't1', status: 'doing', confirmation: 'MOVE TASK t1 TO doing' })).resolves.toMatchObject({ ok: true });
    await expect(performTaskAction(actor, { action: 'task.delete', id: 't1', confirmation: taskConfirmations.delete('t1') })).rejects.toMatchObject({ code: 'forbidden' });
  });
  it('returns not_found for another workspace task, refuses empty updates and stale edits', async () => {
    taskRow = null; await expect(performTaskAction(actor, { action: 'task.update', id: 'foreign', confirmation: 'UPDATE TASK foreign', title: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    taskRow = { id: 't1', title: 'Old', notes: null, status: 'todo', assigneeId: null, dueOn: null, postId: null, createdById: 'someone', updatedAt };
    await expect(performTaskAction(actor, { action: 'task.update', id: 't1', confirmation: 'UPDATE TASK t1', title: 'Old' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(performTaskAction(actor, { action: 'task.update', id: 't1', confirmation: 'UPDATE TASK t1', title: 'New', expectedUpdatedAt: '2026-10-18T09:00:00.000Z' })).rejects.toMatchObject({ code: 'conflict' });
    expect(writes).toHaveLength(0);
    await expect(performTaskAction(actor, { action: 'task.update', id: 't1', confirmation: 'UPDATE TASK t1', title: 'New', expectedUpdatedAt: updatedAt.toISOString() })).resolves.toMatchObject({ ok: true });
    await expect(performTaskAction(actor, { action: 'task.update', id: 't1', confirmation: 'UPDATE TASK t1', title: 'Newer' })).resolves.toMatchObject({ ok: true });
  });
  it('requires the exact confirmation to delete and removes comments and checklist items with the task', async () => {
    await expect(performTaskAction(actor, { action: 'task.delete', id: 't1', confirmation: 'delete' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(writes).toHaveLength(0);
    await performTaskAction(actor, { action: 'task.delete', id: 't1', confirmation: taskConfirmations.delete('t1') });
    expect(writes[0]!.sql).toContain('DELETE FROM task_comments'); expect(writes[1]!.sql).toContain('DELETE FROM task_checklist_items'); expect(writes[2]!.sql).toContain('DELETE FROM tasks'); expect(audits).toHaveLength(1);
  });
  it('keeps comment text out of the audit trail and protects other authors', async () => {
    await performTaskAction(actor, { action: 'comment.add', taskId: 't1', confirmation: 'COMMENT ON TASK t1', body: 'secret words' });
    expect(audits[0]).not.toContain('secret words');
    await expect(performTaskAction(actor, { action: 'comment.add', taskId: 't1', confirmation: 'COMMENT ON TASK t1', body: 'x'.repeat(31) })).rejects.toMatchObject({ code: 'invalid_request' });
    commentRow = { authorId: 'other', taskId: 't1' };
    await expect(performTaskAction(actor, { action: 'comment.delete', id: 'c1', confirmation: taskConfirmations.deleteComment('c1') })).rejects.toMatchObject({ code: 'forbidden' });
    role = 'admin'; await expect(performTaskAction(actor, { action: 'comment.delete', id: 'c1', confirmation: taskConfirmations.deleteComment('c1') })).resolves.toMatchObject({ ok: true });
  });
  it('rechecks the Tasks switch inside the write lock so a concurrent member disable wins over the preflight', async () => {
    freshWrite = false;
    await expect(performTaskAction(actor, create())).rejects.toMatchObject({ code: 'forbidden' });
    await expect(performTaskAction(actor, { action: 'comment.add', taskId: 't1', confirmation: 'COMMENT ON TASK t1', body: 'late' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(writes).toHaveLength(0); expect(audits).toHaveLength(0);
    expect(mocks.resolve).toHaveBeenCalledWith(expect.objectContaining({ role: 'editor' }));
  });
  it('rejects unknown actions and extra fields', async () => {
    await expect(performTaskAction(actor, { action: 'task.purge' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(performTaskAction(actor, create({ workspaceId: 'other' }))).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('task MCP', () => {
  it('declares a tool for every write and enforces exact confirmations', async () => {
    const names = tasksToolDefinitions.map(tool => tool.name);
    for (const name of tasksWriteTools) expect(names).toContain(name);
    await expect(executeTasksTool(actor, 'create_task', { title: 'x', confirmation: 'yes' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeTasksTool(actor, 'create_task', { title: 'x', confirmation: taskConfirmations.create('x') })).resolves.toMatchObject({ ok: true });
    await expect(executeTasksTool(actor, 'create_task_checklist', { titles: ['A', 'B'], confirmation: taskConfirmations.createMany(3) })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeTasksTool(actor, 'create_task_checklist', { titles: ['A', 'B', 'C'], confirmation: taskConfirmations.createMany(3) })).resolves.toMatchObject({ ok: true });
    await expect(executeTasksTool(actor, 'move_task', { id: 't1', status: 'doing', confirmation: 'no' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeTasksTool(actor, 'nope', {})).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('carries the key channel ceiling and result ceiling into the services', async () => {
    taskRows = listed(3);
    const limited = await executeTasksTool({ ...actor, allowedTargetIds: ['a'] }, 'list_tasks', {}, 1) as { tasks: unknown[] };
    expect(limited.tasks).toHaveLength(1);
    scope = { all: false, ids: ['a', 'b'] }; taskRows = [{ ...listed(1)[0], postId: 'post-a' }];
    await executeTasksTool({ ...actor, allowedTargetIds: ['b', 'z'] }, 'get_task', { id: 't0' });
    expect(mocks.selected).toHaveBeenLastCalledWith('workspace-a', expect.anything(), ['b']);
    await executeTasksTool({ ...actor, allowedTargetIds: [] }, 'list_task_post_choices', {});
    expect(mocks.selected).toHaveBeenLastCalledWith('workspace-a', expect.anything(), []);
  });
  const keyed = (ceiling: Record<string, { read: boolean; write: boolean }>) => ({ ...actor, permissionCeiling: { ceiling } as never });
  it('keeps a Tasks-only key from reading, listing or linking Publishing posts, even when the member holds them', async () => {
    const tasksOnly = keyed({ 'tasks/board': { read: true, write: true }, 'publishing/posts': { read: false, write: false } });
    taskRows = [{ ...listed(1)[0], postId: 'post-a' }];
    const listing = await executeTasksTool(tasksOnly, 'list_tasks', {}) as { tasks: Array<{ post: unknown; postHidden: boolean }> };
    expect(listing.tasks[0]).toMatchObject({ post: null, postHidden: true });
    const detail = await executeTasksTool(tasksOnly, 'get_task', { id: 't0' }) as { task: { post: unknown; postHidden: boolean } };
    expect(detail.task).toMatchObject({ post: null, postHidden: true });
    expect(await executeTasksTool(tasksOnly, 'list_task_post_choices', {})).toMatchObject({ posts: [], available: false });
    await expect(executeTasksTool(tasksOnly, 'create_task', { title: 'x', postId: 'post-a', confirmation: taskConfirmations.create('x') })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(mocks.prisma.post.findMany).not.toHaveBeenCalled(); expect(writes).toHaveLength(0);
    // The same member without the ceiling still sees the preview, and a ceiling that grants posts shows it too.
    expect((await listTasks(actor)).tasks[0]).toMatchObject({ post: { id: 'post-a' } });
    const withPosts = keyed({ 'tasks/board': { read: true, write: true }, 'publishing/posts': { read: true, write: false } });
    expect(((await executeTasksTool(withPosts, 'list_tasks', {})) as { tasks: Array<{ post: unknown }> }).tasks[0]!.post).toMatchObject({ id: 'post-a' });
  });
  it('never lets a ceiling widen a feature the member lost', async () => {
    access = { read: true, write: true };
    const ceiling = keyed({ 'tasks/board': { read: true, write: true }, 'publishing/posts': { read: true, write: true } });
    mocks.canAccess.mockImplementation((p: { ceiling?: Record<string, { read: boolean; write: boolean }> }, feature: string, mode: 'read' | 'write') => p?.ceiling ? (p.ceiling[feature]?.[mode] ?? false) : feature !== 'publishing/posts');
    taskRows = [{ ...listed(1)[0], postId: 'post-a' }];
    expect(((await executeTasksTool(ceiling, 'list_tasks', {})) as { tasks: Array<{ postHidden: boolean }> }).tasks[0]!.postHidden).toBe(true);
  });
  it('makes a read-only key unable to write and reports no write ability', async () => {
    const readOnly = keyed({ 'tasks/board': { read: true, write: false }, 'publishing/posts': { read: true, write: false } });
    taskRows = listed(1);
    const listing = await executeTasksTool(readOnly, 'list_tasks', {}) as { canCreate: boolean; tasks: Array<{ canEdit: boolean; canDelete: boolean }> };
    expect(listing.canCreate).toBe(false); expect(listing.tasks[0]).toMatchObject({ canEdit: false, canDelete: false });
    const detail = await executeTasksTool(readOnly, 'get_task', { id: 't0' }) as { canComment: boolean };
    expect(detail.canComment).toBe(false);
    await expect(executeTasksTool(readOnly, 'create_task', { title: 'x', confirmation: taskConfirmations.create('x') })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(performTaskAction(readOnly, create())).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeTasksTool(readOnly, 'add_task_comment', { taskId: 't1', body: 'hi', confirmation: taskConfirmations.comment('t1') })).rejects.toMatchObject({ code: 'forbidden' });
    expect(writes).toHaveLength(0);
    // Without a ceiling the same editor can write.
    expect((await listTasks(actor)).canCreate).toBe(true);
  });
  it('refuses a checklist larger than the key result ceiling before writing, instead of truncating returned ids', async () => {
    await expect(executeTasksTool(actor, 'create_task_checklist', { titles: ['A', 'B', 'C'], confirmation: taskConfirmations.createMany(3) }, 2)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(writes).toHaveLength(0); expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    const ok = await executeTasksTool(actor, 'create_task_checklist', { titles: ['A', 'B', 'C'], confirmation: taskConfirmations.createMany(3) }, 3) as { ids: string[] };
    expect(ok.ids).toHaveLength(3);
  });
  it('refuses unknown arguments and applies the same service authorization', async () => {
    await expect(executeTasksTool(actor, 'list_tasks', { workspaceId: 'other' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(executeTasksTool(actor, 'get_task', { id: 't1', extra: 1 })).rejects.toMatchObject({ code: 'invalid_request' });
    featureOn = false;
    await expect(executeTasksTool(actor, 'list_tasks', {})).rejects.toMatchObject({ code: 'forbidden' });
    await expect(executeTasksTool(actor, 'move_task', { id: 't1', status: 'doing', confirmation: taskConfirmations.transition('t1', 'doing') })).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('shared task confirmation boundary', () => {
  const actions = [
    { action: 'task.create', title: 'Plan', confirmation: 'CREATE TASK Plan' },
    { action: 'task.createMany', titles: ['A', 'B'], confirmation: 'CREATE 2 TASKS' },
    { action: 'task.update', id: 't1', title: 'New', confirmation: 'UPDATE TASK t1' },
    { action: 'task.transition', id: 't1', status: 'doing', confirmation: 'MOVE TASK t1 TO doing' },
    { action: 'comment.add', taskId: 't1', body: 'Hello', confirmation: 'COMMENT ON TASK t1' },
    { action: 'task.delete', id: 't1', confirmation: 'DELETE TASK t1' },
    { action: 'comment.delete', id: 'c1', confirmation: 'DELETE TASK COMMENT c1' },
    { action: 'checklist.add', taskId: 't1', text: 'First', confirmation: 'ADD CHECKLIST ITEM t1' },
    { action: 'checklist.set', id: 'i1', done: true, confirmation: 'SET CHECKLIST ITEM i1' },
    { action: 'checklist.delete', id: 'i1', confirmation: 'DELETE CHECKLIST ITEM i1' },
  ];
  it.each(actions)('requires confirmation in the shared schema: $action', async value => {
    const { confirmation: _confirmation, ...missing } = value;
    await expect(performTaskAction(actor, missing)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(writes).toHaveLength(0); expect(audits).toHaveLength(0); expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each(actions)('refuses mismatched confirmation before writes: $action', async value => {
    await expect(performTaskAction(actor, { ...value, confirmation: 'yes' })).rejects.toMatchObject({ code: 'invalid_request' });
    expect(writes).toHaveLength(0); expect(audits).toHaveLength(0); expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('task channel scope', () => {
  it('narrows the board to tasks linked to scoped channels and counts hidden unlinked tasks', async () => {
    taskRows = listed(1);
    const result = await listTasks(actor, { channelIds: ['channel-1'] });
    const queries = mocks.prisma.$queryRaw.mock.calls.map(call => sqlText(call[0]));
    expect(queries.some(sql => sql.includes('post_targets') && sql.includes('"postId" IS NOT NULL'))).toBe(true);
    expect(queries.some(sql => sql.includes('t."postId" IS NULL'))).toBe(true);
    expect(result.scopeHiddenUnlinked).toBe(0);
    expect(result.tasks).toHaveLength(1);
  });
  it('reports unlinked tasks hidden by the scope without hiding linked ones', async () => {
    hiddenUnlinked = 4;
    const result = await listTasks(actor, { channelIds: ['channel-1'] });
    expect(result.scopeHiddenUnlinked).toBe(4);
    const result2 = await listTasks(actor);
    expect(result2.scopeHiddenUnlinked).toBe(0);
    expect(mocks.prisma.$queryRaw.mock.calls.map(call => sqlText(call[0])).filter(sql => sql.includes('t."postId" IS NULL'))).toHaveLength(1);
  });
  it('narrows the link picker to posts on scoped channels', async () => {
    await listTaskPostChoices(actor, { channelIds: ['channel-1'] });
    expect(mocks.prisma.post.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([{ targets: { some: { targetId: { in: ['channel-1'] } } } }]) }),
    }));
  });
  it('rejects malformed scope ids', async () => {
    await expect(listTasks(actor, { channelIds: ['bad id!'] })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

describe('task checklists', () => {
  it('summarizes checklist progress on every listed task', async () => {
    taskRows = listed(2);
    checklistRows = [{ taskId: 't0', done: 1, total: 2 }];
    const result = await listTasks(actor);
    expect(result.tasks.map(task => task.checklist)).toEqual([{ done: 1, total: 2 }, { done: 0, total: 0 }]);
  });
  it('reads one task with its ordered items and change rights', async () => {
    taskRows = listed(1);
    itemRows = [
      { id: 'i1', text: 'First', done: false, position: 0, createdAt: updatedAt },
      { id: 'i2', text: 'Second', done: true, position: 1, createdAt: updatedAt },
    ];
    const result = await getTask(actor, 't1');
    expect(result.checklist.map(item => [item.id, item.done])).toEqual([['i1', false], ['i2', true]]);
    expect(result.checklistHasMore).toBe(false);
    expect(result.canChangeChecklist).toBe(true);
    expect(result.task.checklist).toEqual({ done: 1, total: 2 });
  });
  it('adds an item at the end with audit, within the Root limit', async () => {
    checklistTotal = 2;
    const result = await performTaskAction(actor, { action: 'checklist.add', taskId: 't1', text: '  Third ', confirmation: 'ADD CHECKLIST ITEM t1' });
    expect(result).toMatchObject({ ok: true });
    expect(writes[0]!.sql).toContain('INSERT INTO task_checklist_items');
    expect(audits).toHaveLength(1);
    checklistTotal = 3;
    await expect(performTaskAction(actor, { action: 'checklist.add', taskId: 't1', text: 'Fourth', confirmation: 'ADD CHECKLIST ITEM t1' })).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(performTaskAction(actor, { action: 'checklist.add', taskId: 't1', text: 'x'.repeat(41), confirmation: 'ADD CHECKLIST ITEM t1' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
  it('sets and deletes only through the owning task access, with audit', async () => {
    itemRow = { taskId: 't1', createdById: 'someone', assigneeId: null };
    await performTaskAction(actor, { action: 'checklist.set', id: 'i1', done: true, confirmation: 'SET CHECKLIST ITEM i1' });
    expect(writes[0]!.sql).toContain('UPDATE task_checklist_items');
    await performTaskAction(actor, { action: 'checklist.delete', id: 'i1', confirmation: 'DELETE CHECKLIST ITEM i1' });
    expect(writes[1]!.sql).toContain('DELETE FROM task_checklist_items');
    expect(audits).toHaveLength(2);
    itemRow = null;
    await expect(performTaskAction(actor, { action: 'checklist.set', id: 'i1', done: true, confirmation: 'SET CHECKLIST ITEM i1' })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('limits contributors to items of tasks they created or hold', async () => {
    role = 'contributor';
    itemRow = { taskId: 't1', createdById: 'other', assigneeId: 'other' };
    await expect(performTaskAction(actor, { action: 'checklist.set', id: 'i1', done: true, confirmation: 'SET CHECKLIST ITEM i1' })).rejects.toMatchObject({ code: 'forbidden' });
    itemRow = { taskId: 't1', createdById: actor.userId, assigneeId: null };
    await expect(performTaskAction(actor, { action: 'checklist.set', id: 'i1', done: true, confirmation: 'SET CHECKLIST ITEM i1' })).resolves.toMatchObject({ ok: true });
  });
  it('reaches checklist writes through the MCP tools with the same service', async () => {
    itemRow = { taskId: 't1', createdById: 'someone', assigneeId: null };
    await expect(executeTasksTool(actor, 'add_task_checklist_item', { taskId: 't1', text: 'MCP', confirmation: 'ADD CHECKLIST ITEM t1' })).resolves.toMatchObject({ ok: true });
    await expect(executeTasksTool(actor, 'set_task_checklist_item', { id: 'i1', done: false, confirmation: 'SET CHECKLIST ITEM i1' })).resolves.toMatchObject({ ok: true });
    await expect(executeTasksTool(actor, 'delete_task_checklist_item', { id: 'i1', confirmation: 'DELETE CHECKLIST ITEM i1' })).resolves.toMatchObject({ ok: true });
    await expect(executeTasksTool(actor, 'add_task_checklist_item', { taskId: 't1', text: 'MCP' })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
