/**
 * The photo an alt text is asked for (H5), ready for the AI: only pictures
 * this workspace uploaded, read from storage (never a URL fetched on request),
 * shrunk to a small JPEG so the request stays cheap.
 */
import sharp from 'sharp';

import { prisma } from './prisma';
import { readStoredFile } from './media';
import { errors } from './errors';

/** Long side, in pixels: enough to tell what a photo shows. */
const MAX_SIDE = 1024;

export async function altTextImage(workspaceId: string, mediaId: string): Promise<{ data: string; mimeType: 'image/jpeg' }> {
  const media = await prisma.media.findFirst({
    where: { id: mediaId, workspaceId, kind: 'image' },
    select: { storageKey: true },
  });
  if (!media?.storageKey) throw errors.fileNotFound();
  const bytes = await readStoredFile(media.storageKey).catch(() => null);
  if (!bytes) throw errors.fileNotFound();
  const jpeg = await sharp(bytes)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { data: jpeg.toString('base64'), mimeType: 'image/jpeg' };
}
