import { ok, readJson, route } from '@/lib/api';
import { requireAuth, requireCapability } from '@/lib/auth';
import { canManageSettings } from '@/lib/constants';
import { createCustomField, listCustomFields } from '@/lib/custom-fields';

export const GET = route(async () => {
  const auth = await requireAuth();
  return ok({ fields: await listCustomFields(auth.workspace.id) });
});

export const POST = route(async (request: Request) => {
  const auth = await requireCapability(canManageSettings);
  const field = await createCustomField(auth.workspace.id, await readJson(request));
  return ok({ field }, 201);
});
