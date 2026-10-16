import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

// Reserved identifiers belong only to this opt-in local fixture, never product policy.
export const PREVIEW_IMAGES = {
  market: { id: '5610a65e-7842-4a63-92ba-781de97df101', asset: 'preview-market.png', altText: 'Example North Market weekend campaign with a shopping bag illustration. Not a real offer.' },
  studio: { id: '5610a65e-7842-4a63-92ba-781de97df102', asset: 'preview-studio.png', altText: 'Example Studio Notes collection campaign with a geometric arch illustration. Not a real offer.' },
} as const;
const MARKER = '.socialpilot-preview-media';
const MARKER_CONTENT = 'MS Social Pilot synthetic preview images v1\n';

async function writeExclusive(file: string, bytes: Buffer) {
  let handle;
  try { handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error;
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('Refusing unsafe preview image file.');
    const existing = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { if (!(await existing.readFile()).equals(bytes)) throw new Error('Reserved preview file has different content; refusing to replace it.'); }
    finally { await existing.close(); }
    return;
  }
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
}

async function ensureChild(parent: string, name: string) {
  const directory = path.join(parent, name);
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) throw error; }
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('Refusing unsafe preview image directory.');
  return directory;
}

/** Called only after seed-preview has verified its loopback database and fixture namespace. */
export async function preparePreviewMedia(mediaRoot: string, workspaceId: string) {
  if (!/^preview_[A-Za-z0-9_-]+$/.test(workspaceId)) throw new Error('Image fixtures require a preview_ workspace.');
  if (!path.isAbsolute(mediaRoot)) throw new Error('Preview media root must be an absolute path to an existing empty directory.');
  const root = await realpath(mediaRoot);
  if (root === path.parse(root).root || !(await lstat(root)).isDirectory()) throw new Error('Refusing unsafe preview media root.');
  const contents = await readdir(root);
  if (!contents.includes(MARKER) && contents.length) throw new Error('Preview media root must be empty before its first use.');
  await writeExclusive(path.join(root, MARKER), Buffer.from(MARKER_CONTENT));
  const workspace = await ensureChild(root, workspaceId);
  const images = await ensureChild(workspace, 'images');
  for (const image of Object.values(PREVIEW_IMAGES)) {
    const bytes = await readFile(new URL(`./fixtures/${image.asset}`, import.meta.url));
    await writeExclusive(path.join(images, image.id), bytes);
  }
  return { root, market: `media:${PREVIEW_IMAGES.market.id}`, studio: `media:${PREVIEW_IMAGES.studio.id}` };
}
