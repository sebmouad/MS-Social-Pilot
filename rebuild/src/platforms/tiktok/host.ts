import type { PlatformHost } from '@/server/platforms/host';
import { requestLocale } from '@/server/platforms/request-locale';
import { configuredTiktokAdapter } from './runtime';
import { tiktokConnection } from './connection';
import { renewTiktokTokens } from './jobs';

/** TikTok-owned assembly. Shared services select this host through neutral dispatch. */
export const tiktokHost = {
  adapter: async () => configuredTiktokAdapter(await requestLocale()),
  connection: tiktokConnection,
  jobs: { posts: renewTiktokTokens },
} satisfies PlatformHost;
