import { lstat, readdir, realpath, unlink, rmdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export type WorkspaceStorageCleanup = { files: number; bytes: number };
export type WorkspaceStorageFile = { path: string; content: Buffer };

type TreeStats = WorkspaceStorageCleanup;

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

export function validateWorkspaceId(workspaceId: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(workspaceId) || workspaceId === '.' || workspaceId === '..' || workspaceId === 'exports') {
    throw new Error('Workspace ID must be a safe path segment.');
  }
}

async function assertDirectory(directory: string): Promise<boolean> {
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error(`Refusing to use symbolic-link directory: ${directory}`);
  if (!info.isDirectory()) throw new Error(`Expected a directory: ${directory}`);
  return true;
}

/** Inspect a tenant tree without following links and reject the whole operation if any link exists. */
async function inspectTree(directory: string): Promise<TreeStats> {
  const total: TreeStats = { files: 0, bytes: 0 };
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const info = await lstat(entryPath);
    if (info.isSymbolicLink()) throw new Error(`Refusing to remove a tree containing a symbolic link: ${entryPath}`);
    if (info.isDirectory()) {
      const child = await inspectTree(entryPath);
      total.files += child.files;
      total.bytes += child.bytes;
    } else if (info.isFile()) {
      total.files += 1;
      total.bytes += info.size;
    } else {
      throw new Error(`Refusing to remove a non-file entry: ${entryPath}`);
    }
  }
  return total;
}

async function removeTree(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const info = await lstat(entryPath);
    // Recheck during deletion as well, and never pass a symlink to a recursive removal API.
    if (info.isSymbolicLink()) throw new Error(`Refusing to remove a tree containing a symbolic link: ${entryPath}`);
    if (info.isDirectory()) await removeTree(entryPath);
    else if (info.isFile()) await unlink(entryPath);
    else throw new Error(`Refusing to remove a non-file entry: ${entryPath}`);
  }
  await rmdir(directory);
}

/** Read a tenant's media tree without following links. Missing or special entries fail the export. */
async function readTree(directory: string, prefix: string, files: WorkspaceStorageFile[], budget: { remaining: number }): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const info = await lstat(fullPath);
    if (info.isSymbolicLink()) throw new Error(`Refusing to export a tree containing a symbolic link: ${fullPath}`);
    if (info.isDirectory()) await readTree(fullPath, `${prefix}/${entry.name}`, files, budget);
    else if (info.isFile()) {
      const handle = await open(fullPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const opened = await handle.stat();
        if (!opened.isFile()) throw new Error(`Refusing to export a non-file entry: ${fullPath}`);
        if (opened.size > budget.remaining) throw new Error('Workspace media exceeds the configured archive size limit.');
        const content = await handle.readFile();
        if (content.length > budget.remaining) throw new Error('Workspace media exceeds the configured archive size limit.');
        budget.remaining -= content.length;
        files.push({ path: `${prefix}/${entry.name}`, content });
      } finally { await handle.close(); }
    }
    else throw new Error(`Refusing to export a non-file entry: ${fullPath}`);
  }
}

/** Read every file for one workspace, including unindexed files, with path and link checks. */
export async function readWorkspaceStorage(mediaRoot: string, workspaceId: string, maxBytes = Number.MAX_SAFE_INTEGER): Promise<WorkspaceStorageFile[]> {
  validateWorkspaceId(workspaceId);
  const root = await canonicalMediaRoot(mediaRoot);
  const directory = path.join(root, workspaceId);
  if (!(await assertDirectory(directory))) return [];
  const files: WorkspaceStorageFile[] = [];
  await readTree(directory, 'media', files, { remaining: maxBytes });
  return files;
}

/** Resolve Root's configured storage path before a purge is queued. */
export async function canonicalMediaRoot(mediaRoot: string): Promise<string> {
  if (!path.isAbsolute(mediaRoot)) throw new Error('Media root must be an absolute path.');

  // Canonicalize the trusted Root-configured path once. macOS commonly maps
  // /var and /tmp through symlinks; all destructive operations use the
  // canonical path so changing a configured alias cannot redirect a walk.
  const root = await realpath(mediaRoot).catch(error => {
    if (isMissing(error)) throw new Error('Configured media root is missing.');
    throw error;
  });
  if (root === path.parse(root).root) throw new Error('Media root cannot be the filesystem root.');
  await assertDirectory(root);
  return root;
}

/** Remove only the workspace's media and export directories beneath an absolute media root. */
export async function removeWorkspaceStorage(mediaRoot: string, workspaceId: string): Promise<WorkspaceStorageCleanup> {
  validateWorkspaceId(workspaceId);
  const root = await canonicalMediaRoot(mediaRoot);
  const mediaTarget = path.join(root, workspaceId);
  const exportsRoot = path.join(root, 'exports');

  const targets: string[] = [];
  if (await assertDirectory(mediaTarget)) targets.push(mediaTarget);
  if (await assertDirectory(exportsRoot)) {
    const exportTarget = path.join(exportsRoot, workspaceId);
    if (await assertDirectory(exportTarget)) targets.push(exportTarget);
  }

  // Validate every selected tree before deleting either one, so a discovered link leaves both intact.
  const totals: WorkspaceStorageCleanup = { files: 0, bytes: 0 };
  for (const target of targets) {
    const stats = await inspectTree(target);
    totals.files += stats.files;
    totals.bytes += stats.bytes;
  }
  for (const target of targets) {
    try {
      await removeTree(target);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return totals;
}
