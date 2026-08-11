import { mkdir, readFile, stat, writeFile, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import { env } from './env';
import { prisma } from './prisma';
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

  // The bytes decide. A file whose contents do not match what it says it is
  // gets rejected now rather than at publish time, when the same problem
  // arrives as a Graph error about an unsupported file.
  const actual = sniffMimeType(options.data);
  if (!actual) {
    throw new MediaError(
      'That file is not a JPEG, PNG, GIF, WebP or MP4. Convert it and upload again.',
    );
  }
  if (kindForMimeType(actual) !== kind) {
    throw new MediaError(
      `That file is named as ${options.mimeType} but its contents are ${actual}.`,
    );
  }

  // The extension follows the verified type, never the uploader's filename:
  // the name is theirs to choose, and the file it produces on disk is not.
  const extension = defaultExtension(actual);
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

/**
 * What the bytes actually are, from the handful of signatures we accept.
 *
 * The declared type is whatever the browser was told to send, so it is a claim
 * rather than a fact. Checking it matters in both directions: a file that is
 * not really an image is rejected here instead of at publish time, where the
 * failure arrives as a Graph error nobody can act on — and a file stored under
 * a type it does not match is a trap for anything downstream that trusts the
 * type, including a future move to object storage, where the served
 * content-type is usually inferred from the key.
 *
 * Exported for direct testing.
 */
export function sniffMimeType(data: Buffer): string | null {
  const startsWith = (...bytes: number[]): boolean =>
    bytes.every((byte, index) => data[index] === byte);

  if (startsWith(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return 'image/gif';

  // RIFF....WEBP
  if (startsWith(0x52, 0x49, 0x46, 0x46) && data.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }

  // ISO base media: a box length, then "ftyp", then the brand that separates
  // an MP4 from a QuickTime file.
  if (data.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = data.subarray(8, 12).toString('ascii');
    return brand.startsWith('qt') ? 'video/quicktime' : 'video/mp4';
  }

  return null;
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

export interface StoredStream {
  body: ReadableStream<Uint8Array>;
  size: number;
}

/**
 * Open a stored file for sending, without reading it into memory first.
 *
 * The whole point is the ceiling. Uploads go up to `media.maxUploadMb`, so
 * buffering a video meant tens of megabytes held per request — twice over, once
 * for the read and once for the copy handed to the response — and a handful of
 * people opening the media library at the same time was enough to matter on a
 * small host. Streaming makes the cost per request a buffer, not a file.
 *
 * Publishing still reads the bytes (`resolveMediaForPublish`): that path hands
 * the file to Graph as one multipart upload and genuinely needs it whole.
 */
export async function openStoredFile(storageKey: string): Promise<StoredStream> {
  const absolute = resolveStoragePath(storageKey);
  const info = await stat(absolute);

  return {
    body: Readable.toWeb(createReadStream(absolute)) as ReadableStream<Uint8Array>,
    size: info.size,
  };
}

/**
 * Posts that would break if this file went away.
 *
 * A post's media is a Json array holding the storage key, not a foreign key, so
 * the database will happily let a file be deleted out from under a scheduled
 * post. The failure then surfaces at publish time, hours later, as a Graph
 * error nobody can connect to a deletion.
 *
 * Only posts that have yet to go out are counted. A published post keeps its
 * media reference for the record, but Facebook holds its own copy by then, so
 * deleting ours changes nothing.
 */
export async function postsUsingMedia(options: {
  workspaceId: string;
  mediaId: string;
  storageKey: string | null;
}): Promise<Array<{ id: string; message: string }>> {
  const keys = [options.mediaId, ...(options.storageKey ? [options.storageKey] : [])];

  // `mediaKeys` is the post's media references flattened into an indexed array
  // (GIN), so this is a lookup rather than a scan of every post's Json.
  return prisma.post.findMany({
    where: {
      workspaceId: options.workspaceId,
      status: { in: ['draft', 'pending_approval', 'rejected', 'scheduled', 'publishing'] },
      mediaKeys: { hasSome: keys },
    },
    select: { id: true, message: true },
  });
}

export interface StorageUsage {
  bytes: number;
  quotaBytes: number;
  /** How much of the quota is spent, 0–100. */
  percent: number;
}

/** What this workspace is holding, against what it is allowed. */
export async function storageUsage(workspaceId: string): Promise<StorageUsage> {
  const total = await prisma.media.aggregate({
    where: { workspaceId },
    _sum: { size: true },
  });

  const bytes = total._sum.size ?? 0;
  const quotaBytes = env.mediaQuotaBytes;

  return {
    bytes,
    quotaBytes,
    percent: quotaBytes > 0 ? Math.min(100, Math.round((bytes / quotaBytes) * 100)) : 0,
  };
}

export interface MediaCleanupResult {
  removed: number;
  bytes: number;
  errors: string[];
}

/**
 * Delete uploads that were never attached to anything.
 *
 * People upload an image, change their mind, and close the composer. Nothing
 * ever references that file again, and on a VPS with a local media directory it
 * sits there until the disk fills.
 *
 * A file referenced by *any* post is kept, whatever that post's status. A
 * published post keeps its media reference for the record and the UI still
 * renders it, so deleting the row there would turn history into broken images —
 * this is only for files that were never used at all.
 */
export async function deleteUnusedMedia(options: {
  workspaceId: string;
  olderThanDays: number;
  now?: Date;
}): Promise<MediaCleanupResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - options.olderThanDays * 24 * 60 * 60 * 1000);

  const result: MediaCleanupResult = { removed: 0, bytes: 0, errors: [] };

  const candidates = await prisma.media.findMany({
    where: { workspaceId: options.workspaceId, createdAt: { lt: cutoff } },
  });
  if (candidates.length === 0) return result;

  // One indexed query for the whole candidate set rather than one per file, or
  // a scan of every post's Json.
  const keys = candidates.flatMap((file) =>
    file.storageKey ? [file.id, file.storageKey] : [file.id],
  );

  const referenced = new Set(
    (
      await prisma.post.findMany({
        where: { workspaceId: options.workspaceId, mediaKeys: { hasSome: keys } },
        select: { mediaKeys: true },
      })
    ).flatMap((post) => post.mediaKeys),
  );

  for (const file of candidates) {
    if (referenced.has(file.id) || (file.storageKey && referenced.has(file.storageKey))) continue;

    // The row goes first for the same reason as a manual delete: a row pointing
    // at a missing file breaks the library, an orphaned file is only waste.
    await prisma.media.delete({ where: { id: file.id } });
    result.removed += 1;
    result.bytes += file.size;

    if (file.storageKey) {
      try {
        await deleteStoredFile(file.storageKey);
      } catch (error) {
        result.errors.push(
          `${file.filename}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  return result;
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
