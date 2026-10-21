import { loadMediaPresentationPolicy } from './policy';
import type { MediaPresentationPolicy } from './config';
import { loadPublishingErrorText } from '../error-copy';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { runtimeConfig } from '@/server/config/store';
import { canonicalMediaRoot, validateWorkspaceId } from '@/server/data-control/storage';
import { prisma } from '@/server/data';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { MediaStorageUnavailable, MediaValidationError } from './errors';
import type { Prisma } from '../../../../../generated/client';

export type MediaActor = { userId: string; workspaceId: string };
export type WorkspaceImage = { id: string; mimeType: string; fileName: string };
export type WorkspaceImageBytes = WorkspaceImage & { bytes: Buffer };
/** A post that references an image. `pending` marks posts that have not gone out (legacy `heldBy`). */
export type ImageHolder = { id: string; status: string; excerpt: string; pending: boolean };
export type WorkspaceImageListing = { id: string; mimeType: string; size: number; createdAt: Date; inUse: boolean; usedBy: number; heldBy: ImageHolder[] };
/** Workspace storage totals across every stored image file, not only the current page. */
export type WorkspaceImageUsage = { files: number; bytes: number; unusedFiles: number; unusedBytes: number };
/** Posts still headed for publication; deleting their image would break a later send or retry. */
const PENDING_STATUSES = new Set(['draft', 'pending_approval', 'rejected', 'scheduled', 'publishing', 'partially_failed', 'failed']);
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

function safeName(name: string, policy: MediaPresentationPolicy): string {
  const cleaned = path.basename(name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, policy.fileNameMaxCharacters);
  return cleaned || policy.fallbackFileName.slice(0, policy.fileNameMaxCharacters);
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
  const errorText = await loadPublishingErrorText();
  validateWorkspaceId(workspaceId);
  const configuredRoot = await runtimeConfig('storage.mediaRoot') as string;
  if (!configuredRoot) throw new MediaStorageUnavailable(errorText);
  let root: string;
  try { root = await canonicalMediaRoot(configuredRoot); }
  catch { throw new MediaStorageUnavailable(errorText); }
  const workspaceDir = path.join(root, workspaceId);
  await ensureRealDirectory(workspaceDir, root, create);
  const imageDir = path.join(workspaceDir, 'images');
  await ensureRealDirectory(imageDir, workspaceDir, create);
  return imageDir;
}

export async function uploadWorkspaceImage(actor: MediaActor, file: File): Promise<WorkspaceImage> {
  const errorText = await loadPublishingErrorText();
  const maxBytes = await runtimeConfig('publishing.maxImageUploadBytes') as number;
  const allowed = await runtimeConfig('publishing.allowedImageMimeTypes') as string[];
  if (!(file instanceof File)) throw new MediaValidationError('invalid_file', errorText);
  if (file.size < 1 || file.size > maxBytes) throw new MediaValidationError('too_large', errorText);
  const mimeType = file.type.toLowerCase();
  if (!allowed.includes(mimeType) || !allowedSignatures[mimeType]) throw new MediaValidationError('invalid_type', errorText);
  const policy = await loadMediaPresentationPolicy();
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes || !allowedSignatures[mimeType]!(bytes)) throw new MediaValidationError('invalid_content', errorText);
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
  return { id, mimeType, fileName: safeName(file.name, policy) };
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
  return new Set((await referenceMap(workspaceId)).keys());
}

/** image id → posts referencing it, pending posts first. Tenant-scoped; one query per call. */
async function referenceMap(workspaceId: string, policy?: MediaPresentationPolicy): Promise<Map<string, ImageHolder[]>> {
  policy ??= await loadMediaPresentationPolicy();
  const posts = await prisma.post.findMany({ where: { workspaceId }, select: { id: true, status: true, message: true, media: true } });
  const map = new Map<string, ImageHolder[]>();
  for (const post of posts) {
    const holder: ImageHolder = { id: String(post.id ?? ''), status: String(post.status ?? ''), excerpt: excerpt(post.message, policy.usagePreviewMaxCharacters), pending: PENDING_STATUSES.has(String(post.status)) };
    for (const id of mediaReferences(post.media)) map.set(id, [...(map.get(id) ?? []), holder]);
  }
  for (const holders of map.values()) holders.sort((a, b) => Number(b.pending) - Number(a.pending) || a.id.localeCompare(b.id));
  return map;
}

