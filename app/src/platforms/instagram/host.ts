import type { PlatformHost } from '@/server/platforms/host';
import { configuredInstagramAdapter } from './runtime';
import { syncInstagramAnalytics, syncInstagramInbox } from './jobs';
import { instagramConnection } from './connection';
import { instagramInboxHost } from './inbox-host';
import { instagramAnalyticsHost } from './analytics-host';
import { computeInstagramDailyRollups } from './rollups';

/** Provider-owned assembly. Shared services select this host through neutral dispatch. */
export const instagramHost = {
  adapter: configuredInstagramAdapter,
  connection: instagramConnection,
  inbox: instagramInboxHost,
  analytics: { ...instagramAnalyticsHost, rollups: { computeDaily: computeInstagramDailyRollups } },
  jobs: { analytics: syncInstagramAnalytics, inbox: syncInstagramInbox },
} satisfies PlatformHost;
