import { z } from 'zod';
import type { ScopedPermissions } from '@/server/permissions';

/** Provider-neutral task vocabulary shared by the service, API, MCP definitions and UI. */
export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Any move to a different status is allowed (the legacy board allowed it); same-status moves are refused as no-ops. */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  todo: ['doing', 'done'],
  doing: ['todo', 'done'],
  done: ['todo', 'doing'],
};

export const TASK_STATUS_LABELS: Readonly<Record<TaskStatus, string>> = { todo: 'To do', doing: 'In progress', done: 'Done' };

/**
 * Who is acting. `allowedTargetIds` is a resource ceiling carried by a scoped MCP key: it only ever
 * narrows the member's current channel grants. Absent means no ceiling.
 */
export type TasksActor = {
  userId: string; workspaceId: string; allowedTargetIds?: readonly string[];
  /**
   * Deny-only feature ceiling from a scoped MCP key (its key-clamped permissions). It is intersected with the
   * member's current grants for Tasks and for the Publishing posts used by linked-post previews; it never grants.
   */
  permissionCeiling?: ScopedPermissions;
};
/** Result-size ceiling from the MCP key or Root; services never return more than this in one page. */
export type TasksReadOptions = { maxItems?: number };

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value);
}, 'Choose a real calendar date.');
const dueOn = calendarDay;

/** Text limits come from Root configuration, so the shared schema only bounds the shape. */
const text = z.string().max(20000);

export const TASK_ACTION_SCHEMA = z.discriminatedUnion('action', [
  z.object({ action: z.literal('task.create'), confirmation: z.string(), title: text, notes: text.nullish(), assigneeId: identifier.nullish(), dueOn: dueOn.nullish(), postId: identifier.nullish() }).strict(),
  /** `expectedUpdatedAt` (the value the editor loaded) turns a lost update into a conflict instead of an overwrite. */
  z.object({ action: z.literal('task.update'), confirmation: z.string(), id: identifier, title: text.optional(), notes: text.nullish(), assigneeId: identifier.nullish(), dueOn: dueOn.nullish(), postId: identifier.nullish(), expectedUpdatedAt: z.string().datetime().optional() }).strict(),
  z.object({ action: z.literal('task.transition'), confirmation: z.string(), id: identifier, status: z.enum(TASK_STATUSES) }).strict(),
  z.object({ action: z.literal('task.delete'), id: identifier, confirmation: z.string().max(400) }).strict(),
  /** A checklist: every line becomes a task in one atomic write; due dates start at `startOn` and advance `gapDays` per line. */
  z.object({ action: z.literal('task.createMany'), confirmation: z.string(), titles: z.array(text).min(1).max(1000), assigneeId: identifier.nullish(), startOn: calendarDay.nullish(), gapDays: z.number().int().min(0).max(3650).default(1) }).strict(),
  z.object({ action: z.literal('comment.add'), confirmation: z.string(), taskId: identifier, body: text }).strict(),
  z.object({ action: z.literal('comment.delete'), id: identifier, confirmation: z.string().max(400) }).strict(),
  /** Per-task checklist items: small ordered steps with their own done state, written through the same confirmed service. */
  z.object({ action: z.literal('checklist.add'), confirmation: z.string(), taskId: identifier, text }).strict(),
  z.object({ action: z.literal('checklist.set'), confirmation: z.string(), id: identifier, done: z.boolean() }).strict(),
  z.object({ action: z.literal('checklist.delete'), id: identifier, confirmation: z.string().max(400) }).strict(),
]);
export type TaskAction = z.infer<typeof TASK_ACTION_SCHEMA>;

export const TASK_FILTER_SCHEMA = z.object({
  status: z.enum(TASK_STATUSES).optional(),
  /** `me`, `none` (unassigned) or a member id. */
  assignee: z.union([z.literal('me'), z.literal('none'), identifier]).optional(),
  overdue: z.boolean().optional(),
  q: z.string().trim().max(200).optional(),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(1000).optional(),
  /** Shared sidebar channel scope: a display filter only; the service still authorizes every row. */
  channelIds: z.array(identifier).max(500).optional(),
}).strict();
export type TaskFilters = z.infer<typeof TASK_FILTER_SCHEMA>;

export const TASK_POST_CHOICE_SCHEMA = z.object({
  q: z.string().trim().max(200).optional(),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  channelIds: z.array(identifier).max(500).optional(),
}).strict();

export const taskConfirmations = {
  delete: (id: string) => `DELETE TASK ${id}`,
  deleteComment: (id: string) => `DELETE TASK COMMENT ${id}`,
  /** Shared write confirmations; customer controls send these without exposing protocol commands. */
  create: (title: string) => `CREATE TASK ${title.trim()}`,
  createMany: (count: number) => `CREATE ${count} TASKS`,
  update: (id: string) => `UPDATE TASK ${id}`,
  transition: (id: string, status: TaskStatus) => `MOVE TASK ${id} TO ${status}`,
  comment: (taskId: string) => `COMMENT ON TASK ${taskId}`,
  checklistAdd: (taskId: string) => `ADD CHECKLIST ITEM ${taskId}`,
  checklistSet: (id: string) => `SET CHECKLIST ITEM ${id}`,
  checklistDelete: (id: string) => `DELETE CHECKLIST ITEM ${id}`,
};

/** `YYYY-MM-DD` plus whole days, calendar arithmetic only (no time zone). Returns null outside years 0001-9999. */
export function addCalendarDays(day: string, days: number): string | null {
  const base = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(base.getTime())) return null;
  const next = new Date(base.getTime() + days * 86_400_000);
  const year = next.getUTCFullYear();
  return year >= 1 && year <= 9999 ? next.toISOString().slice(0, 10) : null;
}

export type TaskView = {
  id: string; title: string; notes: string | null; status: TaskStatus;
  assignee: { id: string; name: string } | null; dueOn: string | null; overdue: boolean;
  /** Present only when the viewer may see the linked post. */
  post: { id: string; preview: string; status: string } | null;
  /** True when a post is linked but is outside this viewer's access; its details are never sent. */
  postHidden: boolean;
  createdBy: { id: string; name: string } | null; createdAt: string; updatedAt: string;
  commentCount: number;
  /** Done/total checklist items; the items themselves come from get_task. */
  checklist: { done: number; total: number };
  canEdit: boolean; canDelete: boolean;
};
export type TaskCommentView = { id: string; author: { id: string; name: string } | null; body: string; createdAt: string; canDelete: boolean };
export type TaskChecklistItemView = { id: string; text: string; done: boolean; position: number; createdAt: string; canChange: boolean };
export type TaskLimits = { titleMaxCharacters: number; notesMaxCharacters: number; commentMaxCharacters: number; pageLimit: number; workflowRowLimit: number; workflowGapMaxDays: number; checklistLimit: number; checklistItemMaxCharacters: number };
export const TASK_DEFAULT_LIMITS: TaskLimits = { titleMaxCharacters: 200, notesMaxCharacters: 2000, commentMaxCharacters: 2000, pageLimit: 100, workflowRowLimit: 30, workflowGapMaxDays: 30, checklistLimit: 30, checklistItemMaxCharacters: 280 };
export type TaskSummary = { todo: number; doing: number; done: number; overdue: number };
export type TaskPostChoice = { id: string; preview: string; status: string };
