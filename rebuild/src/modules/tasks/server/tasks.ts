import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import {
  TASK_ACTION_SCHEMA, TASK_FILTER_SCHEMA, TASK_POST_CHOICE_SCHEMA, TASK_TRANSITIONS, addCalendarDays, taskConfirmations,
  type TaskAction, type TaskCommentView, type TaskLimits, type TaskPostChoice, type TaskStatus, type TaskSummary, type TaskView, type TasksActor, type TasksReadOptions,
} from '../tasks';
import { TASK_COMMENT_MODERATOR_ROLES, TASK_MANAGER_ROLES, TASK_WRITE_ROLES, TASKS_FEATURE_ID } from '../semantics';
import { canAccessFeature, resolvePermissions } from '@/server/permissions';
import { authorizeTasks, type TasksAccess } from './access';
import { postVisibility, visiblePosts } from './posts';

const invalid = (message = 'Choose a valid task request.') => new OperationError('invalid_request', message);
const missing = () => new OperationError('not_found', 'This task is unavailable in the current workspace.');
const unavailable = () => new OperationError('unavailable', 'Tasks are currently unavailable.');
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);

const LIMIT_KEYS = ['tasks.titleMaxCharacters', 'tasks.notesMaxCharacters', 'tasks.commentMaxCharacters', 'tasks.pageLimit', 'tasks.commentHistoryLimit', 'tasks.assigneeLimit', 'tasks.postChoiceLimit', 'tasks.workflowRowLimit', 'tasks.workflowGapMaxDays'] as const;
type Bounds = TaskLimits & { commentHistoryLimit: number; assigneeLimit: number; postChoiceLimit: number };

/** Live Root-managed bounds. A missing or invalid value makes Tasks unavailable rather than guessing. */
async function limits(): Promise<Bounds> {
  const values = await Promise.all(LIMIT_KEYS.map(key => runtimeConfig(key)));
  const checked = z.tuple([
    z.number().int().min(1).max(20000), z.number().int().min(1).max(20000), z.number().int().min(1).max(20000), z.number().int().min(1).max(1000),
    z.number().int().min(1).max(2000), z.number().int().min(1).max(5000), z.number().int().min(1).max(500), z.number().int().min(1).max(200), z.number().int().min(0).max(3650),
  ]).safeParse(values);
  if (!checked.success) throw unavailable();
  const [titleMaxCharacters, notesMaxCharacters, commentMaxCharacters, pageLimit, commentHistoryLimit, assigneeLimit, postChoiceLimit, workflowRowLimit, workflowGapMaxDays] = checked.data;
  return { titleMaxCharacters, notesMaxCharacters, commentMaxCharacters, pageLimit, commentHistoryLimit, assigneeLimit, postChoiceLimit, workflowRowLimit, workflowGapMaxDays };
}
async function timeout() {
  const values = await Promise.all([runtimeConfig('tasks.transactionTimeoutMs'), runtimeConfig('tasks.transactionMaxWaitMs')]);
  const checked = z.tuple([z.number().int().min(1000).max(60000), z.number().int().min(500).max(30000)]).safeParse(values);
  if (!checked.success) throw unavailable();
  return { timeout: checked.data[0], maxWait: checked.data[1] };
}
/** The smaller of a Root page size and an optional MCP result ceiling. */
const pageSize = (configured: number, options?: TasksReadOptions, requested?: number) => {
  const ceiling = options?.maxItems;
  const cap = ceiling !== undefined && Number.isInteger(ceiling) && ceiling >= 1 ? Math.min(configured, ceiling) : configured;
  return Math.min(requested ?? cap, cap);
};

const dayKey = (now: Date, timeZone: string) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
  catch { return now.toISOString().slice(0, 10); }
};
const iso = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).toISOString();
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

