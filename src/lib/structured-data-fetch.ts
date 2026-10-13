import path from 'node:path';

import { env } from './env';
import { errors } from './errors';
import { assertSafePreviewUrl } from './facebook/opengraph';
import type { PostMedia } from './json';
import { MediaError, storageUsage, storeFile } from './media';
import { prisma } from './prisma';
import { fetchPublic, readCapped, readCappedBytes } from './safe-fetch';
import { parseStructuredData, type StructuredItem } from './structured-data';

/**
 * The server half of posts from structured data: fetch a page for its JSON-LD, and copy
 * the pictures a template uses into the media library, so they publish like
 * any upload. Both fetch user-supplied addresses, through `fetchPublic`.
 */

const FETCH_TIMEOUT_MS = 10_000;
/** JSON-LD often sits at the end of the body, so more than the head is read. */
const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_IMAGES = 10;

export async function fetchStructuredData(url: string): Promise<StructuredItem[]> {
  assertSafePreviewUrl(url);
  try {
    const response = await fetchPublic(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'MS-Social-Pilot (+structured data)', accept: 'text/html,application/xhtml+xml' },
    });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('html')) {
      await response.body?.cancel().catch(() => undefined);
      return [];
    }
    return parseStructuredData(await readCapped(response, MAX_HTML_BYTES), response.url || url);
  } catch {
    return [];
  }
}

function filenameOf(url: string): string {
  try {
    const base = path.posix.basename(new URL(url).pathname);
    return base && base !== '/' ? decodeURIComponent(base).slice(0, 120) : 'image';
  } catch {
    return 'image';
  }
}

/**
 * Copy pictures into the workspace library. Each one that cannot be had is
 * named in `problems` rather than failing the rest; the quota is respected.
 */
export async function importImages(workspaceId: string, urls: string[]): Promise<{ media: PostMedia[]; problems: string[] }> {
  const media: PostMedia[] = [];
  const problems: string[] = [];
  const usage = await storageUsage(workspaceId);
  const quotaBytes = usage.quotaBytes;
  let bytes = usage.bytes;

  for (const url of urls.slice(0, MAX_IMPORT_IMAGES)) {
    const name = filenameOf(url);
    try {
      assertSafePreviewUrl(url);
      const response = await fetchPublic(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: 'image/*' } });
      const mimeType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (!response.ok || !mimeType.startsWith('image/')) {
        await response.body?.cancel().catch(() => undefined);
        problems.push(`${name}: ${response.ok ? 'not a picture' : `answered ${response.status}`}`);
        continue;
      }
      const data = Buffer.from(await readCappedBytes(response, env.maxUploadBytes + 1));
      if (data.byteLength > env.maxUploadBytes) throw errors.fileTooLarge(Math.round(env.maxUploadBytes / (1024 * 1024)));
      if (bytes + data.byteLength > quotaBytes) {
        throw errors.quotaFull(Math.round(quotaBytes / (1024 * 1024)), Math.round(bytes / (1024 * 1024)));
      }
      const stored = await storeFile({ workspaceId, data, mimeType, originalName: name });
      bytes += stored.size;
      const row = await prisma.media.create({
        data: { workspaceId, filename: name, mimeType, size: stored.size, kind: stored.kind, storageKey: stored.storageKey, url: '' },
      });
      const saved = await prisma.media.update({ where: { id: row.id }, data: { url: `/api/media/${row.id}/raw` } });
      media.push({ id: saved.id, kind: saved.kind as PostMedia['kind'], url: saved.url, storageKey: saved.storageKey ?? undefined, mimeType: saved.mimeType ?? undefined });
    } catch (error) {
      problems.push(`${name}: ${error instanceof MediaError || error instanceof Error ? error.message : 'could not be copied'}`);
    }
  }
  return { media, problems };
}
