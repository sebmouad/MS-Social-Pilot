import { ok, readJson, route } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { deleteTask, updateTask } from '@/lib/tasks';

type Context = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await updateTask(auth.workspace.id, id, await readJson(request));
  return ok({ ok: true });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireAuth();
  const { id } = await context.params;
  await deleteTask(auth.workspace.id, id);
  return ok({ ok: true });
});
