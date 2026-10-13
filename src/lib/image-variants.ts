import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { Prisma } from '@prisma/client';
import sharp from 'sharp';

import { GraphError } from './facebook/graph';
import { cropBox, type AspectRange, type FocalPoint, type Watermark } from './image-format';
import type { PostMedia } from './json';
import { readStoredFile, resolveStoragePath } from './media';
import { prisma } from './prisma';

/**
 * Publish-time copies of a post's images: cropped to the
 * shape the destination accepts and stamped with the Page's watermark. The
 * original stays untouched in the library; each copy is a hidden Media row
 * (`derivedFromId`), made once per source and variant and reused, so a post
 * going to ten Pages with the same watermark costs one render. Copies nobody
 * references are swept with the other unused uploads.
 */

/** Formats this can redraw; a GIF may be animated and is sent as it is. */
const EDITABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);

/** Top-left corner of a box of this size, at this position, with a margin. */
function placeAt(position: Watermark['position'], width: number, height: number, boxWidth: number, boxHeight: number) {
  const margin = Math.round(Math.min(width, height) * 0.03);
  const x = position === 'center' ? (width - boxWidth) / 2 : position.endsWith('start') ? margin : width - boxWidth - margin;
  const y = position === 'center' ? (height - boxHeight) / 2 : position.startsWith('top') ? margin : height - boxHeight - margin;
  return { x: Math.round(Math.max(0, x)), y: Math.round(Math.max(0, y)) };
}

/** The watermark as an SVG the size of the image, ready to lay over it. */
async function watermarkLayer(watermark: Watermark, logo: Buffer | null, width: number, height: number): Promise<Buffer> {
  const opacity = watermark.opacity / 100;
  const boxWidth = Math.max(8, Math.round((width * watermark.size) / 100));
  let body: string;
  if (logo) {
    const resized = await sharp(logo).resize({ width: boxWidth }).png().toBuffer({ resolveWithObject: true });
    const { x, y } = placeAt(watermark.position, width, height, resized.info.width, resized.info.height);
    body = `<image x="${x}" y="${y}" width="${resized.info.width}" height="${resized.info.height}" opacity="${opacity}" href="data:image/png;base64,${resized.data.toString('base64')}"/>`;
  } else {
    const text = watermark.text ?? '';
    // Roughly 0.6 em per character, capped so a short word does not fill the frame.
    const fontSize = Math.max(10, Math.min(Math.round(boxWidth / (0.6 * Math.max(1, text.length))), Math.round(height * 0.1)));
    const textWidth = Math.round(fontSize * 0.6 * text.length);
    const { x, y } = placeAt(watermark.position, width, height, textWidth, fontSize);
    body =
      `<text x="${x}" y="${y + Math.round(fontSize * 0.85)}" font-family="sans-serif" font-weight="700" font-size="${fontSize}" ` +
      `fill="#ffffff" fill-opacity="${opacity}" stroke="#000000" stroke-opacity="${opacity * 0.35}" stroke-width="${Math.max(1, Math.round(fontSize / 24))}">${escapeXml(text)}</text>`;
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
}

/**
 * Render one image: turn it upright, crop it to the range around the focal
 * point, lay the watermark on top. Always a JPEG — Instagram takes nothing else.
 * Null when there is nothing to change.
 */
export async function renderVariant(
  source: Buffer,
  options: { range: AspectRange | null; focus?: FocalPoint; watermark: Watermark | null; logo: Buffer | null },
): Promise<Buffer | null> {
  const upright = await sharp(source).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = upright.info;
  const box = options.range ? cropBox(width, height, options.range, options.focus) : null;
  const drawWatermark = options.watermark && (options.logo || options.watermark.text);
  if (!box && !drawWatermark) return null;

  let image = sharp(upright.data);
  const finalWidth = box?.width ?? width;
  const finalHeight = box?.height ?? height;
  if (box) image = sharp(await image.extract(box).toBuffer());
  if (drawWatermark) {
    image = image.composite([{ input: await watermarkLayer(options.watermark!, options.logo, finalWidth, finalHeight), top: 0, left: 0 }]);
  }
  return image.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/**
 * The post's attachments as this destination should receive them: images
 * swapped for their cropped / watermarked copies, everything else as it is.
 * A failure is reported as a refusal of this post rather than a blip: the
 * same file will fail the same way on a retry.
 */
export async function prepareImages(options: {
  workspaceId: string;
  media: PostMedia[];
  range: AspectRange | null;
  watermark: Watermark | null;
}): Promise<PostMedia[]> {
  const { range, watermark } = options;
  if (!range && !watermark) return options.media;

  let logo: Buffer | null | undefined;
  const loadLogo = async () => {
    if (logo !== undefined) return logo;
    const file = watermark?.mediaId
      ? await prisma.media.findFirst({ where: { id: watermark.mediaId, workspaceId: options.workspaceId }, select: { storageKey: true } })
      : null;
    logo = file?.storageKey ? await readStoredFile(file.storageKey).catch(() => null) : null;
    return logo;
  };

  const out: PostMedia[] = [];
  for (const item of options.media) {
    if (item.kind !== 'image' || !item.storageKey || (item.mimeType && !EDITABLE.has(item.mimeType))) {
      out.push(item);
      continue;
    }
    const source = await prisma.media.findFirst({
      where: { id: item.id, workspaceId: options.workspaceId, derivedFromId: null },
      select: { id: true, filename: true, storageKey: true, mimeType: true },
    });
    if (!source?.storageKey || !EDITABLE.has(source.mimeType)) {
      out.push(item);
      continue;
    }

    const variant = createHash('sha256')
      .update(JSON.stringify({ v: 1, range, focus: item.focus ?? null, watermark }))
      .digest('hex')
      .slice(0, 16);
    let copy = await prisma.media.findUnique({ where: { derivedFromId_variant: { derivedFromId: source.id, variant } } });

    if (!copy) {
      let rendered: Buffer | null;
      try {
        rendered = await renderVariant(await readStoredFile(source.storageKey), {
          range,
          focus: item.focus,
          watermark,
          logo: watermark?.mediaId ? await loadLogo() : null,
        });
      } catch (error) {
        throw new GraphError({
          message: `The image ${source.filename} could not be prepared for this destination (${error instanceof Error ? error.message : String(error)}).`,
          kind: 'invalid_request',
        });
      }
      if (!rendered) {
        out.push(item);
        continue;
      }
      const storageKey = path.join(options.workspaceId, 'derived', `${source.id}-${variant}.jpg`);
      const destination = resolveStoragePath(storageKey);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, rendered);
      const meta = await sharp(rendered).metadata();
      try {
        copy = await prisma.media.create({
          data: {
            workspaceId: options.workspaceId,
            filename: source.filename.replace(/\.[^.]+$/, '') + '.jpg',
            mimeType: 'image/jpeg',
            size: rendered.byteLength,
            kind: 'image',
            storageKey,
            url: '',
            width: meta.width ?? null,
            height: meta.height ?? null,
            derivedFromId: source.id,
            variant,
          },
        });
        copy = await prisma.media.update({ where: { id: copy.id }, data: { url: `/api/media/${copy.id}/raw` } });
      } catch (error) {
        // Another worker made the same copy a moment ago: use theirs.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
        copy = await prisma.media.findUniqueOrThrow({ where: { derivedFromId_variant: { derivedFromId: source.id, variant } } });
      }
    }

    out.push({ ...item, id: copy.id, url: copy.url, storageKey: copy.storageKey!, mimeType: 'image/jpeg' });
  }
  return out;
}
