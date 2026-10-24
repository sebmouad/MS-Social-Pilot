import { moduleManifests } from '@/modules';
import { PLATFORM_CONFIG } from '@/platforms';

export type ConfigurationOwner = { kind: 'shared' } | { kind: 'product' | 'platform'; id: string };
const platformOwners = new Map(PLATFORM_CONFIG.map(setting => [setting.key, setting.owner]));

/**
 * Ownership follows installed declarations, never labels, provider names or UI heuristics.
 * An explicit key declaration wins over another module's prefix: key namespace is not
 * ownership (for example Studio owns `publishing.captionTestsSchedule`, whose name stays
 * so stored Root values keep working).
 */
export function configurationOwner(key: string): ConfigurationOwner {
  const platform = platformOwners.get(key as typeof PLATFORM_CONFIG[number]['key']);
  if (platform) return platform;
  for (const module of moduleManifests) {
    if (key === `entitlements.modules.${module.id}` || module.pages.some(page => key === `entitlements.features.${page.id}`)
      || module.rootSettingKeys.some(setting => setting === key)) return { kind: 'product', id: module.id };
  }
  for (const module of moduleManifests) {
    if (module.rootSettingsPrefixes.some(prefix => key.startsWith(prefix))) return { kind: 'product', id: module.id };
  }
  return { kind: 'shared' };
}
