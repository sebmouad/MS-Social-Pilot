import type { PlatformHost } from '@/server/platforms/host';
import { configuredInstagramAdapter } from './runtime';
import { syncInstagramAnalytics } from './jobs';
import { instagramConnection } from './connection';
import { instagramInboxHost } from './inbox-host';
import { instagramAnalyticsHost } from './analytics-host';

/** Provider-owned assembly. Shared services select this host through neutral dispatch. */
export const instagramHost = {
  adapter: configuredInstagramAdapter,
  connection: instagramConnection,
  inbox: instagramInboxHost,
  analytics: instagramAnalyticsHost,
  jobs: { analytics: syncInstagramAnalytics },
} satisfies PlatformHost;
