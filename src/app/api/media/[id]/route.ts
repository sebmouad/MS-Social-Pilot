import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { deleteStoredFile } from '@/lib/media';
import { fail, ok, route } from '@/lib/api';

export const DELETE = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const media = await prisma.media.findFirst({ where: { id, workspaceId: auth.workspace.id } });
  if (!media) return fail('File not found.', 404);

  // Remove the row first: a stale row pointing at a missing file breaks the
  // library UI, whereas an orphaned file on disk is merely wasted space.
  await prisma.media.delete({ where: { id } });
  if (media.storageKey) await deleteStoredFile(media.storageKey);

  return ok({ ok: true });
});
