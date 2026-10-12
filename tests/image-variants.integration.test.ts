import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Publish-time copies (NEXT_PHASES G13): made once, hidden from the library, gone with their source. */

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let variants: typeof import('../src/lib/image-variants');
let media: typeof import('../src/lib/media');
const mediaDir = mkdtempSync(path.join(tmpdir(), 'msp-variants-'));

beforeAll(async () => {
  setTestEnv({ MEDIA_DIR: mediaDir });
  database = setupTestDatabase('image_variants');
  ({ prisma } = await import('../src/lib/prisma'));
  variants = await import('../src/lib/image-variants');
  media = await import('../src/lib/media');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
  rmSync(mediaDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.media.deleteMany();
  await prisma.workspace.deleteMany();
});

async function seed() {
  const workspace = await prisma.workspace.create({ data: { name: 'Client A', slug: `client-a-${Date.now()}` } });
  const storageKey = path.join(workspace.id, 'tall.png');
  mkdirSync(path.join(mediaDir, workspace.id), { recursive: true });
  writeFileSync(
    path.join(mediaDir, storageKey),
    await sharp({ create: { width: 1000, height: 2000, channels: 3, background: '#336699' } }).png().toBuffer(),
  );
  const source = await prisma.media.create({
    data: { workspaceId: workspace.id, filename: 'tall.png', mimeType: 'image/png', size: 1, kind: 'image', storageKey, url: '/x' },
  });
  return { workspace, source };
}

describe('prepareImages', () => {
  it('leaves attachments alone when the destination needs nothing', async () => {
    const { workspace, source } = await seed();
    const item = { id: source.id, kind: 'image' as const, url: source.url, storageKey: source.storageKey!, mimeType: 'image/png' };
    expect(await variants.prepareImages({ workspaceId: workspace.id, media: [item], range: null, watermark: null })).toEqual([item]);
  });

  it('makes one cropped, watermarked JPEG per variant, reuses it, and hides it from the library', async () => {
    const { workspace, source } = await seed();
    const item = { id: source.id, kind: 'image' as const, url: source.url, storageKey: source.storageKey!, mimeType: 'image/png', altText: 'A tall picture' };
    const options = {
      workspaceId: workspace.id,
      media: [item],
      range: { min: 0.8, max: 1.91 },
      watermark: { text: 'Client A', position: 'bottom-end' as const, opacity: 70, size: 15 },
    };

    const [first] = await variants.prepareImages(options);
    expect(first!.id).not.toBe(source.id);
    expect(first!.altText).toBe('A tall picture');
    expect(first!.mimeType).toBe('image/jpeg');
    const meta = await sharp(path.join(mediaDir, first!.storageKey!)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1000, 1250]);

    const [again] = await variants.prepareImages(options);
    expect(again!.id).toBe(first!.id);
    expect(await prisma.media.count({ where: { derivedFromId: source.id } })).toBe(1);

    // Another focal point is another copy.
    await variants.prepareImages({ ...options, media: [{ ...item, focus: { x: 0.5, y: 0 } }] });
    expect(await prisma.media.count({ where: { derivedFromId: source.id } })).toBe(2);

    const library = await media.readMediaLibrary(workspace.id);
    expect(library.files.map((file) => file.id)).toEqual([source.id]);

    // Deleting the original takes its copies, rows and files.
    const copies = await prisma.media.findMany({ where: { derivedFromId: source.id } });
    expect(await media.deleteMedia({ workspaceId: workspace.id, role: 'owner', mediaId: source.id })).toEqual({ outcome: 'ok' });
    expect(await prisma.media.count({ where: { workspaceId: workspace.id } })).toBe(0);
    for (const copy of copies) expect(existsSync(path.join(mediaDir, copy.storageKey!))).toBe(false);
  });
});
