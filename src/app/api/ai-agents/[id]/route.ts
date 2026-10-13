import { ok, readJson, route } from '@/lib/api';
import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { deleteAgent, updateAgent } from '@/lib/ai-agents';

type Context = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  await updateAgent(auth.workspace.id, id, await readJson(request));
  return ok({ ok: true });
});

export const DELETE = route(async (_request: Request, context: Context) => {
  const auth = await requireCapability(canManageSettings);
  const { id } = await context.params;
  await deleteAgent(auth.workspace.id, id);
  return ok({ ok: true });
});
