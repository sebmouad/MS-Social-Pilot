import { constants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { runtimeConfig } from '@/server/config/store';
import { canonicalMediaRoot, validateWorkspaceId } from '@/server/data-control/storage';
import { deleteUnusedWorkspaceImage, listWorkspaceImages, uploadWorkspaceImage, type WorkspaceImageListing } from '@/modules/publishing/server/media/storage';
import { OperationError } from '@/lib/operation-error';

/** Storage port: the service never touches the filesystem directly, so tests inject a fake. */
export interface MediaStore {
  /** `totalFiles`/`totalBytes` cover every stored image file, not just the returned page. */
  listImages(workspaceId: string, limit: number): Promise<{ items: WorkspaceImageListing[]; truncated: boolean; totalFiles?: number; totalBytes?: number }>;
  putImage(actor: { userId: string; workspaceId: string }, file: File): Promise<{ id: string; mimeType: string }>;
  /** Writes a new video file exclusively and returns the key to record. */
  putVideo(workspaceId: string, id: string, bytes: Buffer): Promise<{ storageKey: string }>;
  /** `force` removes a still-referenced image file; callers must have verified and audited that decision. */
  removeImage(workspaceId: string, id: string, force: boolean): Promise<'deleted' | 'missing' | 'in_use'>;
  /** Removes only files this store created (`<workspace>/videos/<id>`); anything else is `not_managed`. */
  removeStored(workspaceId: string, storageKey: string): Promise<'deleted' | 'missing' | 'not_managed'>;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const videoStorageKey = (workspaceId: string, id: string) => `${workspaceId}/videos/${id}`;
const MANAGED_KEY = (workspaceId: string) => new RegExp(`^${workspaceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/videos/(${UUID})$`, 'i');

async function root(): Promise<string> {
  const configured = await runtimeConfig('storage.mediaRoot') as string;
  if (!configured) throw new OperationError('unavailable', 'Media storage is not available. Try again later.');
  try { return await canonicalMediaRoot(configured); } catch { throw new OperationError('unavailable', 'Media storage is not available. Try again later.'); }
}
async function realDir(dir: string, create: boolean) {
  if (create) { try { await mkdir(dir); } catch (error) { if (!(typeof error === 'object' && error && 'code' in error && error.code === 'EEXIST')) throw error; } }
  const info = await lstat(dir);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Refusing unsafe media directory.');
}
const missing = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

export const fsMediaStore: MediaStore = {
  async listImages(workspaceId, limit) {
    const page = await listWorkspaceImages(workspaceId, { limit });
    return { items: page.items, truncated: page.nextCursor !== null, totalFiles: page.usage.files, totalBytes: page.usage.bytes };
  },
  async putImage(actor, file) {
    const stored = await uploadWorkspaceImage(actor, file);
    return { id: stored.id, mimeType: stored.mimeType };
  },
  async putVideo(workspaceId, id, bytes) {
    validateWorkspaceId(workspaceId);
    const base = await root();
    const workspaceDir = path.join(base, workspaceId);
    await realDir(workspaceDir, true);
    const dir = path.join(workspaceDir, 'videos');
    await realDir(dir, true);
    const handle = await open(path.join(dir, id), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    catch (error) { await handle.close(); await unlink(path.join(dir, id)).catch(() => undefined); throw error; }
    await handle.close();
    return { storageKey: videoStorageKey(workspaceId, id) };
  },
  async removeImage(workspaceId, id, force) {
    if (!force) return deleteUnusedWorkspaceImage(workspaceId, id);
    validateWorkspaceId(workspaceId);
    const target = path.join(await root(), workspaceId, 'images', id);
    return unlinkLeaf(target);
  },
  async removeStored(workspaceId, storageKey) {
    validateWorkspaceId(workspaceId);
    const match = MANAGED_KEY(workspaceId).exec(storageKey);
    if (!match) return 'not_managed';
    return unlinkLeaf(path.join(await root(), workspaceId, 'videos', match[1]!));
  },
};

async function unlinkLeaf(target: string): Promise<'deleted' | 'missing'> {
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Refusing unsafe stored file.');
    await unlink(target);
    return 'deleted';
  } catch (error) { if (missing(error)) return 'missing'; throw error; }
}
