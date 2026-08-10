import { requireAuth } from '@/lib/auth';
import { fail, ok, route } from '@/lib/api';
import { readPostMetrics, syncExternalPostInsights, syncPostInsights } from '@/lib/analytics';

type Context = { params: Promise<{ postTargetId: string }> };

/**
 * Every catalogue metric stored against one post.
 *
 * `?external=true` reads a post that reached the Page without going through
 * this app; the numbers mean the same thing, they just live in a different
 * table. Either way the lookup is scoped by workspace inside the service layer,
 * so an id from another tenant resolves to nothing.
 */
export const GET = route(async (request: Request, context: Context) => {
  const auth = await requireAuth();
  const { postTargetId } = await context.params;
  const external = new URL(request.url).searchParams.get('external') === 'true';

  const result = await readPostMetrics({
    workspaceId: auth.workspace.id,
    ...(external ? { externalPostId: postTargetId } : { postTargetId }),
  });

  return result ? ok(result) : fail('Post not found.', 404);
});

/** Re-read this one post's catalogue from Graph. */
export const POST = route(async (request: Request, context: Context) => {
  const auth = await requireAuth();
  const { postTargetId } = await context.params;
  const external = new URL(request.url).searchParams.get('external') === 'true';

  // Confirm ownership before spending a Graph call on someone else's id.
  const owned = await readPostMetrics({
    workspaceId: auth.workspace.id,
    ...(external ? { externalPostId: postTargetId } : { postTargetId }),
  });
  if (!owned) return fail('Post not found.', 404);

  const result = external
    ? await syncExternalPostInsights(postTargetId)
    : await syncPostInsights(postTargetId);

  return result.ok ? ok(result) : fail(result.error ?? 'Could not read this post.', 400);
});
