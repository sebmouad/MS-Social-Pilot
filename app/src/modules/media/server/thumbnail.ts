import sharp from 'sharp';

/** Widths a client may request; anything else serves the original. */
export const THUMBNAIL_WIDTHS = [160, 320, 640] as const;
const MAX_CONCURRENT = 4;
const TIMEOUT_MS = 5_000;
const MAX_PIXELS = 40_000_000;
let active = 0;

/** Small WebP for list and grid views. Null when busy, unsupported or slow: the caller then serves the original. */
export async function thumbnailWebp(bytes: Buffer, mimeType: string, width: number): Promise<Buffer | null> {
  if (!THUMBNAIL_WIDTHS.includes(width as (typeof THUMBNAIL_WIDTHS)[number]) || !/^image\/(jpeg|png|webp)$/.test(mimeType) || active >= MAX_CONCURRENT) return null;
  active++;
  const work = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_PIXELS }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  // Native work keeps its permit until it settles, including after the deadline.
  void work.then(() => { active--; }, () => { active--; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), TIMEOUT_MS); })]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
