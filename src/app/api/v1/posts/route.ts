import { requireApiToken } from '@/lib/api-tokens';
import { apiCreatePost, apiListPosts } from '@/lib/public-api';
import { ok, readJson, route } from '@/lib/api';

/** Posts, newest first. `?status=scheduled&from=…&to=…&limit=50` */
export const GET = route(async (request: Request) => {
  const ctx = await requireApiToken(request);
  const url = new URL(request.url);
  return ok({ posts: await apiListPosts(ctx, Object.fromEntries(url.searchParams)) });
});

/** Create a post: the same body as the composer sends, under the same rules. Needs a `write` key. */
export const POST = route(async (request: Request) => {
  const ctx = await requireApiToken(request, 'write');
  return ok(await apiCreatePost(ctx, await readJson(request)), 201);
});
