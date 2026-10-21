import sharp from 'sharp';
import { guardedFetch, type FetchDeps, type FetchPolicy } from '@/modules/publishing/server/media/network/net-guard';
import { inspectMediaSnapshot } from '@/modules/publishing/server/media/inspect';
import { uploadWorkspaceImage, type MediaActor } from '@/modules/publishing/server/media/storage';

/**
 * Prepare the Facebook image of a recipe: download it through the address-pinned public fetch, verify it is a real
 * image, convert it to JPEG (providers do not reliably accept WebP) and store it in the workspace media folder.
 * Failures carry a short code and never expose paths, addresses or tool output.
 */
export type ImageFailure = 'image_unavailable' | 'image_invalid' | 'image_too_large';
export class RecipeImageError extends Error {
  constructor(readonly code: ImageFailure) { super(code); this.name = 'RecipeImageError'; }
}
export type ImageSettings = {
  fetch: FetchPolicy; maxPixels: number; quality: number; minQuality: number; qualityStep: number; maxOutputBytes: number;
};
export type ImagePorts = {
  download(url: string, policy: FetchPolicy): Promise<Buffer>;
  inspect(bytes: Buffer): Promise<void>;
  convert(bytes: Buffer, settings: ImageSettings): Promise<Buffer>;
  store(actor: MediaActor, bytes: Buffer, name: string): Promise<{ id: string }>;
};

/** Quality is lowered in steps until the file fits; a file that still does not fit is refused. */
export async function convertToJpeg(bytes: Buffer, s: Pick<ImageSettings, 'maxPixels' | 'quality' | 'minQuality' | 'qualityStep' | 'maxOutputBytes'>): Promise<Buffer> {
  const floor = Math.min(s.minQuality, s.quality);
  let quality = s.quality;
  for (;;) {
    const out = await sharp(bytes, { failOn: 'error', limitInputPixels: s.maxPixels }).rotate().flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer();
    if (out.length <= s.maxOutputBytes) return out;
    if (quality <= floor) throw new RecipeImageError('image_too_large');
    quality = Math.max(floor, quality - s.qualityStep);
  }
}

export const defaultImagePorts = (net: FetchDeps): ImagePorts => ({
  async download(url, policy) {
    const fetched = await guardedFetch(url, policy, net, { headers: { accept: 'image/*' } });
    if (fetched.notModified) throw new RecipeImageError('image_unavailable');
    return Buffer.from(fetched.bytes);
  },
  async inspect(bytes) { await inspectMediaSnapshot(bytes, 'image'); },
  convert: (bytes, settings) => convertToJpeg(bytes, settings),
  async store(actor, bytes, name) {
    const stored = await uploadWorkspaceImage(actor, new File([new Uint8Array(bytes)], name, { type: 'image/jpeg' }));
    return { id: stored.id };
  },
});

export async function prepareRecipeImage(ports: ImagePorts, input: { actor: MediaActor; url: string; fileName: string; settings: ImageSettings }): Promise<{ mediaId: string; bytes: number }> {
  let source: Buffer;
  try { source = await ports.download(input.url, input.settings.fetch); } catch { throw new RecipeImageError('image_unavailable'); }
  try { await ports.inspect(source); } catch { throw new RecipeImageError('image_invalid'); }
  let jpeg: Buffer;
  try { jpeg = await ports.convert(source, input.settings); } catch (error) { throw error instanceof RecipeImageError ? error : new RecipeImageError('image_invalid'); }
  try {
    const stored = await ports.store(input.actor, jpeg, input.fileName);
    return { mediaId: stored.id, bytes: jpeg.length };
  } catch { throw new RecipeImageError('image_invalid'); }
}
