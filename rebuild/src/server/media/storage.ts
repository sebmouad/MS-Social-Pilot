import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { runtimeConfig } from '@/server/config/store';
import { canonicalMediaRoot, validateWorkspaceId } from '@/server/data-control/storage';
import { prisma } from '@/server/data';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { MediaStorageUnavailable, MediaValidationError } from './errors';

export type MediaActor = { userId: string; workspaceId: string };
export type WorkspaceImage = { id: string; mimeType: string; fileName: string };
export type WorkspaceImageBytes = WorkspaceImage & { bytes: Buffer };
export type WorkspaceImageListing = { id: string; mimeType: string; size: number; createdAt: Date; inUse: boolean };
export type OrphanCleanupResult = { removed: number; bytes: number; errors: number };
const IMAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Pure selector so age, references, and the per-run bound stay easy to audit. */
export function selectOrphanImageIds(files: Array<{ id: string; mtimeMs: number }>, referenced: ReadonlySet<string>, cutoffMs: number, limit: number): string[] {
  return files.filter(file => IMAGE_ID.test(file.id) && file.mtimeMs < cutoffMs && !referenced.has(file.id))
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.id.localeCompare(b.id)).slice(0, limit).map(file => file.id);
}

const allowedSignatures: Record<string, (bytes: Buffer) => boolean> = {
  'image/jpeg': bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png': bytes => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  'image/gif': bytes => bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)),
};

function safeName(name: string): string {
  const cleaned = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 180);
  return cleaned || 'image';
}

async function ensureRealDirectory(dir: string, parent: string, create: boolean): Promise<void> {
  if (create) {
    try { await mkdir(dir); } catch (error) {
      if (!(typeof error === 'object' && error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
  }
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Refusing unsafe media directory.');
  const real = await realpath(dir);
  if (real !== dir || path.dirname(real) !== parent) throw new Error('Media directory escaped the configured storage root.');
}

async function workspaceImageDirectory(workspaceId: string, create: boolean): Promise<string> {
  validateWorkspaceId(workspaceId);
  const configuredRoot = await runtimeConfig('storage.mediaRoot') as string;
  if (!configuredRoot) throw new MediaStorageUnavailable();
  let root: string;
  try { root = await canonicalMediaRoot(configuredRoot); }
  catch { throw new MediaStorageUnavailable(); }
  const workspaceDir = path.join(root, workspaceId);
  await ensureRealDirectory(workspaceDir, root, create);
  const imageDir = path.join(workspaceDir, 'images');
  await ensureRealDirectory(imageDir, workspaceDir, create);
  return imageDir;
}

export async function uploadWorkspaceImage(actor: MediaActor, file: File): Promise<WorkspaceImage> {
  const maxBytes = await runtimeConfig('publishing.maxImageUploadBytes') as number;
  const allowed = await runtimeConfig('publishing.allowedImageMimeTypes') as string[];
  if (!(file instanceof File)) throw new MediaValidationError('invalid_file');
  if (file.size < 1 || file.size > maxBytes) throw new MediaValidationError('too_large');
  const mimeType = file.type.toLowerCase();
  if (!allowed.includes(mimeType) || !allowedSignatures[mimeType]) throw new MediaValidationError('invalid_type');
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes || !allowedSignatures[mimeType]!(bytes)) throw new MediaValidationError('invalid_content');
  const id = randomUUID();
  const dir = await workspaceImageDirectory(actor.workspaceId, true);
  const filePath = path.join(dir, id);
  const handle = await open(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } catch (error) {
    await handle.close();
    const { unlink } = await import('node:fs/promises');
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  return { id, mimeType, fileName: safeName(file.name) };
}

export async function readWorkspaceImage(workspaceId: string, id: string): Promise<WorkspaceImageBytes> {
  if (!IMAGE_ID.test(id)) throw new Error('Invalid media ID.');
  const dir = await workspaceImageDirectory(workspaceId, false);
  const filePath = path.join(dir, id);
  const info = await lstat(filePath);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('Stored image is unavailable.');
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size < 1 || opened.size > (await runtimeConfig('publishing.maxImageUploadBytes') as number)) throw new Error('Stored image is unsafe.');
    const bytes = await handle.readFile();
    const allowed = await runtimeConfig('publishing.allowedImageMimeTypes') as string[];
    const mimeType = allowed.find(type => allowedSignatures[type]?.(bytes));
    if (!mimeType) throw new Error('Stored image content is not an allowed image type.');
    return { id, mimeType, fileName: id, bytes };
  } finally { await handle.close(); }
}

function mediaReferences(value: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(value)) return ids;
  for (const item of value) {
    if (item && typeof item === 'object' && 'url' in item && typeof item.url === 'string') {
      const match = /^media:([0-9a-f-]{36})$/i.exec(item.url);
      if (match && IMAGE_ID.test(match[1]!)) ids.add(match[1]!.toLowerCase());
    }
  }
  return ids;
}

