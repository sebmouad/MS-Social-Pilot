import { requireApiToken } from '@/lib/api-tokens';
import { apiPageAnalytics } from '@/lib/public-api';
import { ok, route } from '@/lib/api';

/** How a Page is doing over the last `days` (30 by default). */
export const GET = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const ctx = await requireApiToken(request);
  const { id } = await context.params;
  const url = new URL(request.url);
  return ok(await apiPageAnalytics(ctx, id, Object.fromEntries(url.searchParams)));
});
