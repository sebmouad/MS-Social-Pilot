import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { readStoredFile } from '@/lib/media';
import { fail, route } from '@/lib/api';

/**
 * Serve an uploaded file.
 *
 * Access is checked against the requester's workspace on every read, which is
 * why uploads are not written into /public: unpublished campaign artwork
 * should not be fetchable by anyone who guesses the filename.
 */
export const GET = route(async (_request: Request, context: { params: Promise<{ id: string }> }) => {
  const auth = await requireAuth();
  const { id } = await context.params;

  const media = await prisma.media.findFirst({
    where: { id, workspaceId: auth.workspace.id },
  });
  if (!media?.storageKey) return fail('File not found.', 404);

  const data = await readStoredFile(media.storageKey);

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'content-type': media.mimeType || 'application/octet-stream',
      'content-length': String(data.byteLength),
      'cache-control': 'private, max-age=3600',
      'content-disposition': `inline; filename="${encodeURIComponent(media.filename)}"`,
    },
  });
});