type TaskRow = {
  id: string; title: string; notes: string | null; status: string; assigneeId: string | null; assigneeName: string | null; dueOn: string | null;
  postId: string | null; createdById: string | null; createdByName: string | null; commentCount: number; createdAt: Date; updatedAt: Date;
};
const SELECT = Prisma.sql`SELECT t.id, t.title, t.notes, t.status, t."assigneeId", au.name AS "assigneeName", t."dueOn", t."postId", t."createdById", cu.name AS "createdByName", (SELECT COUNT(*)::int FROM task_comments c WHERE c."taskId" = t.id AND c."workspaceId" = t."workspaceId") AS "commentCount", t."createdAt", t."updatedAt"`;
const JOINS = Prisma.sql`FROM tasks t LEFT JOIN users au ON au.id = t."assigneeId" LEFT JOIN users cu ON cu.id = t."createdById"`;

function canChange(userId: string, role: string, row: { createdById: string | null; assigneeId: string | null }) {
  return TASK_MANAGER_ROLES.includes(role) || (role === 'contributor' && (row.createdById === userId || row.assigneeId === userId));
}
function canRemove(userId: string, role: string, row: { createdById: string | null }) {
  return TASK_MANAGER_ROLES.includes(role) || (role === 'contributor' && row.createdById === userId);
}
function view(row: TaskRow, actor: TasksActor, access: TasksAccess, today: string, posts: Map<string, { id: string; preview: string; status: string }>): TaskView {
  const status = (['todo', 'doing', 'done'] as const).includes(row.status as TaskStatus) ? row.status as TaskStatus : 'todo';
  const post = row.postId ? posts.get(row.postId) ?? null : null;
  return {
    id: row.id, title: row.title, notes: row.notes, status,
    assignee: row.assigneeId ? { id: row.assigneeId, name: row.assigneeName ?? 'Former member' } : null,
    dueOn: row.dueOn, overdue: Boolean(row.dueOn && row.dueOn < today && status !== 'done'),
    post, postHidden: Boolean(row.postId && !post),
    createdBy: row.createdById ? { id: row.createdById, name: row.createdByName ?? 'Former member' } : null,
    createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt), commentCount: Number(row.commentCount ?? 0),
    canEdit: access.canWrite && canChange(actor.userId, access.role, row), canDelete: access.canWrite && canRemove(actor.userId, access.role, row),
  };
}

