import { runtimeConfig } from '@/server/config/store';
import { mediaPresentationPolicy, mediaPresentationPolicySchema, type MediaPresentationPolicy } from './config';

/** Safe shipped defaults keep storage usable until the owning config import is integrated. */
export async function loadMediaPresentationPolicy(): Promise<MediaPresentationPolicy> {
  let value: unknown;
  try { value = await runtimeConfig('storage.mediaPresentationPolicy'); }
  catch { return mediaPresentationPolicy; }
  return mediaPresentationPolicySchema.default(mediaPresentationPolicy).parse(value);
}
