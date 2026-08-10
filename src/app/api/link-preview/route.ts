import { requireAuth } from '@/lib/auth';
import { assertSafePreviewUrl, resolveLinkPreview, scrapeWithFacebook } from '@/lib/facebook/opengraph';
import { linkPreviewSchema } from '@/lib/validation';
import { fail, ok, readJson, route } from '@/lib/api';

/**
 * Fetch the Open Graph card for a URL.
 *
 * `refresh: true` forces Facebook to re-scrape, which is the documented fix
 * for "my link preview shows the old title" — Facebook caches aggressively and
 * will otherwise reuse whatever it saw the first time the URL was shared.
 */
export const POST = route(async (request: Request) => {
  await requireAuth();
  const input = linkPreviewSchema.parse(await readJson(request));

  try {
    assertSafePreviewUrl(input.url);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'That URL cannot be previewed.', 400);
  }

  const preview = input.refresh
    ? await scrapeWithFacebook(input.url)
    : await resolveLinkPreview(input.url);

  return ok({ preview });
});
