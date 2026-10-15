import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const config = vi.hoisted(() => ({ root: '', maxBytes: 1024, allowed: ['image/jpeg', 'image/png'] as string[] }));
vi.mock('../src/server/config/store', () => ({ runtimeConfig: vi.fn(async (key: string) => key === 'storage.mediaRoot' ? config.root : key === 'publishing.maxImageUploadBytes' ? config.maxBytes : key === 'publishing.allowedImageMimeTypes' ? config.allowed : undefined) }));
const db = vi.hoisted(() => ({ post: { findMany: vi.fn(async (): Promise<Array<{ media: unknown }>> => []) } }));
vi.mock('../src/server/data', () => ({ prisma: db }));

import { listWorkspaceImages, readWorkspaceImage, selectOrphanImageIds, uploadWorkspaceImage } from '../src/server/media/storage';

let tempRoot = '';
afterEach(async () => { if (tempRoot) await rm(tempRoot, { recursive: true, force: true }); tempRoot = ''; config.maxBytes = 1024; });

describe('workspace image storage', () => {
  it('selects only old unreferenced UUID images and caps each cleanup batch', () => {
    const files = [
      { id: '00000000-0000-4000-8000-000000000001', mtimeMs: 1 },
      { id: '00000000-0000-4000-8000-000000000002', mtimeMs: 2 },
      { id: '00000000-0000-4000-8000-000000000003', mtimeMs: 20 },
      { id: '../outside', mtimeMs: 0 },
    ];
    expect(selectOrphanImageIds(files, new Set(['00000000-0000-4000-8000-000000000002']), 10, 1))
      .toEqual(['00000000-0000-4000-8000-000000000001']);
  });

  it('stores accepted image bytes in a workspace-scoped path and reads them back', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'media-store-test-'));
    config.root = path.join(tempRoot, 'root');
    await mkdir(config.root);
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const image = await uploadWorkspaceImage({ userId: 'u1', workspaceId: 'workspace-a' }, new File([bytes], '../photo.jpg', { type: 'image/jpeg' }));
    expect(image).toMatchObject({ mimeType: 'image/jpeg', fileName: 'photo.jpg' });
    expect(await readWorkspaceImage('workspace-a', image.id)).toMatchObject({ id: image.id, mimeType: 'image/jpeg', bytes });
    await expect(readWorkspaceImage('workspace-b', image.id)).rejects.toThrow();
  });

  it('lists bounded image metadata, reference status, and a stable next-page cursor', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'media-store-test-'));
    config.root = path.join(tempRoot, 'root');
    await mkdir(config.root);
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const first = await uploadWorkspaceImage({ userId: 'u1', workspaceId: 'workspace-a' }, new File([bytes], 'one.jpg', { type: 'image/jpeg' }));
    const second = await uploadWorkspaceImage({ userId: 'u1', workspaceId: 'workspace-a' }, new File([bytes], 'two.jpg', { type: 'image/jpeg' }));
    const imageDir = path.join(config.root, 'workspace-a', 'images');
    await utimes(path.join(imageDir, first.id), new Date(2000), new Date(2000));
    await utimes(path.join(imageDir, second.id), new Date(1000), new Date(1000));
    const corrupt = path.join(config.root, 'workspace-a', 'images', '00000000-0000-4000-8000-000000000003');
    await writeFile(corrupt, 'not an image');
    await utimes(corrupt, new Date(0), new Date(0));
    config.maxBytes = 2; // Metadata browsing must survive tightened upload settings.
    db.post.findMany.mockResolvedValue([{ media: [{ url: `media:${second.id}` }] }]);
    const page = await listWorkspaceImages('workspace-a', { limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: first.id, mimeType: 'image/jpeg', size: bytes.length, inUse: false });
    expect(page.nextCursor).toBeTruthy();
    const next = await listWorkspaceImages('workspace-a', { limit: 1, cursor: page.nextCursor! });
    expect(next.items[0]).toMatchObject({ id: second.id, inUse: true });
    expect(next.nextCursor).toBeTruthy();
    const tail = await listWorkspaceImages('workspace-a', { limit: 1, cursor: next.nextCursor! });
    expect(tail.items).toEqual([]); // Corrupt files do not break or leak into the library.
    expect(tail.nextCursor).toBeNull();
    await expect(listWorkspaceImages('workspace-a', { limit: 1, cursor: 'stale' })).rejects.toThrow(/cursor/);
    config.maxBytes = 1024;
  });

  it('rejects mismatched content, over-limit input, and workspace symlinks', async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'media-store-test-'));
    config.root = path.join(tempRoot, 'root');
    await mkdir(config.root);
    await expect(uploadWorkspaceImage({ userId: 'u1', workspaceId: 'w1' }, new File(['not jpeg'], 'x.jpg', { type: 'image/jpeg' }))).rejects.toThrow(/content/);
    config.maxBytes = 2;
    await expect(uploadWorkspaceImage({ userId: 'u1', workspaceId: 'w1' }, new File(['abc'], 'x.jpg', { type: 'image/jpeg' }))).rejects.toThrow(/size limit/);
    config.maxBytes = 1024;
    await symlink(tempRoot, path.join(config.root, 'workspace-a'));
    await expect(uploadWorkspaceImage({ userId: 'u1', workspaceId: 'workspace-a' }, new File([Buffer.from([0xff, 0xd8, 0xff])], 'x.jpg', { type: 'image/jpeg' }))).rejects.toThrow(/unsafe media directory/);
  });
});
