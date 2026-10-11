import { requireApiToken } from '@/lib/api-tokens';
import { apiListPages } from '@/lib/public-api';
import { ok, route } from '@/lib/api';

/** The Pages this key may use. `GET /api/v1/pages` */
export const GET = route(async (request: Request) => {
  const ctx = await requireApiToken(request);
  return ok({ pages: await apiListPages(ctx) });
});