async function assigneesFor(actor: TasksActor, bounds: Bounds, options?: TasksReadOptions) {
  const take = pageSize(bounds.assigneeLimit, options);
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${actor.workspaceId} AND m.role::text <> 'client' AND u."disabledAt" IS NULL ORDER BY u.name ASC, u.id ASC LIMIT ${take + 1}`;
  return { assignees: rows.slice(0, take), assigneesHasMore: rows.length > take };
}

export async function listTaskAssignees(actor: TasksActor, options?: TasksReadOptions) {
  await authorizeTasks(actor, 'read');
  return (await assigneesFor(actor, await limits(), options)).assignees;
}

export async function listTasks(actor: TasksActor, rawFilters: unknown = {}, options?: TasksReadOptions) {
  const parsed = TASK_FILTER_SCHEMA.safeParse(rawFilters);
  if (!parsed.success) throw invalid('Choose valid task filters.');
  const filters = parsed.data;
  const access = await authorizeTasks(actor, 'read');
  const bounds = await limits();
  const take = pageSize(bounds.pageLimit, options, filters.limit);
  const today = dayKey(new Date(), access.timeZone);
  const where: Prisma.Sql[] = [Prisma.sql`t."workspaceId" = ${actor.workspaceId}`];
  if (filters.status) where.push(Prisma.sql`t.status = ${filters.status}`);
  if (filters.assignee === 'me') where.push(Prisma.sql`t."assigneeId" = ${actor.userId}`);
  else if (filters.assignee === 'none') where.push(Prisma.sql`t."assigneeId" IS NULL`);
  else if (filters.assignee) where.push(Prisma.sql`t."assigneeId" = ${filters.assignee}`);
  if (filters.overdue) where.push(Prisma.sql`t."dueOn" IS NOT NULL AND t."dueOn" < ${today} AND t.status <> 'done'`);
  if (filters.q) { const pattern = '%' + escapeLike(filters.q) + '%'; where.push(Prisma.sql`(t.title ILIKE ${pattern} ESCAPE '\\' OR COALESCE(t.notes, '') ILIKE ${pattern} ESCAPE '\\')`); }
  const [rows, people, counts] = await Promise.all([
    prisma.$queryRaw<TaskRow[]>(Prisma.sql`${SELECT} ${JOINS} WHERE ${Prisma.join(where, ' AND ')} ORDER BY t."dueOn" ASC NULLS LAST, t."createdAt" ASC, t.id ASC LIMIT ${take + 1} OFFSET ${filters.offset}`),
    assigneesFor(actor, bounds, options),
    prisma.$queryRaw<Array<{ status: string; total: number; overdue: number }>>`SELECT t.status, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE t."dueOn" IS NOT NULL AND t."dueOn" < ${today} AND t.status <> 'done')::int AS overdue FROM tasks t WHERE t."workspaceId" = ${actor.workspaceId} GROUP BY t.status`,
  ]);
  const page = rows.slice(0, take);
  const visibility = await postVisibility(actor, access);
  const posts = await visiblePosts(prisma, visibility, page.flatMap(row => row.postId ? [row.postId] : []));
  const summary: TaskSummary = { todo: 0, doing: 0, done: 0, overdue: 0 };
  for (const item of counts) { if (item.status in summary) summary[item.status as TaskStatus] = Number(item.total); summary.overdue += Number(item.overdue); }
  return {
    ok: true as const, today, hasMore: rows.length > take, offset: filters.offset, pageSize: take,
    tasks: page.map(row => view(row, actor, access, today, posts)),
    summary, ...people, canCreate: access.canWrite,
    limits: { titleMaxCharacters: bounds.titleMaxCharacters, notesMaxCharacters: bounds.notesMaxCharacters, commentMaxCharacters: bounds.commentMaxCharacters, pageLimit: bounds.pageLimit, workflowRowLimit: bounds.workflowRowLimit, workflowGapMaxDays: bounds.workflowGapMaxDays } satisfies TaskLimits,
  };
}

/** One task and one page of its comments. `commentOffset` continues a long thread; the page size is Root's, capped by the MCP result ceiling. */
export async function getTask(actor: TasksActor, id: unknown, options?: TasksReadOptions & { commentOffset?: number }) {
  const parsed = identifier.safeParse(id);
  if (!parsed.success) throw missing();
  const offset = options?.commentOffset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 1_000_000) throw invalid('Choose a valid comment page.');
  const access = await authorizeTasks(actor, 'read');
  const bounds = await limits();
  const today = dayKey(new Date(), access.timeZone);
  const rows = await prisma.$queryRaw<TaskRow[]>(Prisma.sql`${SELECT} ${JOINS} WHERE t.id = ${parsed.data} AND t."workspaceId" = ${actor.workspaceId}`);
  if (!rows[0]) throw missing();
  const take = pageSize(bounds.commentHistoryLimit, options);
  const comments = await prisma.$queryRaw<Array<{ id: string; authorId: string | null; authorName: string | null; body: string; createdAt: Date }>>`SELECT c.id, c."authorId", u.name AS "authorName", c.body, c."createdAt" FROM task_comments c LEFT JOIN users u ON u.id = c."authorId" WHERE c."taskId" = ${parsed.data} AND c."workspaceId" = ${actor.workspaceId} ORDER BY c."createdAt" ASC, c.id ASC LIMIT ${take + 1} OFFSET ${offset}`;
  const posts = await visiblePosts(prisma, await postVisibility(actor, access), rows[0].postId ? [rows[0].postId] : []);
  const commentViews: TaskCommentView[] = comments.slice(0, take).map(row => ({
    id: row.id, author: row.authorId ? { id: row.authorId, name: row.authorName ?? 'Former member' } : null, body: row.body, createdAt: iso(row.createdAt),
    canDelete: access.canWrite && (row.authorId === actor.userId || TASK_COMMENT_MODERATOR_ROLES.includes(access.role)),
  }));
  return { ok: true as const, task: view(rows[0], actor, access, today, posts), comments: commentViews, commentsHasMore: comments.length > take, commentOffset: offset, canComment: access.canWrite };
}

/** Posts the actor may link to a task: Publishing's visibility, searchable by text, one bounded page at a time. */
export async function listTaskPostChoices(actor: TasksActor, rawQuery: unknown = {}, options?: TasksReadOptions) {
  const parsed = TASK_POST_CHOICE_SCHEMA.safeParse(rawQuery);
  if (!parsed.success) throw invalid('Choose a valid post search.');
  const access = await authorizeTasks(actor, 'read');
  const bounds = await limits();
  const take = pageSize(bounds.postChoiceLimit, options);
  const visibility = await postVisibility(actor, access);
  if (!visibility) return { ok: true as const, posts: [] as TaskPostChoice[], hasMore: false, offset: parsed.data.offset, available: false };
  const rows = await prisma.post.findMany({
    where: { AND: [visibility, ...(parsed.data.q ? [{ message: { contains: parsed.data.q, mode: 'insensitive' as const } }] : [])] },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: parsed.data.offset, take: take + 1, select: { id: true, message: true, status: true },
  });
  return { ok: true as const, available: true, hasMore: rows.length > take, offset: parsed.data.offset, posts: rows.slice(0, take).map(row => ({ id: row.id, preview: row.message.slice(0, 140), status: String(row.status) })) };
}

async function audit(tx: Prisma.TransactionClient, actor: TasksActor, action: string, detail: object) {
  const count = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${randomUUID()}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
  if (count !== 1) throw new OperationError('unavailable', 'The task change could not be recorded, so it was not saved.');
}

/** Re-read the actor's membership and workspace state inside the write transaction so a role change, disable or suspension wins over the earlier check. */
async function lockActor(tx: Prisma.TransactionClient, actor: TasksActor): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ role: string; suspendedAt: Date | null; allPages?: boolean | null; memberDisabled?: string[] | null; workspaceDisabled?: string[] | null; clientAccess?: string[] | null }>>`SELECT m.role::text AS role, w."suspendedAt", m."allPages" AS "allPages", COALESCE(m."disabledModules", ARRAY[]::TEXT[]) AS "memberDisabled", COALESCE(w."disabledModules", ARRAY[]::TEXT[]) AS "workspaceDisabled", COALESCE(w."clientAccess", ARRAY[]::TEXT[]) AS "clientAccess" FROM memberships m JOIN users u ON u.id = m."userId" JOIN workspaces w ON w.id = m."workspaceId" WHERE m."workspaceId" = ${actor.workspaceId} AND m."userId" = ${actor.userId} AND u."disabledAt" IS NULL FOR SHARE OF m, u, w`;
  if (!rows[0] || !TASK_WRITE_ROLES.includes(rows[0].role)) throw new OperationError('forbidden', 'Tasks are unavailable for your role in this workspace.');
  if (rows[0].suspendedAt) throw new OperationError('forbidden', 'This workspace is suspended.');
  // Read in a new statement after acquiring the lock: a snapshot taken before waiting could miss a purge that just committed.
  const purge = await tx.$queryRaw<Array<{ status: string }>>`SELECT status::text FROM workspace_data_purges WHERE "workspaceId" = ${actor.workspaceId}`;
  if (purge[0] && purge[0].status !== 'completed') throw new OperationError('conflict', 'Workspace data deletion is in progress.');
  // A Root module switch or role change committed after the preflight must win over it.
  const fresh = resolvePermissions({ role: rows[0].role, allPages: rows[0].allPages === true, workspaceDisabledModules: rows[0].workspaceDisabled ?? [], memberDisabledModules: rows[0].memberDisabled ?? [], clientAccess: rows[0].clientAccess ?? [], pageAccess: [] });
  if (!canAccessFeature(fresh, TASKS_FEATURE_ID, 'write')) throw new OperationError('forbidden', 'Tasks are unavailable for your role in this workspace.');
  return rows[0].role;
}
async function assertAssignable(tx: Prisma.TransactionClient, actor: TasksActor, userId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT m."userId" AS id FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${actor.workspaceId} AND m."userId" = ${userId} AND m.role::text <> 'client' AND u."disabledAt" IS NULL FOR SHARE OF m, u`;
  if (!rows[0]) throw invalid('Choose an active team member as the assignee.');
}
async function assertLinkable(tx: Prisma.TransactionClient, visibility: Prisma.PostWhereInput | null, postId: string) {
  const found = await visiblePosts(tx, visibility, [postId]);
  if (!found.has(postId)) throw invalid('Choose a post you can access in this workspace.');
}
function text(value: string | null | undefined, max: number, label: string, required: boolean): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) { if (required) throw invalid(`Enter a ${label}.`); return null; }
  if (trimmed.length > max) throw invalid(`The ${label} is longer than ${max} characters.`);
  return trimmed;
}
function expect(actual: string, wanted: string) { if (actual !== wanted) throw invalid('Type the exact confirmation text to continue.'); }

