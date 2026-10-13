import { ok, readJson, route } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { createTask, listTasks } from '@/lib/tasks';

export const GET = route(async () => {
  const auth = await requireAuth();
  return ok({ tasks: await listTasks(auth.workspace.id) });
});

export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const task = await createTask(auth.workspace.id, auth.user.id, await readJson(request));
  return ok({ task }, 201);
});
