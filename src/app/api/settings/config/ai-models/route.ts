import { requireAuth } from '@/lib/auth';
import { canManageInstance } from '@/lib/constants';
import { listAiModels } from '@/lib/ai-models';
import { priceFor } from '@/lib/ai-prices';
import { env } from '@/lib/env';
import { ok, route } from '@/lib/api';
import { errors } from '@/lib/errors';

/** The models the configured AI key can use, fetched from the provider, with their price when known. Root only. */
export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  if (!canManageInstance(auth)) throw errors.ownerOnlyViewConfig();

  const refresh = new URL(request.url).searchParams.get('refresh') === '1';
  try {
    const models = await listAiModels({ refresh });
    const overrides = env.aiPriceOverrides;
    return ok({
      models: models.map((model) => ({ ...model, price: priceFor(model.id, overrides) })),
      error: null,
    });
  } catch (error) {
    const status = (error as { status?: number }).status;
    return ok({ models: [], error: status === 400 || status === 401 || status === 403 ? 'keyRejected' : 'unreachable' });
  }
});
