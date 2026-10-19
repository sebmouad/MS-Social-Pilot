import { z } from 'zod';
import { OperationError } from '@/lib/operation-error';
import { TASK_STATUSES, taskConfirmations, type TasksActor } from './tasks';
import { TASKS_TOOL_ACCESS, TASKS_FEATURE_ID } from './semantics';
import { pageIdsFor, type McpToolGroup } from '@/server/mcp/kit';
import { getTask, listTaskPostChoices, listTasks, performTaskAction } from './server/tasks';

const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$' };
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });

export const tasksTools = new Set(Object.keys(TASKS_TOOL_ACCESS));
export const tasksWriteTools = new Set(Object.entries(TASKS_TOOL_ACCESS).filter(([, access]) => access === 'write').map(([name]) => name));
export const TASKS_DEFAULT_RESULT_CEILING = 100;

export const tasksToolDefinitions = [
  { name: 'list_tasks', description: 'List workspace tasks with optional status, assignee, overdue and text filters, plus per-status counts. Results are paged: continue with offset while hasMore is true. Linked posts you cannot access are reported as hidden, never described.', inputSchema: { type: 'object', properties: { status: { type: 'string', enum: [...TASK_STATUSES] }, assignee: { type: 'string', description: 'A member id, "me" or "none".' }, overdue: { type: 'boolean' }, q: { type: 'string', maxLength: 200 }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 1000 } }, additionalProperties: false } },
  { name: 'get_task', description: 'Read one task with a page of its comments. Continue long threads with commentOffset while commentsHasMore is true.', inputSchema: { type: 'object', required: ['id'], properties: { id, commentOffset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
  { name: 'list_task_post_choices', description: 'Page through posts you may link to a task, optionally filtered by text. Posts outside your channel access are not listed.', inputSchema: { type: 'object', properties: { q: { type: 'string', maxLength: 200 }, offset: { type: 'integer', minimum: 0 } }, additionalProperties: false } },
  { name: 'create_task', description: 'Create a task. Confirmation: CREATE TASK <title>.', inputSchema: { type: 'object', required: ['title', 'confirmation'], properties: { title: { type: 'string' }, notes: nullable({ type: 'string' }), assigneeId: nullable(id), dueOn: nullable(date), postId: nullable(id), confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'create_task_checklist', description: 'Create several tasks at once, all or none. Due dates start at startOn and advance gapDays per line. Confirmation: CREATE <count> TASKS.', inputSchema: { type: 'object', required: ['titles', 'confirmation'], properties: { titles: { type: 'array', minItems: 1, maxItems: 1000, items: { type: 'string' } }, assigneeId: nullable(id), startOn: nullable(date), gapDays: { type: 'integer', minimum: 0 }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'update_task', description: 'Change a task title, notes, assignee, due date or linked post (null clears). Pass expectedUpdatedAt from get_task to refuse the change if someone else edited the task meanwhile. Confirmation: UPDATE TASK <id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id, title: { type: 'string' }, notes: nullable({ type: 'string' }), assigneeId: nullable(id), dueOn: nullable(date), postId: nullable(id), expectedUpdatedAt: { type: 'string', format: 'date-time' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'move_task', description: 'Move a task to another status. Confirmation: MOVE TASK <id> TO <status>.', inputSchema: { type: 'object', required: ['id', 'status', 'confirmation'], properties: { id, status: { type: 'string', enum: [...TASK_STATUSES] }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_task', description: 'Delete a task and its comments. Confirmation: DELETE TASK <id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'add_task_comment', description: 'Add a comment to a task. Confirmation: COMMENT ON TASK <taskId>. Comment text is not written to audit records.', inputSchema: { type: 'object', required: ['taskId', 'body', 'confirmation'], properties: { taskId: id, body: { type: 'string' }, confirmation: { type: 'string' } }, additionalProperties: false } },
  { name: 'delete_task_comment', description: 'Delete your comment, or any comment as an owner/admin. Confirmation: DELETE TASK COMMENT <id>.', inputSchema: { type: 'object', required: ['id', 'confirmation'], properties: { id, confirmation: { type: 'string' } }, additionalProperties: false } },
];

function confirmed(args: Record<string, unknown>, expected: string) {
  if (args.confirmation !== expected) throw new OperationError('invalid_request', `Confirmation must be exactly: ${expected}`);
}

/**
 * Run one Tasks tool. `actor.allowedTargetIds` is the key's channel ceiling and `ceiling` its result-size limit;
 * both reach the services, which intersect them with the member's current access on every call.
 */
export async function executeTasksTool(actor: TasksActor, name: string, args: Record<string, unknown>, ceiling: number = TASKS_DEFAULT_RESULT_CEILING) {
  const options = { maxItems: ceiling };
  if (name === 'list_tasks') {
    const checked = z.object({ status: z.enum(TASK_STATUSES).optional(), assignee: z.string().max(200).optional(), overdue: z.boolean().optional(), q: z.string().max(200).optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(1000).optional() }).strict().safeParse(args);
    if (!checked.success) throw new OperationError('invalid_request', 'Choose valid task filters.');
    return listTasks(actor, checked.data, options);
  }
  if (name === 'get_task') {
    const checked = z.object({ id: z.string().max(200), commentOffset: z.number().int().min(0).optional() }).strict().safeParse(args);
    if (!checked.success) throw new OperationError('invalid_request', 'Choose a valid task.');
    return getTask(actor, checked.data.id, { ...options, ...(checked.data.commentOffset === undefined ? {} : { commentOffset: checked.data.commentOffset }) });
  }
  if (name === 'list_task_post_choices') return listTaskPostChoices(actor, args, options);
  const { confirmation: _confirmation, ...rest } = args;
  void _confirmation;
  switch (name) {
    case 'create_task': confirmed(args, taskConfirmations.create(String(args.title ?? ''))); return performTaskAction(actor, { ...rest, action: 'task.create' });
    case 'create_task_checklist': {
      const count = Array.isArray(args.titles) ? args.titles.length : 0;
      confirmed(args, taskConfirmations.createMany(count));
      return performTaskAction(actor, { ...rest, action: 'task.createMany' }, options);
    }
    case 'update_task': confirmed(args, taskConfirmations.update(String(args.id ?? ''))); return performTaskAction(actor, { ...rest, action: 'task.update' });
    case 'move_task': confirmed(args, taskConfirmations.transition(String(args.id ?? ''), args.status as never)); return performTaskAction(actor, { ...rest, action: 'task.transition' });
    case 'delete_task': return performTaskAction(actor, { ...args, action: 'task.delete' });
    case 'add_task_comment': confirmed(args, taskConfirmations.comment(String(args.taskId ?? ''))); return performTaskAction(actor, { ...rest, action: 'comment.add' });
    case 'delete_task_comment': return performTaskAction(actor, { ...args, action: 'comment.delete' });
    default: throw new OperationError('invalid_request', 'Unknown task action.');
  }
}

/** MCP tool groups this module installs. The host merges installed groups; edit only here. */
export const TASKS_MCP: readonly McpToolGroup[] = [
  {
    id: 'tasks',
    tools: tasksToolDefinitions,
    features: {
      list_tasks: 'tasks/board',
      get_task: 'tasks/board',
      list_task_post_choices: 'tasks/board',
      create_task: 'tasks/board',
      create_task_checklist: 'tasks/board',
      update_task: 'tasks/board',
      move_task: 'tasks/board',
      delete_task: 'tasks/board',
      add_task_comment: 'tasks/board',
      delete_task_comment: 'tasks/board',
    },
    writeTools: ['create_task', 'create_task_checklist', 'update_task', 'move_task', 'delete_task', 'add_task_comment', 'delete_task_comment'],
    selfLockedWrites: ['create_task', 'create_task_checklist', 'update_task', 'move_task', 'delete_task', 'add_task_comment', 'delete_task_comment'],
    scope: { resourceTools: ['list_task_post_choices'], workspaceTools: ['list_tasks', 'get_task', 'create_task', 'create_task_checklist', 'update_task', 'move_task', 'delete_task', 'add_task_comment', 'delete_task_comment'] },
    resources: [
      { uri: 'msp://tasks', name: "Tasks", description: "First bounded page of workspace tasks with status counts. Continue pages with list_tasks.", mimeType: 'application/json', feature: TASKS_FEATURE_ID, readTool: 'list_tasks' },
    ],
    execute: (viewer, name, args, cap) => executeTasksTool({ userId: viewer.userId, workspaceId: viewer.workspaceId, allowedTargetIds: pageIdsFor(viewer), ...(viewer.permissions ? { permissionCeiling: viewer.permissions } : {}) }, name, args, cap),
  },
];
