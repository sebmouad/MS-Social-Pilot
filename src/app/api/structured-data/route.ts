import { z } from 'zod';

import { ok, readJson, route } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { fetchStructuredData } from '@/lib/structured-data-fetch';

const schema = z.object({ url: z.string().trim().min(1).max(2000) });

/** What a page says about itself in schema.org JSON-LD. */
export const POST = route(async (request: Request) => {
  await requireAuth();
  const { url } = schema.parse(await readJson(request));
  return ok({ items: await fetchStructuredData(url) });
});
