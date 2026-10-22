import type { PlatformHost } from '@/server/platforms/host';
import { configuredEngine } from './runtime';
import { linkedinConnection } from './connection';
export const linkedinHost = { adapter: async () => (await configuredEngine()).adapter, connection: linkedinConnection } satisfies PlatformHost;
