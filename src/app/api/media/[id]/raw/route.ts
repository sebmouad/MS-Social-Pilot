import { NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { openStoredFile } from '@/lib/media';
import { verifyMediaUrl } from '@/lib/media-links';
import { fail, route } from '@/lib/api';

/**
 * Serve an uploaded file.
 *
 * Two ways in. Normally the requester's session decides, checked against the
 * workspace on every read — which is why uploads are not written into /public:
 * unpublished campaign artwork should not be fetchable by anyone who guesses
 * the filename.
 *
 * The exception is a signed link. Instagram's publishing API takes no bytes:
 * Facebook's servers fetch the file themselves, with no cookie to present. A
 * link minted for that fetch names one file, expires in minutes, and is signed
 * — so it grants exactly the read it was made for and nothing else. See
 * `src/lib/media-links.ts`.
 */
export const GET = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const signed = verifyMediaUrl(id, new URL(request.url).searchParams);

  // The signature already names the file, so it stands in for the workspace
  // check rather than skipping it: it cannot be presented for a different one.
  const media = signed
    ? await prisma.media.findUnique({ where: { id } })
    : await prisma.media.findFirst({
        where: { id, workspaceId: (await requireAuth()).workspace.id },
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
      // Never a shared cache: the signature expires and the file does not.
      'cache-control': 'private, max-age=3600',
      'content-disposition': `inline; filename="${encodeURIComponent(media.filename)}"`,
    },
  });
});
