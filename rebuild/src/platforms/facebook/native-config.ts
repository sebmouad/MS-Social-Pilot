import { z } from 'zod';
import type { FacebookNativePolicy } from './formats/types';

/**
 * Root-managed settings for native Facebook formats. Same entry shape as the shared
 * registry; the lead registers these (consumption stays 'planned' until wired).
 * Defaults are starting values taken from legacy behaviour / Meta documentation and
 * are UNVERIFIED against current Graph; Root can change them without a release.
 * Protocol invariants that are NOT policy (Graph paths, field names, upload phases)
 * stay in formats/execute.ts and formats/status.ts.
 */
const n = (key: string, label: string, description: string, defaultValue: number, min: number, max: number, float = false) => ({
  key: `facebook.native.${key}`, group: 'Facebook native formats', label, kind: 'number' as const, description, defaultValue,
  schema: float ? z.number().min(min).max(max) : z.number().int().min(min).max(max), consumption: 'planned' as const,
});

export const FACEBOOK_NATIVE_CONFIG = Object.freeze([
  n('scheduleMinSeconds', 'Native schedule minimum lead (seconds)', 'Shortest time ahead Facebook accepts for a held video.', 600, 60, 86400),
  n('scheduleMaxSeconds', 'Native schedule maximum lead (seconds)', 'Furthest time ahead Facebook accepts for a held video.', 2592000, 3600, 7776000),
  n('video.maxBytes', 'Video post maximum size (bytes)', 'Largest video accepted for a Page video post.', 10737418240, 1048576, 107374182400),
  n('video.minDurationSeconds', 'Video post minimum length (seconds)', 'Shortest video accepted.', 1, 0, 600),
  n('video.maxDurationSeconds', 'Video post maximum length (seconds)', 'Longest video accepted.', 14400, 1, 86400),
  n('video.minAspect', 'Video post minimum width/height', 'Narrowest accepted frame.', 0.4, 0.1, 10, true),
  n('video.maxAspect', 'Video post maximum width/height', 'Widest accepted frame.', 2.5, 0.1, 10, true),
  n('reel.maxBytes', 'Reel maximum size (bytes)', 'Largest Reel upload.', 1073741824, 1048576, 10737418240),
  n('reel.minDurationSeconds', 'Reel minimum length (seconds)', 'Shortest Reel.', 3, 0, 600),
  n('reel.maxDurationSeconds', 'Reel maximum length (seconds)', 'Longest Reel.', 90, 1, 3600),
  n('reel.minAspect', 'Reel minimum width/height', 'Narrowest Reel frame.', 0.5, 0.1, 10, true),
  n('reel.maxAspect', 'Reel maximum width/height', 'Widest Reel frame (9:16 is 0.5625).', 0.6, 0.1, 10, true),
  n('storyVideo.maxBytes', 'Video Story maximum size (bytes)', 'Largest Story video.', 1073741824, 1048576, 10737418240),
  n('storyVideo.minDurationSeconds', 'Video Story minimum length (seconds)', 'Shortest Story video.', 3, 0, 600),
  n('storyVideo.maxDurationSeconds', 'Video Story maximum length (seconds)', 'Longest Story video.', 60, 1, 600),
  n('storyVideo.minAspect', 'Video Story minimum width/height', 'Narrowest Story frame.', 0.5, 0.1, 10, true),
  n('storyVideo.maxAspect', 'Video Story maximum width/height', 'Widest Story frame.', 0.6, 0.1, 10, true),
  n('storyPhoto.maxBytes', 'Photo Story maximum size (bytes)', 'Largest Story photo.', 4194304, 1024, 26214400),
  n('storyPhoto.minAspect', 'Photo Story minimum width/height', 'Narrowest Story photo.', 0.5, 0.1, 10, true),
  n('storyPhoto.maxAspect', 'Photo Story maximum width/height', 'Widest Story photo.', 0.6, 0.1, 10, true),
  n('poll.maxPolls', 'Processing status checks', 'How many times processing is read back before reporting it as still processing.', 6, 1, 30),
  n('poll.intervalMs', 'Processing check interval (ms)', 'Wait between status reads.', 5000, 500, 60000),
] as const);

type Values = Readonly<Record<string, number | undefined>>;

/** Build a policy from Root values; missing keys use the registry defaults. Throws on invalid or inconsistent values. */
export function facebookNativePolicyFrom(values: Values = {}): FacebookNativePolicy {
  const v = (k: string): number => {
    const e = FACEBOOK_NATIVE_CONFIG.find((x) => x.key === `facebook.native.${k}`);
    if (!e) throw new Error(`Unknown Facebook native setting ${k}.`);
    return e.schema.parse(values[e.key] ?? e.defaultValue);
  };
  const lim = (p: string, hasDuration = true) => {
    const l = {
      maxBytes: v(`${p}.maxBytes`),
      minDurationSeconds: hasDuration ? v(`${p}.minDurationSeconds`) : 0,
      maxDurationSeconds: hasDuration ? v(`${p}.maxDurationSeconds`) : 0,
      minAspect: v(`${p}.minAspect`), maxAspect: v(`${p}.maxAspect`),
    };
    if (l.minAspect > l.maxAspect || l.minDurationSeconds > l.maxDurationSeconds) throw new Error(`Facebook native ${p} limits are inconsistent.`);
    return l;
  };
  const policy = {
    scheduleMinSeconds: v('scheduleMinSeconds'), scheduleMaxSeconds: v('scheduleMaxSeconds'),
    video: lim('video'), reel: lim('reel'), storyVideo: lim('storyVideo'), storyPhoto: lim('storyPhoto', false),
    poll: { maxPolls: v('poll.maxPolls'), intervalMs: v('poll.intervalMs') },
  };
  if (policy.scheduleMinSeconds >= policy.scheduleMaxSeconds) throw new Error('Facebook native schedule window is inconsistent.');
  return policy;
}
