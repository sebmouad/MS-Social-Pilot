import sharp from 'sharp';

/** Widths a client may request; anything else serves the original. */
export const THUMBNAIL_WIDTHS = [160, 320, 640] as const;
const MAX_CONCURRENT = 4;
const TIMEOUT_MS = 5_000;
const MAX_PIXELS = 40_000_000;
let active = 0;

/** Small WebP for list and grid views. Null when unsupported or not ready within the deadline: the caller then serves the original. */
const waiting: Array<() => void> = [];
/** Waits for one of the MAX_CONCURRENT slots (a page asks for many thumbnails at once); false after the deadline. */
function acquire(deadline: number): Promise<boolean> {
  if (active < MAX_CONCURRENT) { active++; return Promise.resolve(true); }
  return new Promise(resolve => {
    const wake = () => { clearTimeout(timer); active++; resolve(true); };
    const timer = setTimeout(() => { const index = waiting.indexOf(wake); if (index >= 0) waiting.splice(index, 1); resolve(false); }, Math.max(0, deadline - Date.now()));
    waiting.push(wake);
  });
}
function release() { active--; waiting.shift()?.(); }

export async function thumbnailWebp(bytes: Buffer, mimeType: string, width: number): Promise<Buffer | null> {
  if (!THUMBNAIL_WIDTHS.includes(width as (typeof THUMBNAIL_WIDTHS)[number]) || !/^image\/(jpeg|png|webp)$/.test(mimeType)) return null;
  const deadline = Date.now() + TIMEOUT_MS;
  if (!await acquire(deadline)) return null;
  const work = sharp(bytes, { failOn: 'error', limitInputPixels: MAX_PIXELS }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
  // Native work keeps its permit until it settles, including after the deadline.
  void work.then(release, release);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, deadline - Date.now())); })]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
