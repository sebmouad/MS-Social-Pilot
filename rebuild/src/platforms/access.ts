import type { Entry } from '@/lib/config/entry';
import type { PlatformModule } from './module';

export type StoredPlatformSetting = { key: string; value: unknown; encrypted: boolean };
type AccessModule = Pick<PlatformModule, 'id' | 'enabledKey' | 'access'>;

/** Pure installed-catalog policy resolution. Unknown plan IDs never install a module. */
export function resolvePlatformAccess(modules: readonly AccessModule[], definitions: readonly Entry[], input: {
  settings?: readonly StoredPlatformSetting[]; planFeatures?: readonly string[] | null; suspended?: boolean;
}): Record<string, boolean> {
  const registry = new Map(definitions.map(definition => [definition.key, definition]));
  const stored = new Map((input.settings ?? []).map(row => [row.key, row]));
  const value = (key: string): unknown => {
    const definition = registry.get(key);
    if (!definition || definition.kind === 'secret') return undefined;
    const row = stored.get(key);
    if (row?.encrypted) return undefined;
    const result = definition.schema.safeParse(row ? row.value : definition.defaultValue);
    return result.success ? result.data : undefined;
  };
  return Object.fromEntries(modules.map(module => {
    const enabled = value(module.enabledKey);
    const included = value(module.access.includedByDefaultKey);
    const keys = value(module.access.planFeaturesKey);
    const valid = typeof enabled === 'boolean' && typeof included === 'boolean' && Array.isArray(keys) && keys.every(key => typeof key === 'string' && key.trim().length > 0);
    const granted = valid && keys.some(key => input.planFeatures?.includes(key));
    return [module.id, !input.suspended && valid && enabled && (included || granted)];
  }));
}
