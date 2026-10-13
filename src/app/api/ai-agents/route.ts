import { ok, readJson, route } from '@/lib/api';
import { requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { createAgent, listAgents } from '@/lib/ai-agents';

export const GET = route(async () => {
  const auth = await requireCapability(canManageSettings);
  return ok({ agents: await listAgents(auth.workspace.id) });
});

export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  const agent = await createAgent(auth.workspace.id, auth.user.id, await readJson(request));
  return ok({ agent }, 201);
});
