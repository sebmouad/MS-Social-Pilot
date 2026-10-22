import type { PlatformHost } from '@/server/platforms/host';
import { requestLocale } from '@/server/platforms/request-locale';
import { configuredYoutubeAdapter } from './runtime';
import { youtubeConnection } from './connection';
import { renewYoutubeTokens } from './jobs';

/** YouTube-owned assembly. Shared services select this host through neutral dispatch. */
export const youtubeHost = {
  adapter: async () => configuredYoutubeAdapter(await requestLocale()),
  connection: youtubeConnection,
  jobs: { posts: renewYoutubeTokens },
} satisfies PlatformHost;
