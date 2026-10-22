import type { PlatformId } from '@/platforms';
import type { PlatformHost } from './host';
import { instagramHost } from '@/platforms/instagram/host';
import { facebookHost } from '@/platforms/facebook/host';
import { youtubeHost } from '@/platforms/youtube/host';
import { tiktokHost } from '@/platforms/tiktok/host';
import { blueskyHost } from '@/platforms/bluesky/host';
import { telegramHost } from '@/platforms/telegram/host';

export type { ConnectionViewer, PlatformHost, PlatformInboxHost, PlatformAdsHost, PlatformAnalyticsHost } from './host';

/** Explicit installed-module wiring; implementation and assembly stay in each module. */
export const PLATFORM_HOSTS: Readonly<Record<PlatformId, PlatformHost>> = {
  facebook: facebookHost,
  instagram: instagramHost,
  youtube: youtubeHost,
  tiktok: tiktokHost,
  bluesky: blueskyHost,
  telegram: telegramHost,
};
