import type { PlatformHost } from '@/server/platforms/host';
import { configuredEngine } from './runtime';
import { pinterestConnection } from './connection';
export const pinterestHost = { adapter: async () => (await configuredEngine()).adapter, connection: pinterestConnection } satisfies PlatformHost;
