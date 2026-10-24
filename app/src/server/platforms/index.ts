import type { PlatformId } from '@/platforms';
import type { PlatformHost } from './host';
import { instagramHost } from '@/platforms/instagram/host';
import { facebookHost } from '@/platforms/facebook/host';
import { youtubeHost } from '@/platforms/youtube/host';
import { tiktokHost } from '@/platforms/tiktok/host';
import { blueskyHost } from '@/platforms/bluesky/host';
import { telegramHost } from '@/platforms/telegram/host';

import { mastodonHost } from '@/platforms/mastodon/host';
import { linkedinHost } from '@/platforms/linkedin/host';
import { threadsHost } from '@/platforms/threads/host';
import { xHost } from '@/platforms/x/host';
import { pinterestHost } from '@/platforms/pinterest/host';

export type { ConnectionViewer, PlatformHost, PlatformInboxHost, PlatformAdsHost, PlatformAnalyticsHost } from './host';

/** Explicit installed-module wiring; implementation and assembly stay in each module. */
export const PLATFORM_HOSTS: Readonly<Record<PlatformId, PlatformHost>> = {
  facebook: facebookHost,
  instagram: instagramHost,
  youtube: youtubeHost,
  tiktok: tiktokHost,
  bluesky: blueskyHost,
  telegram: telegramHost,
  mastodon: mastodonHost,
  linkedin: linkedinHost,
  threads: threadsHost,
  x: xHost,
  pinterest: pinterestHost,
};
