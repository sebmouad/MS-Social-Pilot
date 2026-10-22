import { z } from 'zod';
import { MODULES, PAGES } from '@/lib/product';
import { configurationOwner } from './ownership';

/** Bump when a registry key or its persisted representation changes. */
export const CONFIG_SCHEMA_VERSION = 139;

import { entry, type Entry } from './entry';
import { PLATFORM_CONFIG } from '@/platforms';
import { INSTALLED_MODULE_CONFIG } from '@/modules/installed-config';
import { SHARED_CONFIG } from './shared-config';

/**
 * This is the sole source for Root-managed runtime settings. `consumption`
 * separates live controls from settings that are stored for upcoming runtime
 * integrations; the UI must preserve that distinction.
 */
export const CONFIG_REGISTRY = [
  // Each installed platform module owns its settings (src/platforms/<id>/module.ts).
  ...PLATFORM_CONFIG,
  // Each installed product module owns its settings (src/modules/<id>/config.ts).
  ...INSTALLED_MODULE_CONFIG,
  ...SHARED_CONFIG,
  ...MODULES.map((module) => entry({ key: `entitlements.modules.${module.id}` as const, group: 'Entitlements · modules', label: `${module.title} available`, kind: 'boolean' as const, description: `Installation-wide default availability for the ${module.title} module. Existing workspace and plan restrictions remain in force.`, defaultValue: true, schema: z.boolean(), consumption: 'active' as const })),
  ...PAGES.map((page) => entry({ key: `entitlements.features.${page.id}` as const, group: 'Entitlements · features', label: `${page.title} available`, kind: 'boolean' as const, description: `Installation-wide default availability for ${page.title}. Existing workspace and plan restrictions remain in force.`, defaultValue: true, schema: z.boolean(), consumption: 'active' as const })),
] as const satisfies readonly Entry[];

export type ConfigKey = (typeof CONFIG_REGISTRY)[number]['key'];
export type ConfigValue<K extends ConfigKey> = z.infer<Extract<(typeof CONFIG_REGISTRY)[number], { key: K }>['schema']>;
export type ConfigKind = Entry['kind'];
export const CONFIG_BY_KEY = new Map<string, Entry>(CONFIG_REGISTRY.map((item) => [item.key, item]));

/** Availability controls are generated from the actual rebuild catalog. */
export const AVAILABILITY_CATALOG = {
  modules: MODULES.map(({ id, title }) => ({ id, title })),
  features: PAGES.map(({ id, title, module }) => ({ id, title, module })),
} as const;

export function safeConfigShape() {
  return (CONFIG_REGISTRY as readonly Entry[]).map(({ key, group, label, kind, description, defaultValue, consumption, options: choices }) => ({
    key, group, label, kind, description, defaultValue, consumption, options: choices, owner: configurationOwner(key),
  }));
}
