import { INSTAGRAM_CONFIG } from './instagram/config';
import { instagramModule } from './instagram/module';
export { instagramModule };
import { FACEBOOK_ADS_CREATION_CONFIG } from './facebook/ads-ui-config';
import { FACEBOOK_CONFIG, facebookModule } from './facebook/module';
import type { PlatformModule } from './module';
import { MASTODON_CONFIG } from './mastodon/config';
import { mastodonModule } from './mastodon/module';
import { THREADS_CONFIG } from './threads/config';
import { threadsModule } from './threads/module';
import { X_CONFIG } from './x/config';
import { xModule } from './x/module';

/**
 * Installed platform modules — the only list of platforms in the product.
 *
 * To add a platform: create `src/platforms/<id>/` (engine + `module.ts` with its
 * manifest and settings), add the manifest and settings here, and its server
 * wiring to `src/server/platforms/index.ts`. Root then shows it on the Platforms
 * screen with its on/off switch, and customers see it once it is on and set up.
 */
/** Platform modules whose settings are registered while host wiring is pending; not customer-visible (enabled defaults to false). */
export const STAGED_PLATFORM_MODULES = [mastodonModule, threadsModule, xModule] as const satisfies readonly PlatformModule[];
export const STAGED_PLATFORM_IDS: readonly string[] = STAGED_PLATFORM_MODULES.map(module => module.id);

export const PLATFORM_MODULES = [facebookModule, instagramModule] as const satisfies readonly PlatformModule[];

/** Every module's Root settings, merged into the configuration registry. */
export const PLATFORM_CONFIG = [...MASTODON_CONFIG, ...THREADS_CONFIG, ...X_CONFIG, ...INSTAGRAM_CONFIG, ...FACEBOOK_CONFIG, ...FACEBOOK_ADS_CREATION_CONFIG.map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: facebookModule.id } }))] as const;

export type PlatformId = (typeof PLATFORM_MODULES)[number]['id'];

export function platformModule(id: string): PlatformModule | undefined {
  return (PLATFORM_MODULES as readonly PlatformModule[]).find((module) => module.id === id);
}