async function referenceSet(workspaceId: string): Promise<Set<string>> {
  const posts = await prisma.post.findMany({ where: { workspaceId }, select: { media: true } });
  const ids = new Set<string>();
  for (const post of posts) for (const id of mediaReferences(post.media)) ids.add(id);
  return ids;
}

function detectedImageMime(bytes: Buffer): string | undefined {
  return Object.keys(allowedSignatures).find(type => allowedSignatures[type]!(bytes));
}

/** Return a bounded, tenant-scoped page of stored image metadata without reading image bytes. */
export async function listWorkspaceImages(workspaceId: string, options: { limit: number; cursor?: string }): Promise<{ items: WorkspaceImageListing[]; nextCursor: string | null }> {
  const { limit, cursor } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new MediaValidationError('invalid_listing_limit');
  let after: { mtimeMs: number; id: string } | undefined;
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { mtimeMs?: unknown; id?: unknown };
      if (typeof parsed.mtimeMs !== 'number' || !Number.isFinite(parsed.mtimeMs) || typeof parsed.id !== 'string' || !IMAGE_ID.test(parsed.id)) throw new Error();
      after = { mtimeMs: parsed.mtimeMs, id: parsed.id };
    } catch { throw new MediaValidationError('invalid_cursor'); }
  }
  const dir = await workspaceImageDirectory(workspaceId, false).catch(error => {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!dir) return { items: [], nextCursor: null };
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Array<{ id: string; size: number; modifiedAt: Date; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!IMAGE_ID.test(entry.name)) continue;
    const filePath = path.join(dir, entry.name);
    const info = await lstat(filePath);
    if (info.isSymbolicLink() || !info.isFile() || info.size < 1) continue;
    files.push({ id: entry.name, size: info.size, modifiedAt: info.mtime, mtimeMs: info.mtimeMs });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id));
  const refs = await referenceSet(workspaceId);
  const remaining = after ? files.filter(file => file.mtimeMs < after!.mtimeMs || (file.mtimeMs === after!.mtimeMs && file.id.localeCompare(after!.id) > 0)) : files;
  const page = remaining.slice(0, limit);
  const checked = await Promise.all(page.map(async ({ id, size, modifiedAt }) => {
    try {
      const filePath = path.join(dir, id);
      const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const signature = Buffer.alloc(8);
        const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
        const mimeType = detectedImageMime(signature.subarray(0, bytesRead));
        if (!mimeType) return null;
        return { id, mimeType, size, createdAt: modifiedAt, inUse: refs.has(id.toLowerCase()) };
      } finally { await handle.close(); }
    } catch { return null; }
  }));
  const items = checked.filter((item): item is WorkspaceImageListing => item !== null);
  return {
    items,
    nextCursor: remaining.length > page.length && page.length ? Buffer.from(JSON.stringify({ mtimeMs: page[page.length - 1]!.mtimeMs, id: page[page.length - 1]!.id })).toString('base64url') : null,
  };
}

export async function getWorkspaceImageMetadata(workspaceId: string, id: string): Promise<WorkspaceImageListing> {
  const file = await safeImageFile(workspaceId, id);
  if (!file) throw new Error('Image not found.');
  const [image, refs, info] = await Promise.all([readWorkspaceImage(workspaceId, id), referenceSet(workspaceId), lstat(file.path)]);
  return { id, mimeType: image.mimeType, size: info.size, createdAt: info.mtime, inUse: refs.has(id.toLowerCase()) };
}