function excerpt(message: unknown, limit: number): string {
  const text = typeof message === 'string' ? message.replace(/\s+/g, ' ').trim() : '';
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** Holder visibility: null (the default) names no posts; counts are still reported. */
export type HolderVisibility = Prisma.PostWhereInput | null;

async function visibleHolderIds(refs: Map<string, ImageHolder[]>, imageIds: readonly string[], visibility: HolderVisibility): Promise<Set<string>> {
  if (!visibility) return new Set();
  const ids = [...new Set(imageIds.flatMap(id => (refs.get(id.toLowerCase()) ?? []).map(holder => holder.id)))];
  if (!ids.length) return new Set();
  const rows = await prisma.post.findMany({ where: { AND: [{ id: { in: ids } }, visibility] }, select: { id: true }, take: ids.length });
  return new Set(rows.map(row => String(row.id)));
}

function listingFor(refs: Map<string, ImageHolder[]>, visible: ReadonlySet<string>, id: string, base: { mimeType: string; size: number; createdAt: Date }, holdersPerImage: number): WorkspaceImageListing {
  const holders = refs.get(id.toLowerCase()) ?? [];
  return { id, ...base, inUse: holders.length > 0, usedBy: holders.length, heldBy: holders.filter(holder => visible.has(holder.id)).slice(0, holdersPerImage) };
}

function detectedImageMime(bytes: Buffer): string | undefined {
  return Object.keys(allowedSignatures).find(type => allowedSignatures[type]!(bytes));
}

/** Return a bounded, tenant-scoped page of stored image metadata without reading image bytes. */
export async function listWorkspaceImages(workspaceId: string, options: { limit: number; cursor?: string; holderVisibility?: HolderVisibility }): Promise<{ items: WorkspaceImageListing[]; nextCursor: string | null; usage: WorkspaceImageUsage }> {
  const errorText = await loadPublishingErrorText();
  const { limit, cursor } = options;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new MediaValidationError('invalid_listing_limit', errorText);
  let after: { mtimeMs: number; id: string } | undefined;
  if (cursor) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { mtimeMs?: unknown; id?: unknown };
      if (typeof parsed.mtimeMs !== 'number' || !Number.isFinite(parsed.mtimeMs) || typeof parsed.id !== 'string' || !IMAGE_ID.test(parsed.id)) throw new Error();
      after = { mtimeMs: parsed.mtimeMs, id: parsed.id };
    } catch { throw new MediaValidationError('invalid_cursor', errorText); }
  }
  const dir = await workspaceImageDirectory(workspaceId, false).catch(error => {
    if (typeof error === 'object' && error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!dir) return { items: [], nextCursor: null, usage: { files: 0, bytes: 0, unusedFiles: 0, unusedBytes: 0 } };
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
  const policy = await loadMediaPresentationPolicy();
  const refs = await referenceMap(workspaceId, policy);
  const usage: WorkspaceImageUsage = { files: files.length, bytes: 0, unusedFiles: 0, unusedBytes: 0 };
  for (const file of files) {
    usage.bytes += file.size;
    if (!refs.has(file.id.toLowerCase())) { usage.unusedFiles++; usage.unusedBytes += file.size; }
  }
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
        return { id, mimeType, size, createdAt: modifiedAt };
      } finally { await handle.close(); }
    } catch { return null; }
  }));
  const found = checked.filter((item): item is { id: string; mimeType: string; size: number; createdAt: Date } => item !== null);
  const visible = await visibleHolderIds(refs, found.map(item => item.id), options.holderVisibility ?? null);
  const items = found.map(({ id, ...base }) => listingFor(refs, visible, id, base, policy.holdersPerImage));
  return {
    items,
    usage,
    nextCursor: remaining.length > page.length && page.length ? Buffer.from(JSON.stringify({ mtimeMs: page[page.length - 1]!.mtimeMs, id: page[page.length - 1]!.id })).toString('base64url') : null,
  };
}

export async function getWorkspaceImageMetadata(workspaceId: string, id: string, holderVisibility: HolderVisibility = null): Promise<WorkspaceImageListing> {
  const file = await safeImageFile(workspaceId, id);
  if (!file) throw new Error('Image not found.');
  const policy = await loadMediaPresentationPolicy();
  const [image, refs, info] = await Promise.all([readWorkspaceImage(workspaceId, id), referenceMap(workspaceId, policy), lstat(file.path)]);
  const visible = await visibleHolderIds(refs, [id], holderVisibility);
  return listingFor(refs, visible, id, { mimeType: image.mimeType, size: info.size, createdAt: info.mtime }, policy.holdersPerImage);
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
