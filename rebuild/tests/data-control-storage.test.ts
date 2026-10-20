import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readWorkspaceStorage, removeWorkspaceStorage } from '../src/server/data-control/storage';

const db = vi.hoisted(() => ({ query: vi.fn(async () => [] as Array<{ mediaRoot: string }>), execute: vi.fn(async () => 1) }));
vi.mock('../src/server/data', () => ({ prisma: { $queryRaw: db.query, $executeRaw: db.execute } }));
const tempDirs: string[] = [];

async function tempDir() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'workspace-storage-'));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  db.query.mockResolvedValue([]);
  await Promise.all(tempDirs.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('removeWorkspaceStorage', () => {
  it('erases archives from an earlier configured root using the durable deletion outbox', async () => {
    const root = await tempDir();
    const oldRoot = await tempDir();
    await mkdir(path.join(oldRoot, 'exports', 'workspace-a'), { recursive: true });
    await writeFile(path.join(oldRoot, 'exports', 'workspace-a', 'archive.zip'), 'zip');
    db.query.mockResolvedValue([{ mediaRoot: oldRoot }]);
    await expect(removeWorkspaceStorage(root, 'workspace-a')).resolves.toEqual({ files: 1, bytes: 3 });
    await expect(readFile(path.join(oldRoot, 'exports', 'workspace-a', 'archive.zip'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(db.execute).toHaveBeenCalled();
  });

  it('reads tenant media recursively and rejects symlinks', async () => {
    const root = await tempDir();
    const tenant = path.join(root, 'workspace-a');
    const outside = await tempDir();
    await mkdir(path.join(tenant, 'nested'), { recursive: true });
    await writeFile(path.join(tenant, 'nested', 'photo.bin'), Buffer.from([1, 2, 3]));
    await writeFile(path.join(outside, 'secret.bin'), 'secret');
    await expect(readWorkspaceStorage(root, 'workspace-a')).resolves.toEqual([
      { path: 'media/nested/photo.bin', content: Buffer.from([1, 2, 3]) },
    ]);
    await expect(readWorkspaceStorage(root, 'workspace-a', 2)).rejects.toThrow(/archive size limit/);
    await symlink(outside, path.join(tenant, 'external'));
    await expect(readWorkspaceStorage(root, 'workspace-a')).rejects.toThrow(/symbolic link/);
  });

  it('removes only the selected workspace media and exports and reports file totals', async () => {
    const root = await tempDir();
    await mkdir(path.join(root, 'workspace-a', 'nested'), { recursive: true });
    await mkdir(path.join(root, 'workspace-b'), { recursive: true });
    await mkdir(path.join(root, 'exports', 'workspace-a'), { recursive: true });
    await mkdir(path.join(root, 'exports', 'workspace-b'), { recursive: true });
    await writeFile(path.join(root, 'workspace-a', 'photo.bin'), Buffer.from([1, 2, 3]));
    await writeFile(path.join(root, 'workspace-a', 'nested', 'clip.bin'), Buffer.from([4, 5]));
    await writeFile(path.join(root, 'exports', 'workspace-a', 'export.json'), '{}');
    await writeFile(path.join(root, 'workspace-b', 'keep.bin'), 'other media');
    await writeFile(path.join(root, 'exports', 'workspace-b', 'keep.json'), 'other export');

    await expect(removeWorkspaceStorage(root, 'workspace-a')).resolves.toEqual({ files: 3, bytes: 7 });
    await expect(readFile(path.join(root, 'workspace-b', 'keep.bin'), 'utf8')).resolves.toBe('other media');
    await expect(readFile(path.join(root, 'exports', 'workspace-b', 'keep.json'), 'utf8')).resolves.toBe('other export');
    await expect(removeWorkspaceStorage(root, 'workspace-a')).resolves.toEqual({ files: 0, bytes: 0 });
  });

  it('validates workspace IDs as a single safe path segment', async () => {
    const root = await tempDir();
    await expect(removeWorkspaceStorage(root, '../outside')).rejects.toThrow(/safe path segment/);
    await expect(removeWorkspaceStorage(root, 'a/b')).rejects.toThrow(/safe path segment/);
    await expect(removeWorkspaceStorage(root, '..')).rejects.toThrow(/safe path segment/);
    await expect(removeWorkspaceStorage(root, 'exports')).rejects.toThrow(/safe path segment/);
  });

  it('rejects symlink entries before removing either selected tree and never follows them', async () => {
    const root = await tempDir();
    const outside = await tempDir();
    await mkdir(path.join(root, 'workspace-a'), { recursive: true });
    await mkdir(path.join(root, 'exports', 'workspace-a'), { recursive: true });
    await writeFile(path.join(root, 'workspace-a', 'keep.txt'), 'still here');
    await writeFile(path.join(outside, 'outside.txt'), 'outside');
    await symlink(outside, path.join(root, 'exports', 'workspace-a', 'link'));

    await expect(removeWorkspaceStorage(root, 'workspace-a')).rejects.toThrow(/symbolic link/);
    await expect(readFile(path.join(root, 'workspace-a', 'keep.txt'), 'utf8')).resolves.toBe('still here');
    await expect(readFile(path.join(outside, 'outside.txt'), 'utf8')).resolves.toBe('outside');
  });

  it('canonicalizes a configured root alias and rejects a symlink workspace directory', async () => {
    const parent = await tempDir();
    const realRoot = path.join(parent, 'real');
    await mkdir(path.join(realRoot, 'workspace-a'), { recursive: true });
    await writeFile(path.join(realRoot, 'workspace-a', 'keep.txt'), 'safe');
    const rootLink = path.join(parent, 'root-link');
    await symlink(realRoot, rootLink);
    await expect(removeWorkspaceStorage(rootLink, 'workspace-a')).resolves.toEqual({ files: 1, bytes: 4 });

    const otherRoot = path.join(parent, 'other-root');
    await mkdir(otherRoot);
    await symlink(path.join(realRoot, 'workspace-a'), path.join(otherRoot, 'workspace-a'));
    await expect(removeWorkspaceStorage(otherRoot, 'workspace-a')).rejects.toThrow(/symbolic-link directory/);
    await expect(readFile(path.join(realRoot, 'workspace-a', 'keep.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a missing configured root and treats missing tenant trees as empty', async () => {
    const parent = await tempDir();
    await expect(removeWorkspaceStorage(path.join(parent, 'missing'), 'workspace-a')).rejects.toThrow(/media root is missing/);
    const root = path.join(parent, 'media');
    await mkdir(root);
    await expect(removeWorkspaceStorage(root, 'workspace-a')).resolves.toEqual({ files: 0, bytes: 0 });
  });
});
