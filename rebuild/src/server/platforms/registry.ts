import type { CapabilityDeclaration, PlatformAdapter } from '@/platforms/types';
import { configuredFacebookAdapter } from './facebook';
import { runtimeConfig } from '@/server/config/store';

type PlatformFactory = () => Promise<PlatformAdapter>;

/** The installed adapters are private runtime wiring. Product code dispatches by
 * provider ID and capability; customers only see enabled destinations. */
const factories: Readonly<Record<string, PlatformFactory>> = {
  facebook: configuredFacebookAdapter,
};

export async function platformFor(provider: string, capability: keyof CapabilityDeclaration): Promise<PlatformAdapter | null> {
  const factory = factories[provider];
  if (!factory) return null;
  if (await runtimeConfig(`platforms.${provider}.enabled`) !== true) return null;
  const adapter = await factory();
  return adapter.capabilities[capability] === 'supported' ? adapter : null;
}
