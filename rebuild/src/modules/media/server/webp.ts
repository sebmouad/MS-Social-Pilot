import sharp from 'sharp';
import { runtimeConfig } from '@/server/config/store';
import { webpImportPolicySchema } from '../config';
import { mediaError } from './messages';

let active = 0;
/** Native work keeps its concurrency permit until it settles, including after a caller deadline. */
export async function convertWebp(bytes: Buffer): Promise<Buffer> {
  const checked = webpImportPolicySchema.safeParse(await runtimeConfig('media.webpImportPolicy'));
  if (!checked.success) throw await mediaError('unavailable', 'The media library is temporarily unavailable. Refresh and try again.');
  const policy = checked.data;
  const invalid = () => mediaError('invalid_request', 'This WebP image could not be imported. Use a still PNG or JPEG image instead.');
  if (!policy.enabled) throw await invalid();
  if (active >= policy.maxConcurrent) throw await mediaError('unavailable', 'Image conversion is busy. Try again shortly.');
  active++;
  const work = (async () => {
    const image = sharp(bytes, { failOn: 'error', limitInputPixels: policy.maxPixels });
    const meta = await image.metadata();
    if (meta.format !== 'webp' || !meta.width || !meta.height || meta.width * meta.height > policy.maxPixels || (meta.pages ?? 1) !== 1) throw new Error('Invalid image');
    const converted = await image.rotate().png().toBuffer();
    if (converted.length > policy.maxOutputBytes) throw new Error('Output too large');
    return converted;
  })();
  void work.then(() => { active--; }, () => { active--; });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Deadline')), policy.timeoutMs); })]);
  } catch { throw await invalid(); }
  finally { if (timer) clearTimeout(timer); }
}
