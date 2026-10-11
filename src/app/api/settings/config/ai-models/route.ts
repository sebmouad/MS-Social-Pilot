import { requireAuth } from '@/lib/auth';
import { canManageInstance } from '@/lib/constants';
import { listAiModels } from '@/lib/ai-models';
import { ok, route } from '@/lib/api';
import { errors } from '@/lib/errors';

/** The models the configured AI key can use, fetched from the provider. Root only. */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  if (!canManageInstance(auth)) throw errors.ownerOnlyViewConfig();

  const refresh = new URL(request.url).searchParams.get('refresh') === '1';
  try {
    return ok({ models: await listAiModels({ refresh }), error: null });
  } catch (error) {
    const status = (error as { status?: number }).status;
    return ok({ models: [], error: status === 400 || status === 401 || status === 403 ? 'keyRejected' : 'unreachable' });
  }
});