async function safeImageFile(workspaceId: string, id: string): Promise<{ path: string; size: number } | null> {
  if (!IMAGE_ID.test(id)) throw new Error('Invalid media ID.');
  const dir = await workspaceImageDirectory(workspaceId, false);
  const filePath = path.join(dir, id);
  let info;
  try { info = await lstat(filePath); }
  catch (error) { if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') return null; throw error; }
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('Refusing unsafe stored image.');
  return { path: filePath, size: info.size };
}

/** Delete an image only when no post in this workspace references it. */
export async function deleteUnusedWorkspaceImage(workspaceId: string, id: string): Promise<'deleted' | 'missing' | 'in_use'> {
  const refs = await referenceSet(workspaceId);
  if (refs.has(id.toLowerCase())) return 'in_use';
  const file = await safeImageFile(workspaceId, id);
  if (!file) return 'missing';
  // Recheck the leaf immediately before unlink; lstat and unlink never recurse or follow a link.
  const current = await lstat(file.path);
  if (current.isSymbolicLink() || !current.isFile()) throw new Error('Refusing unsafe stored image.');
  await unlink(file.path);
  return 'deleted';
}

/** Reclaim old unreferenced files for one workspace, with a fixed per-run cap. */
export async function cleanupOrphanWorkspaceImages(workspaceId: string, olderThanDays: number, batchLimit: number, now = new Date()): Promise<OrphanCleanupResult> {
  if (!Number.isInteger(olderThanDays) || olderThanDays < 1 || olderThanDays > 3650) throw new Error('Invalid orphan image retention period.');
  if (!Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 10000) throw new Error('Invalid orphan image cleanup batch limit.');
  const dir = await workspaceImageDirectory(workspaceId, false).catch(error => {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!dir) return { removed: 0, bytes: 0, errors: 0 };
  const cutoff = now.getTime() - olderThanDays * 86_400_000;
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Array<{ id: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    if (!IMAGE_ID.test(entry.name)) continue;
    const filePath = path.join(dir, entry.name);
    const info = await lstat(filePath);
    // Treat any unsafe entry as an operation error; never follow or erase it.
    if (info.isSymbolicLink() || !info.isFile()) continue;
    files.push({ id: entry.name, mtimeMs: info.mtimeMs });
  }
  const refs = await referenceSet(workspaceId);
  const ids = selectOrphanImageIds(files, refs, cutoff, batchLimit);
  const result: OrphanCleanupResult = { removed: 0, bytes: 0, errors: 0 };
  for (const id of ids) {
    try {
      // Fresh reference read narrows the interval between deciding and deleting.
      if ((await referenceSet(workspaceId)).has(id.toLowerCase())) continue;
      const file = await safeImageFile(workspaceId, id);
      if (!file) continue;
      const info = await lstat(file.path);
      if (info.isSymbolicLink() || !info.isFile() || info.mtimeMs >= cutoff) continue;
      await unlink(file.path);
      result.removed++;
      result.bytes += info.size;
    } catch { result.errors++; }
  }
  return result;
}

/** Worker entry point. Each tenant is locked and processed independently. */
export async function cleanupOrphanImages(now = new Date()): Promise<OrphanCleanupResult> {
  const [olderThanDays, batchLimit] = await Promise.all([
    runtimeConfig('storage.orphanMediaRetentionDays'),
    runtimeConfig('storage.orphanMediaBatchLimit'),
  ]).then(values => values.map(Number));
  const workspaces = await prisma.workspace.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  const total: OrphanCleanupResult = { removed: 0, bytes: 0, errors: 0 };
  for (const workspace of workspaces) {
    try {
      const result = await withWorkspaceOperation(workspace.id, () => cleanupOrphanWorkspaceImages(workspace.id, olderThanDays, batchLimit, now));
      total.removed += result.removed;
      total.bytes += result.bytes;
      total.errors += result.errors;
    } catch { total.errors++; }
  }
  return total;
}
