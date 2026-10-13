/**
 * Root's platform sections: which configuration keys belong to Meta, which to
 * each other network, and which stay on the generic Configuration screen.
 * Plain module (no Prisma) so pages, tests and client components can share it.
 */

/** Networks with their own root section, in menu order (Meta has its own). */
export const OTHER_PLATFORMS = [
  'bluesky',
  'mastodon',
  'linkedin',
  'threads',
  'x',
  'pinterest',
  'telegram',
  'youtube',
  'tiktok',
] as const;

export type OtherPlatform = (typeof OTHER_PLATFORMS)[number];

export function isOtherPlatform(value: string): value is OtherPlatform {
  return (OTHER_PLATFORMS as readonly string[]).includes(value);
}

/** Channel platforms (see root-connections) shown in the Meta section. */
export const META_CHANNEL_PLATFORMS = ['facebook', 'instagram'] as const;

/** Setting groups that are Meta's alone: the app itself and the Meta-only feature switches. */
const META_GROUPS = new Set(['facebook', 'features']);

/**
 * The section a configuration key lives in: 'meta', a network key, or null for
 * the generic Configuration screen.
 */
export function settingSection(key: string, group: string): 'meta' | OtherPlatform | null {
  if (META_GROUPS.has(group)) return 'meta';
  const [head, tail] = key.split('.');
  if (head === 'networks' && tail && isOtherPlatform(tail)) return tail;
  if (head && isOtherPlatform(head)) return head;
  return null;
}

/** Where root manages a channel platform. */
export function platformHref(platform: string): string {
  return (META_CHANNEL_PLATFORMS as readonly string[]).includes(platform) ? '/root/meta/connections' : `/root/platforms/${platform}`;
}

/** Where root sets up the app a channel type needs (Meta's app, or the network's). */
export function platformSettingsHref(type: string): string {
  if (isOtherPlatform(type)) return `/root/platforms/${type}`;
  return '/root/meta';
}

/** Brand names for the root menu (client-safe; the connectors carry the same labels). */
export const PLATFORM_NAMES: Record<OtherPlatform, string> = {
  bluesky: 'Bluesky',
  mastodon: 'Mastodon',
  linkedin: 'LinkedIn',
  threads: 'Threads',
  x: 'X',
  pinterest: 'Pinterest',
  telegram: 'Telegram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
};
