import type { PlatformId } from '@/platforms';
import type { PlatformHost } from './host';
import { facebookHost } from '@/platforms/facebook/host';

export type { ConnectionViewer, PlatformHost, PlatformInboxHost, PlatformAdsHost, PlatformAnalyticsHost } from './host';

/** Explicit installed-module wiring; implementation and assembly stay in each module. */
export const PLATFORM_HOSTS: Readonly<Record<PlatformId, PlatformHost>> = {
  facebook: facebookHost,
};
