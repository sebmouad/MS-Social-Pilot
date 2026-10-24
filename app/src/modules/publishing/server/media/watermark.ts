import sharp from 'sharp';
import type { WatermarkOptions } from '@/modules/settings/watermark/contracts';

/** Shared raster pipeline: buffers in, new PNG bytes out. Never writes either input. */
export async function watermarkImage(source: Buffer, logo: Buffer, options: WatermarkOptions, maxPixels: number): Promise<Buffer> {
  const input = sharp(source, { failOn: 'error', limitInputPixels: maxPixels });
  const metadata = await input.metadata();
  if (!['png', 'jpeg'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) throw new Error('Only still PNG/JPEG images can be watermarked.');
  // Apply EXIF orientation before measuring: portrait JPEGs otherwise get the wrong size.
  const oriented = await input.rotate().png().toBuffer({ resolveWithObject: true });
  const overlay = await sharp(logo, { failOn: 'error', limitInputPixels: maxPixels })
    .resize({ width: Math.max(1, Math.round(oriented.info.width * options.scale)), height: Math.max(1, Math.round(oriented.info.height * options.scale)), fit: 'inside' })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let index = 3; index < overlay.data.length; index += 4) overlay.data[index] = Math.round(overlay.data[index]! * options.opacity);
  return sharp(oriented.data).composite([{ input: overlay.data, raw: { width: overlay.info.width, height: overlay.info.height, channels: 4 }, gravity: options.position }]).png().toBuffer();
}
