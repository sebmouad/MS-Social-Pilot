import { createHash } from 'node:crypto';
import type { FacebookNativeMedia, FacebookNativePlan } from './types';

/** Versioned, content-free identity for the exact payload held by one worker.
 * This is not a remote-content digest: a URL can serve different bytes later.
 * Provider-hosted URL immutability must be established by the authoring host.
 */
export function snapshotFacebookNativePlan(input: FacebookNativePlan): {
  plan: FacebookNativePlan;
  payloadHash: string;
} {
  const invalid = () => new Error('The Facebook native publishing payload is invalid.');
  if (!input || typeof input !== 'object' || !input.media || typeof input.media !== 'object') throw invalid();
  // Runtime callers cannot smuggle a schedule into a format whose plan has no
  // scheduling contract and accidentally submit immediately.
  if (input.format !== 'video' && 'scheduledUnix' in input ||
    (input.format === 'story_photo' || input.format === 'story_video') && 'description' in input) throw invalid();
  // Copy every used field explicitly, before any await. Never retain a Buffer
  // view: Buffer.slice() shares memory with the caller.
  const source = input.media;
  if (source.bytes !== undefined && !(source.bytes instanceof Uint8Array)) {
    throw invalid();
  }
  const media: FacebookNativeMedia = {
    kind: source.kind,
    ...(source.url !== undefined ? { url: source.url } : {}),
    ...(source.bytes !== undefined ? { bytes: new Uint8Array(source.bytes) } : {}),
    ...(source.fileName !== undefined ? { fileName: source.fileName } : {}),
    ...(source.mimeType !== undefined ? { mimeType: source.mimeType } : {}),
    ...(source.sizeBytes !== undefined ? { sizeBytes: source.sizeBytes } : {}),
    ...(source.durationSeconds !== undefined ? { durationSeconds: source.durationSeconds } : {}),
    ...(source.width !== undefined ? { width: source.width } : {}),
    ...(source.height !== undefined ? { height: source.height } : {}),
  };
  const common = { targetId: input.targetId, media };
  let plan: FacebookNativePlan;
  switch (input.format) {
    case 'video': plan = { ...common, format: input.format, description: input.description, scheduledUnix: input.scheduledUnix }; break;
    case 'reel': plan = { ...common, format: input.format, description: input.description }; break;
    case 'story_photo':
    case 'story_video': plan = { ...common, format: input.format }; break;
    default: throw new Error('Unknown Facebook native publishing format.');
  }
  if (typeof plan.targetId !== 'string' || !plan.targetId.trim() || plan.targetId !== plan.targetId.trim() ||
    plan.targetId.length > 2048 || /[\u0000-\u001f\u007f/]/.test(plan.targetId)) throw invalid();
  if ('description' in plan && typeof plan.description !== 'string') throw invalid();
  if ('scheduledUnix' in plan && plan.scheduledUnix !== null &&
    (!Number.isSafeInteger(plan.scheduledUnix) || plan.scheduledUnix < 1)) throw invalid();
  if (media.kind !== (plan.format === 'story_photo' ? 'image' : 'video')) throw invalid();
  if (media.bytes !== undefined && (media.bytes.byteLength === 0 || media.url !== undefined)) throw invalid();
  if ((plan.format === 'video' || plan.format === 'story_photo') && media.url === undefined) {
    throw new Error('This upload path requires an HTTPS media URL.');
  }
  if (media.url !== undefined) {
    try {
      const url = new URL(media.url);
      if (typeof media.url !== 'string' || url.protocol !== 'https:' || url.href !== media.url ||
        url.username || url.password || url.hash) throw invalid();
    } catch { throw invalid(); }
  } else if (media.bytes === undefined) throw invalid();
  for (const value of [media.sizeBytes, media.durationSeconds, media.width, media.height]) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) throw invalid();
  }
  if (media.sizeBytes !== undefined && (!Number.isSafeInteger(media.sizeBytes) ||
    media.bytes !== undefined && media.sizeBytes !== media.bytes.byteLength)) throw invalid();
  if (media.fileName !== undefined && typeof media.fileName !== 'string' ||
    media.mimeType !== undefined && typeof media.mimeType !== 'string') throw invalid();
  // Fixed field order distinguishes absence from explicit values. Only hashes
  // of bytes are included, never media bytes or text in the durable journal.
  const identity = [
    'facebook-native-payload-v1', plan.format, plan.targetId,
    'description' in plan ? plan.description : null,
    'scheduledUnix' in plan ? plan.scheduledUnix : null,
    media.kind, media.url ?? null,
    media.bytes !== undefined ? createHash('sha256').update(media.bytes).digest('hex') : null,
    media.fileName ?? null, media.mimeType ?? null, media.sizeBytes ?? null,
    media.durationSeconds ?? null, media.width ?? null, media.height ?? null,
  ];
  Object.freeze(media);
  Object.freeze(plan);
  return { plan, payloadHash: createHash('sha256').update(JSON.stringify(identity)).digest('hex') };
}
