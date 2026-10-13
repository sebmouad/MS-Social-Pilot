import { z } from 'zod';

import { errors } from './errors';
import { prisma } from './prisma';

/** Team tasks: a small board of who does what by when. */

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullish(),
  assigneeId: z.string().min(1).nullish(),
  dueOn: day.nullish(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  notes: z.string().trim().max(2000).nullish(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: z.string().min(1).nullish(),
  dueOn: day.nullish(),
});

/** Only someone on the workspace's team can be given a task. */
async function assertAssignable(workspaceId: string, userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const member = await prisma.membership.findFirst({ where: { workspaceId, userId, role: { not: 'client' } }, select: { id: true } });
  if (!member) throw errors.notFound();
}

export async function listTasks(workspaceId: string) {
  return prisma.task.findMany({ where: { workspaceId }, orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] });
}

export async function createTask(workspaceId: string, createdById: string, raw: unknown) {
  const input = createTaskSchema.parse(raw);
  await assertAssignable(workspaceId, input.assigneeId);
  return prisma.task.create({
    data: { workspaceId, createdById, title: input.title, notes: input.notes ?? null, assigneeId: input.assigneeId ?? null, dueOn: input.dueOn ?? null },
  });
}

export async function updateTask(workspaceId: string, id: string, raw: unknown) {
  const input = updateTaskSchema.parse(raw);
  await assertAssignable(workspaceId, input.assigneeId);
  const { count } = await prisma.task.updateMany({ where: { id, workspaceId }, data: input });
  if (count === 0) throw errors.notFound();
}

export async function deleteTask(workspaceId: string, id: string) {
  const { count } = await prisma.task.deleteMany({ where: { id, workspaceId } });
  if (count === 0) throw errors.notFound();
}
