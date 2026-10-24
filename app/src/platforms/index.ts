import { BLUESKY_CONFIG } from './bluesky/config';
import { blueskyModule } from './bluesky/module';
import { TELEGRAM_CONFIG } from './telegram/config';
import { telegramModule } from './telegram/module';
import { LINKEDIN_CONFIG } from './linkedin/config';
import { PINTEREST_CONFIG } from './pinterest/config';
import { linkedinModule } from './linkedin/module';
export { linkedinModule };
import { pinterestModule } from './pinterest/module';
export { pinterestModule };
import { INSTAGRAM_CONFIG } from './instagram/config';
import { instagramModule } from './instagram/module';
export { instagramModule };
import { FACEBOOK_ADS_CREATION_CONFIG } from './facebook/ads-ui-config';
import { FACEBOOK_CONFIG, facebookModule } from './facebook/module';
import { YOUTUBE_CONFIG } from './youtube/config';
import { youtubeModule } from './youtube/module';
import { TIKTOK_CONFIG } from './tiktok/config';
import { tiktokModule } from './tiktok/module';
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
export const STAGED_PLATFORM_MODULES = [] as const satisfies readonly PlatformModule[];
export const STAGED_PLATFORM_IDS: readonly string[] = [];

export const PLATFORM_MODULES = [facebookModule, instagramModule, youtubeModule, tiktokModule, blueskyModule, telegramModule, mastodonModule, linkedinModule, threadsModule, xModule, pinterestModule] as const satisfies readonly PlatformModule[];

/** Every module's Root settings, merged into the configuration registry. */
export const PLATFORM_CONFIG = [...LINKEDIN_CONFIG, ...PINTEREST_CONFIG, ...BLUESKY_CONFIG, ...TELEGRAM_CONFIG, ...MASTODON_CONFIG, ...THREADS_CONFIG, ...X_CONFIG, ...INSTAGRAM_CONFIG, ...YOUTUBE_CONFIG, ...TIKTOK_CONFIG, ...FACEBOOK_CONFIG, ...FACEBOOK_ADS_CREATION_CONFIG.map(setting => ({ ...setting, owner: { kind: 'platform' as const, id: facebookModule.id } }))] as const;

export type PlatformId = (typeof PLATFORM_MODULES)[number]['id'];

export const PRIMARY_PLATFORM_IDS: readonly PlatformId[] = ['facebook', 'instagram'] as const;

/**
 * Canonical capability matrix for all 11 installed social connectors.
 * Primary connectors (Facebook, Instagram) are enabled by default; secondary/beta connectors
 * default to disabled and can be toggled live by Root Admin in `/root/platforms` or `/root/config`.
 */
export const PLATFORM_CAPABILITY_MATRIX = PLATFORM_MODULES.map((m) => ({
  id: m.id,
  name: m.name,
  tier: (PRIMARY_PLATFORM_IDS.includes(m.id as PlatformId) ? 'primary' : 'secondary') as 'primary' | 'secondary',
  enabledKey: m.enabledKey,
  requiredSettings: m.requiredSettings,
  channelKinds: m.channelKinds,
  capabilities: m.capabilities,
}));

export function platformModule(id: string): PlatformModule | undefined {
  return (PLATFORM_MODULES as readonly PlatformModule[]).find((module) => module.id === id);
}
