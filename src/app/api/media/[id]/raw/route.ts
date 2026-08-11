import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { openStoredFile } from '@/lib/media';
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

  // Streamed rather than read into memory: uploads run to tens of megabytes,
  // and a few people opening the media library at once should not each cost a
  // whole video's worth of heap.
  const file = await openStoredFile(media.storageKey);

  return new NextResponse(file.body, {
    headers: {
      'content-type': media.mimeType || 'application/octet-stream',
      // The stored type is verified against the bytes on upload, and this stops
      // a browser second-guessing it anyway.
      'x-content-type-options': 'nosniff',
      'content-length': String(file.size),
      'cache-control': 'private, max-age=3600',
      'content-disposition': `inline; filename="${encodeURIComponent(media.filename)}"`,
    },
  });
});
