import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { deleteStoredFile, postsUsingMedia } from '@/lib/media';
import { fail, ok, route } from '@/lib/api';

export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const media = await prisma.media.findFirst({ where: { id, workspaceId: auth.workspace.id } });
  if (!media) return fail('File not found.', 404);

  // A post's media is a Json array, not a foreign key, so nothing stops this
  // file being deleted out from under a post that has not gone out yet. The
  // failure would surface hours later at publish time as a Graph error nobody
  // could connect back to a deletion.
  const inUse = await postsUsingMedia({
    workspaceId: auth.workspace.id,
    mediaId: media.id,
    storageKey: media.storageKey,
  });

  if (inUse.length > 0) {
    return fail(
      `This file is still used by ${inUse.length} post(s) that have not gone out yet. Remove it from them first.`,
      409,
      { fields: { posts: inUse.map((post) => post.id).join(',') } },
    );
  }

  // Remove the row first: a stale row pointing at a missing file breaks the
  // library UI, whereas an orphaned file on disk is merely wasted space.
  await prisma.media.delete({ where: { id } });
  if (media.storageKey) await deleteStoredFile(media.storageKey);

  return ok({ ok: true });
});
