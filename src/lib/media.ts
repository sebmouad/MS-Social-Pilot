import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import { env } from './env';
import type { PostMedia } from './json';
import type { ResolvedMedia } from './facebook/publish';
import type { MediaKind } from './constants';

/**
 * Media storage.
 *
 * Files live on local disk under MEDIA_DIR and are served back through an
 * authenticated route, never as static files. That matters because Facebook is
 * not the only consumer: a customer's unpublished campaign artwork should not
 * be guessable at a public URL before the post goes live.
 *
 * Consequence for publishing: because our URLs require a session cookie,
 * Facebook cannot fetch them. Locally stored media is therefore streamed to
 * Graph as multipart binary; only externally hosted media uses url-based
 * upload. See `resolveMediaForPublish`.
 */

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/x-m4v']);

export class MediaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

export function kindForMimeType(mimeType: string): MediaKind {
  const normalized = mimeType.toLowerCase();
  if (IMAGE_TYPES.has(normalized)) return 'image';
  if (VIDEO_TYPES.has(normalized)) return 'video';
  throw new MediaError(
    `Unsupported file type "${mimeType}". Upload a JPEG, PNG, GIF, WebP or MP4 file.`,
  );
}

function mediaRoot(): string {
  return path.resolve(process.cwd(), env.mediaDir);
}

/**
 * Resolve a storage key to an absolute path, refusing anything that escapes
 * the media root. The key comes from the database, but a path traversal bug
 * here would read arbitrary server files, so it is checked regardless.
 */
export function resolveStoragePath(storageKey: string): string {
  const root = mediaRoot();
  const resolved = path.resolve(root, storageKey);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new MediaError('Invalid media path.');
  }
  return resolved;
}

export interface StoredFile {
  storageKey: string;
  kind: MediaKind;
  size: number;
  checksum: string;
}

export async function storeFile(options: {
  workspaceId: string;
  data: Buffer;
  mimeType: string;
  originalName: string;
}): Promise<StoredFile> {
  if (options.data.byteLength > env.maxUploadBytes) {
    const limitMb = Math.round(env.maxUploadBytes / (1024 * 1024));
    throw new MediaError(`That file is larger than the ${limitMb} MB limit.`);
  }

  const kind = kindForMimeType(options.mimeType);
  const extension = path.extname(options.originalName).toLowerCase().slice(0, 10) || defaultExtension(options.mimeType);
  // Workspace-scoped directories keep tenants separated on disk and keep any
  // single directory from growing to an unmanageable number of entries.
  const storageKey = path.join(options.workspaceId, `${randomUUID()}${extension}`);
  const destination = resolveStoragePath(storageKey);

  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, options.data);

  return {
    storageKey,
    kind,
    size: options.data.byteLength,
    checksum: createHash('sha256').update(options.data).digest('hex'),
  };
}

function defaultExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'video/quicktime': '.mov',
  };
  return map[mimeType.toLowerCase()] ?? '.bin';
}

export async function readStoredFile(storageKey: string): Promise<Buffer> {
  return readFile(resolveStoragePath(storageKey));
}

export async function deleteStoredFile(storageKey: string): Promise<void> {
  try {
    await unlink(resolveStoragePath(storageKey));
  } catch (error) {
    // Already gone is a success for our purposes.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

/**
 * Turn stored attachments into something {@link publishPost} can send.
 *
 * Locally stored files are read into memory and uploaded as binary. Remote
 * URLs are handed to Facebook to fetch, which is faster and avoids proxying
 * large files through this server.
 */
export async function resolveMediaForPublish(media: PostMedia[]): Promise<ResolvedMedia[]> {
  const resolved: ResolvedMedia[] = [];

  for (const item of media) {
    if (item.storageKey) {
      const data = await readStoredFile(item.storageKey);
      resolved.push({
        kind: item.kind,
        source: {
          type: 'binary',
          data,
          filename: path.basename(item.storageKey),
          contentType: item.mimeType ?? (item.kind === 'image' ? 'image/jpeg' : 'video/mp4'),
        },
      });
      continue;
    }

    if (!/^https?:\/\//i.test(item.url)) {
      throw new MediaError(`Attachment ${item.id} has no file on disk and no public URL.`);
    }
    resolved.push({ kind: item.kind, source: { type: 'url', url: item.url } });
  }

  return resolved;
}

export function contentTypeFor(kind: MediaKind, mimeType?: string): string {
  if (mimeType) return mimeType;
  return kind === 'image' ? 'image/jpeg' : 'video/mp4';
}
