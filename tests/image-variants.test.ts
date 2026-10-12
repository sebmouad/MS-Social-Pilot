import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { renderVariant } from '../src/lib/image-variants';

const solid = (width: number, height: number, colour: string) =>
  sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer();

async function pixel(image: Buffer, x: number, y: number) {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  return [data[at]!, data[at + 1]!, data[at + 2]!];
}

describe('renderVariant', () => {
  it('returns nothing when there is nothing to do', async () => {
    expect(await renderVariant(await solid(100, 100, '#336699'), { range: { min: 0.8, max: 1.91 }, watermark: null, logo: null })).toBeNull();
  });

  it('crops to the range as a JPEG', async () => {
    const out = await renderVariant(await solid(1000, 2000, '#336699'), { range: { min: 0.8, max: 1.91 }, watermark: null, logo: null });
    const meta = await sharp(out!).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1000, 1250]);
  });

  it('lays a logo in the chosen corner and leaves the rest of the image alone', async () => {
    const logo = await solid(50, 50, '#ff0000');
    const out = await renderVariant(await solid(400, 400, '#000000'), {
      range: null,
      watermark: { mediaId: 'logo', position: 'bottom-end', opacity: 100, size: 25 },
      logo,
    });
    const [r] = await pixel(out!, 400 - 12 - 50, 400 - 12 - 50);
    expect(r).toBeGreaterThan(200);
    const [r2] = await pixel(out!, 20, 20);
    expect(r2).toBeLessThan(30);
  });

  it('draws text at the opacity asked', async () => {
    const out = await renderVariant(await solid(600, 300, '#000000'), {
      range: null,
      watermark: { text: 'Client A', position: 'center', opacity: 100, size: 40 },
      logo: null,
    });
    const { data } = await sharp(out!).raw().toBuffer({ resolveWithObject: true });
    expect(data.some((value) => value > 200)).toBe(true);
  });
});
