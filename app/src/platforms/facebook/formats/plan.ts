import { FacebookNativeValidationError as V, type FacebookNativePlan, type FacebookNativeRequest } from './types';

import { facebookNativePolicyFrom } from '../native-config';
import type { FacebookMediaLimit, FacebookNativeMedia, FacebookNativePolicy } from './types';

function checkLimits(m: FacebookNativeMedia, l: FacebookMediaLimit, hasDuration: boolean): void {
  const size = m.sizeBytes ?? m.bytes?.byteLength;
  if (size === undefined || !Number.isFinite(size) || size <= 0) throw new V('media_metadata_missing', 'The file size could not be determined.');
  if (size > l.maxBytes) throw new V('media_too_large', 'The file is larger than Facebook allows for this format.');
  if (!Number.isFinite(m.width) || !Number.isFinite(m.height) || !m.width || !m.height || m.width <= 0 || m.height <= 0) throw new V('media_metadata_missing', 'The dimensions could not be determined.');
  const aspect = m.width / m.height;
  if (aspect < l.minAspect || aspect > l.maxAspect) throw new V('media_aspect_out_of_range', 'The frame shape is not accepted for this format.');
  if (hasDuration) {
    if (m.durationSeconds === undefined || !Number.isFinite(m.durationSeconds) || m.durationSeconds <= 0) throw new V('media_metadata_missing', 'The video length could not be determined.');
    if (m.durationSeconds < l.minDurationSeconds || m.durationSeconds > l.maxDurationSeconds) throw new V('media_duration_out_of_range', 'The video length is not accepted for this format.');
  }
}

function checkSource(m: { url?: string; bytes?: Uint8Array }): void {
  if (!m.url && !m.bytes?.byteLength) throw new V('media_source_missing', 'The media file is not available.');
  if (m.url && !/^https:\/\//i.test(m.url)) throw new V('media_url_not_https', 'Media must be served over HTTPS.');
}

function caption(text?: string, link?: string | null): string {
  // Media edges have no link field: a link is appended to the caption text.
  return [text?.trim(), link].filter(Boolean).join('\n\n');
}

/** Pure validation and routing. Throws FacebookNativeValidationError; never touches the network. */
export function planFacebookNative(req: FacebookNativeRequest): FacebookNativePlan {
  const policy: FacebookNativePolicy = req.policy ?? facebookNativePolicyFrom();
  if (req.targetKind !== 'page') throw new V('target_kind_unsupported', 'This format can only go to a Page.');
  const images = req.media.filter((m) => m.kind === 'image');
  const videos = req.media.filter((m) => m.kind === 'video');
  if (images.length && videos.length) throw new V('mixed_media', 'A post cannot mix photos and a video.');
  if (videos.length > 1) throw new V('single_video_required', 'Only one video is allowed.');
  req.media.forEach(checkSource);
  if (req.format === 'post') {
    if (videos.length !== 1) throw new V('format_not_planned', 'Only video posts are planned here; use the standard publisher for text and photos.');
    checkLimits(videos[0]!, policy.video, true);
    return { format: 'video', targetId: req.targetId, media: videos[0]!, description: caption(req.text, req.link), scheduledUnix: scheduleUnix(req, policy) };
  }
  if (req.scheduledAt) throw new V('schedule_unsupported_for_format', 'Native scheduling for this format is not implemented; use the application queue.');
  if (req.format === 'reel') {
    if (videos.length !== 1 || images.length) throw new V('single_video_required', 'A Reel needs exactly one video.');
    checkLimits(videos[0]!, policy.reel, true);
    return { format: 'reel', targetId: req.targetId, media: videos[0]!, description: caption(req.text, req.link) };
  }
  if (req.media.length !== 1) throw new V('single_media_required', 'A Story needs exactly one photo or one video.');
  if (videos.length === 1) checkLimits(videos[0]!, policy.storyVideo, true); else checkLimits(images[0]!, policy.storyPhoto, false);
  return videos.length === 1
    ? { format: 'story_video', targetId: req.targetId, media: videos[0]! }
    : { format: 'story_photo', targetId: req.targetId, media: images[0]! };
}

function scheduleUnix(req: FacebookNativeRequest, policy: FacebookNativePolicy): number | null {
  if (!req.scheduledAt) return null;
  if (!Number.isFinite(req.scheduledAt.getTime()) || !Number.isFinite((req.now ?? new Date()).getTime())) throw new V('schedule_too_soon', 'Choose a valid publishing date.');
  const delta = Math.floor((req.scheduledAt.getTime() - (req.now ?? new Date()).getTime()) / 1000);
  if (delta < policy.scheduleMinSeconds) throw new V('schedule_too_soon', 'Facebook requires scheduled posts to be further ahead.');
  if (delta > policy.scheduleMaxSeconds) throw new V('schedule_too_far', 'Facebook cannot hold a post that far ahead.');
  return Math.floor(req.scheduledAt.getTime() / 1000);
}
