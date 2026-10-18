import { FACEBOOK_ADS_CREATION_CONFIG } from './facebook/ads-ui-config';
import { FACEBOOK_CONFIG, facebookModule } from './facebook/module';
import type { PlatformModule } from './module';

/**
 * Installed platform modules — the only list of platforms in the product.
 *
 * To add a platform: create `src/platforms/<id>/` (engine + `module.ts` with its
 * manifest and settings), add the manifest and settings here, and its server
 * wiring to `src/server/platforms/index.ts`. Root then shows it on the Platforms
 * screen with its on/off switch, and customers see it once it is on and set up.
 */
export const PLATFORM_MODULES = [facebookModule] as const satisfies readonly PlatformModule[];

/** Every module's Root settings, merged into the configuration registry. */
export const PLATFORM_CONFIG = [...FACEBOOK_CONFIG, ...FACEBOOK_ADS_CREATION_CONFIG.map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: facebookModule.id } }))] as const;

export type PlatformId = (typeof PLATFORM_MODULES)[number]['id'];

export function platformModule(id: string): PlatformModule | undefined {
  return (PLATFORM_MODULES as readonly PlatformModule[]).find((module) => module.id === id);
}
