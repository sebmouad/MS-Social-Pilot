import { requireAuth } from '@/lib/auth';
import { deleteMedia } from '@/lib/media';
import { fail, ok, route } from '@/lib/api';

/**
 * Remove a file from the library.
 *
 * Editor and above. Uploading is unprivileged because contributors draft posts,
 * but deleting is not the same act: the library is shared, the file leaves the
 * disk, and nothing brings it back.
 */
export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const result = await deleteMedia({
    workspaceId: auth.workspace.id,
    role: auth.role,
    mediaId: id,
  });

  if (result.outcome === 'forbidden') {
    return fail('Only editors and above can delete files from the library.', 403);
  }
  if (result.outcome === 'not_found') return fail('File not found.', 404);
  if (result.outcome === 'in_use') {
    // Named rather than counted alone: "remove it from them first" is only
    // actionable if the reader can find out which posts those are.
    return fail(
      `This file is still used by ${result.posts.length} post(s) that have not gone out yet. Remove it from them first.`,
      409,
      { fields: { posts: result.posts.map((post) => post.id).join(',') } },
    );
  }

  return ok({ ok: true });
});