type Row = { id: string; title: string; notes: string | null; status: string; assigneeId: string | null; dueOn: string | null; postId: string | null; createdById: string | null; updatedAt: Date };

export async function performTaskAction(actor: TasksActor, raw: unknown, options?: TasksReadOptions) {
  const parsed = TASK_ACTION_SCHEMA.safeParse(raw);
  if (!parsed.success) throw invalid('Choose a valid task action.');
  const value: TaskAction = parsed.data;
  // Every interface carries the same intent token; the service validates it before side effects.
  switch (value.action) {
    case 'task.create': expect(value.confirmation, taskConfirmations.create(value.title)); break;
    case 'task.createMany': expect(value.confirmation, taskConfirmations.createMany(value.titles.length)); break;
    case 'task.update': expect(value.confirmation, taskConfirmations.update(value.id)); break;
    case 'task.transition': expect(value.confirmation, taskConfirmations.transition(value.id, value.status)); break;
    case 'comment.add': expect(value.confirmation, taskConfirmations.comment(value.taskId)); break;
    case 'task.delete': expect(value.confirmation, taskConfirmations.delete(value.id)); break;
    case 'comment.delete': expect(value.confirmation, taskConfirmations.deleteComment(value.id)); break;
  }
  // The result returns every created id, so a batch larger than the key's result ceiling is refused whole, never truncated.
  const ceiling = options?.maxItems;
  if (value.action === 'task.createMany' && ceiling !== undefined && Number.isInteger(ceiling) && ceiling >= 1 && value.titles.length > ceiling) {
    throw invalid(`This key returns at most ${ceiling} results per call, so a checklist can create at most ${ceiling} tasks at once. Nothing was created.`);
  }
  const access = await authorizeTasks(actor, 'write');
  const bounds = await limits();
  const config = await timeout();
  const needsPostCheck = (value.action === 'task.create' || value.action === 'task.update') && Boolean(value.postId);
  const visibility = needsPostCheck ? await postVisibility(actor, access) : null;
  // One transaction: the shared workspace lock, purge exclusion, actor re-check and the write commit or fail together.
  return prisma.$transaction(async tx => {
    const role = await lockActor(tx, actor);

    if (value.action === 'task.create') {
      const title = text(value.title, bounds.titleMaxCharacters, 'task title', true)!;
      const notes = text(value.notes, bounds.notesMaxCharacters, 'task notes', false);
      if (value.assigneeId) await assertAssignable(tx, actor, value.assigneeId);
      if (value.postId) await assertLinkable(tx, visibility, value.postId);
      const id = randomUUID();
      const inserted = await tx.$executeRaw`INSERT INTO tasks (id, "workspaceId", title, notes, status, "assigneeId", "dueOn", "postId", "createdById", "createdAt", "updatedAt") VALUES (${id}, ${actor.workspaceId}, ${title}, ${notes}, 'todo', ${value.assigneeId ?? null}, ${value.dueOn ?? null}, ${value.postId ?? null}, ${actor.userId}, NOW(), NOW())`;
      if (inserted !== 1) throw unavailable();
      await audit(tx, actor, 'tasks.created', { taskId: id, assigneeId: value.assigneeId ?? null, postId: value.postId ?? null, dueOn: value.dueOn ?? null });
      return { ok: true as const, action: value.action, id };
    }

    if (value.action === 'task.createMany') {
      if (value.titles.length > bounds.workflowRowLimit) throw invalid(`A checklist can create at most ${bounds.workflowRowLimit} tasks at once.`);
      if (value.gapDays > bounds.workflowGapMaxDays) throw invalid(`Due dates can be at most ${bounds.workflowGapMaxDays} days apart.`);
      const titles = value.titles.map(title => text(title, bounds.titleMaxCharacters, 'task title', true)!);
      const dues = titles.map((_, index) => {
        if (!value.startOn) return '';
        const due = addCalendarDays(value.startOn, index * value.gapDays);
        if (!due) throw invalid('The checklist dates run past the supported calendar. Use an earlier start date.');
        return due;
      });
      if (value.assigneeId) await assertAssignable(tx, actor, value.assigneeId);
      const ids = titles.map(() => randomUUID());
      const inserted = await tx.$executeRaw`INSERT INTO tasks (id, "workspaceId", title, notes, status, "assigneeId", "dueOn", "postId", "createdById", "createdAt", "updatedAt") SELECT s.id, ${actor.workspaceId}, s.title, NULL, 'todo', ${value.assigneeId ?? null}, NULLIF(s.due, ''), NULL, ${actor.userId}, NOW() + s.ord * INTERVAL '1 millisecond', NOW() FROM unnest(${ids}::text[], ${titles}::text[], ${dues}::text[]) WITH ORDINALITY AS s(id, title, due, ord)`;
      if (inserted !== titles.length) throw unavailable();
      await audit(tx, actor, 'tasks.created_many', { taskIds: ids, count: ids.length, assigneeId: value.assigneeId ?? null, startOn: value.startOn ?? null, gapDays: value.gapDays });
      return { ok: true as const, action: value.action, ids };
    }

    if (value.action === 'comment.add') {
      const body = text(value.body, bounds.commentMaxCharacters, 'comment', true)!;
      const found = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM tasks WHERE id = ${value.taskId} AND "workspaceId" = ${actor.workspaceId} FOR SHARE`;
      if (!found[0]) throw missing();
      const id = randomUUID();
      const inserted = await tx.$executeRaw`INSERT INTO task_comments (id, "taskId", "workspaceId", "authorId", body, "createdAt") VALUES (${id}, ${value.taskId}, ${actor.workspaceId}, ${actor.userId}, ${body}, NOW())`;
      if (inserted !== 1) throw unavailable();
      await audit(tx, actor, 'tasks.comment_added', { taskId: value.taskId, commentId: id });
      return { ok: true as const, action: value.action, id };
    }

    if (value.action === 'comment.delete') {
      const found = await tx.$queryRaw<Array<{ authorId: string | null; taskId: string }>>`SELECT "authorId", "taskId" FROM task_comments WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
      if (!found[0]) throw missing();
      if (found[0].authorId !== actor.userId && !TASK_COMMENT_MODERATOR_ROLES.includes(role)) throw new OperationError('forbidden', 'Only the comment author or a workspace manager can remove this comment.');
      const removed = await tx.$executeRaw`DELETE FROM task_comments WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
      if (removed !== 1) throw missing();
      await audit(tx, actor, 'tasks.comment_deleted', { taskId: found[0].taskId, commentId: value.id });
      return { ok: true as const, action: value.action, id: value.id };
    }

    const rows = await tx.$queryRaw<Row[]>`SELECT id, title, notes, status, "assigneeId", "dueOn", "postId", "createdById", "updatedAt" FROM tasks WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId} FOR UPDATE`;
    const current = rows[0];
    if (!current) throw missing();

    if (value.action === 'task.delete') {
      if (!canRemove(actor.userId, role, current)) throw new OperationError('forbidden', 'You can only delete tasks you created, unless you manage the workspace.');
      const comments = await tx.$executeRaw`DELETE FROM task_comments WHERE "taskId" = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
      const removed = await tx.$executeRaw`DELETE FROM tasks WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
      if (removed !== 1) throw missing();
      await audit(tx, actor, 'tasks.deleted', { taskId: value.id, comments });
      return { ok: true as const, action: value.action, id: value.id };
    }

    if (!canChange(actor.userId, role, current)) throw new OperationError('forbidden', 'You can only change tasks you created or that are assigned to you.');

    if (value.action === 'task.transition') {
      const from = current.status as TaskStatus;
      if (!TASK_TRANSITIONS[from]?.includes(value.status)) throw new OperationError('conflict', 'This task is already in that status. Refresh and check its current status.');
      const changed = await tx.$executeRaw`UPDATE tasks SET status = ${value.status}, "updatedAt" = clock_timestamp() WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId} AND status = ${from}`;
      if (changed !== 1) throw new OperationError('conflict', 'This task changed while you were working. Refresh and try again.');
      await audit(tx, actor, 'tasks.status_changed', { taskId: value.id, from, to: value.status });
      return { ok: true as const, action: value.action, id: value.id };
    }

    // task.update: omitted keys stay, null clears.
    if (value.expectedUpdatedAt && new Date(value.expectedUpdatedAt).getTime() !== new Date(current.updatedAt).getTime()) {
      throw new OperationError('conflict', 'This task changed while you were editing it. Refresh to see the latest version, then repeat your change.');
    }
    const next = {
      title: value.title !== undefined ? text(value.title, bounds.titleMaxCharacters, 'task title', true)! : current.title,
      notes: value.notes !== undefined ? text(value.notes, bounds.notesMaxCharacters, 'task notes', false) : current.notes,
      assigneeId: value.assigneeId !== undefined ? value.assigneeId : current.assigneeId,
      dueOn: value.dueOn !== undefined ? value.dueOn : current.dueOn,
      postId: value.postId !== undefined ? value.postId : current.postId,
    };
    const changedFields = (Object.keys(next) as Array<keyof typeof next>).filter(key => next[key] !== current[key]);
    if (!changedFields.length) throw invalid('Change at least one task field.');
    if (changedFields.includes('assigneeId') && next.assigneeId) await assertAssignable(tx, actor, next.assigneeId);
    if (changedFields.includes('postId') && next.postId) await assertLinkable(tx, visibility, next.postId);
    const changed = await tx.$executeRaw`UPDATE tasks SET title = ${next.title}, notes = ${next.notes}, "assigneeId" = ${next.assigneeId}, "dueOn" = ${next.dueOn}, "postId" = ${next.postId}, "updatedAt" = clock_timestamp() WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId}`;
    if (changed !== 1) throw missing();
    await audit(tx, actor, 'tasks.updated', { taskId: value.id, fields: changedFields, ...(changedFields.includes('assigneeId') ? { assigneeId: next.assigneeId } : {}) });
    return { ok: true as const, action: value.action, id: value.id };
  }, config);
}
