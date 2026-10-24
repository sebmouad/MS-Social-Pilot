import type { PlatformHost } from '@/server/platforms/host';
import { requestLocale } from '@/server/platforms/request-locale';
import { configuredBlueskyAdapter } from './runtime';
import { blueskyConnection } from './connection';

/** Bluesky-owned assembly. Shared services select this host through neutral dispatch. */
export const blueskyHost = {
  adapter: async () => configuredBlueskyAdapter(await requestLocale()),
  connection: blueskyConnection,
} satisfies PlatformHost;
