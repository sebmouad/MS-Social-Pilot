import type { ZodType } from 'zod';
import { CONFIG_BY_KEY, type ConfigKey, type ConfigValue } from '@/lib/config/registry';
import { runtimeConfig } from './store';

/**
 * Read a Root setting for presentation or policy; when the stored value is missing, unreadable or
 * invalid, fall back to the registry default (validated by the same schema) instead of failing the
 * whole request. Copy catalogs and display policies must never take a page or API call down.
 */
export async function configOrDefault<T>(key: string, schema: ZodType<T>): Promise<T> {
  try {
    const parsed = schema.safeParse(await runtimeConfig(key));
    if (parsed.success) return parsed.data;
  } catch { /* fall through to the registry default */ }
  return schema.parse(CONFIG_BY_KEY.get(key as never)?.defaultValue);
}

/** Unvalidated variant for catalogs whose shape is checked by the caller: missing or unreadable → registry default. */
export async function configValueOrDefault<K extends ConfigKey>(key: K): Promise<ConfigValue<K>> {
  try {
    const value = await runtimeConfig(key);
    const fallback = CONFIG_BY_KEY.get(key)?.defaultValue;
    const sameShape = typeof value === typeof fallback && Array.isArray(value) === Array.isArray(fallback);
    if (value !== undefined && value !== null && sameShape) return value as ConfigValue<K>;
  } catch { /* fall through */ }
  return CONFIG_BY_KEY.get(key)?.defaultValue as ConfigValue<K>;
}
