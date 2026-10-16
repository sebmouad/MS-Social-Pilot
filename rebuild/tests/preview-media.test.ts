import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { preparePreviewMedia, PREVIEW_IMAGES } from '../scripts/preview-media';

let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
async function freshRoot() { directory = await mkdtemp(path.join(os.tmpdir(), 'socialpilot-preview-media-test-')); return directory; }

describe('synthetic image fixture storage', () => {
  it('writes repeatable PNG examples only into the preview workspace', async () => {
    const root = await freshRoot();
    const result = await preparePreviewMedia(root, 'preview_workspace');
    const imagePath = path.join(result.root, 'preview_workspace', 'images', PREVIEW_IMAGES.market.id);
    const bytes = await readFile(imagePath);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(await preparePreviewMedia(root, 'preview_workspace')).toEqual(result);
    expect(await readFile(imagePath)).toEqual(bytes);
    await expect(preparePreviewMedia(root, 'customer_workspace')).rejects.toThrow(/preview/);
  });

  it('refuses an occupied unmarked root and does not replace foreign files', async () => {
    const root = await freshRoot();
    await writeFile(path.join(root, 'customer-file'), 'keep');
    await expect(preparePreviewMedia(root, 'preview_workspace')).rejects.toThrow(/empty/);
    expect(await readFile(path.join(root, 'customer-file'), 'utf8')).toBe('keep');
  });

  it('checks marker contents before writing into an occupied root', async () => {
    const root = await freshRoot();
    await writeFile(path.join(root, '.socialpilot-preview-media'), 'not the fixture marker');
    await writeFile(path.join(root, 'customer-file'), 'keep');
    await expect(preparePreviewMedia(root, 'preview_workspace')).rejects.toThrow(/different/);
    expect(await readFile(path.join(root, 'customer-file'), 'utf8')).toBe('keep');
  });

  it('rejects a workspace symlink before writing into it', async () => {
    const root = await freshRoot();
    await preparePreviewMedia(root, 'preview_first');
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, path.join(root, 'preview_escape'));
    await expect(preparePreviewMedia(root, 'preview_escape')).rejects.toThrow(/unsafe/);
  });

  it('refuses to overwrite a different file at a reserved fixture ID', async () => {
    const root = await freshRoot();
    const result = await preparePreviewMedia(root, 'preview_workspace');
    const file = path.join(result.root, 'preview_workspace', 'images', PREVIEW_IMAGES.market.id);
    await writeFile(file, 'keep existing content');
    await expect(preparePreviewMedia(root, 'preview_workspace')).rejects.toThrow(/different/);
    expect(await readFile(file, 'utf8')).toBe('keep existing content');
  });
});
