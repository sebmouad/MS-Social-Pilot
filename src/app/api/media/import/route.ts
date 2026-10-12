import { z } from 'zod';

import { ok, readJson, route } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { importImages, MAX_IMPORT_IMAGES } from '@/lib/structured-data-fetch';

const schema = z.object({ urls: z.array(z.string().trim().min(1).max(2000)).min(1).max(MAX_IMPORT_IMAGES) });

/**
 * Copy pictures from the web into the media library (NEXT_PHASES H3). Open to
 * every member, as uploading is; the media quota bounds it.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const { urls } = schema.parse(await readJson(request));
  return ok(await importImages(auth.workspace.id, urls));
});
