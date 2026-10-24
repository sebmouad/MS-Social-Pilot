import { createDecipheriv } from 'node:crypto';
import { CONFIG_BY_KEY, CONFIG_REGISTRY, type ConfigKey, type ConfigValue } from '@/lib/config/registry';
import { prisma } from '@/server/data';

// AES-256-GCM envelope v1 invariant: key width.
// These cannot vary without a separately versioned encryption format.
const CONFIG_SECRET_KEY_BYTES = 32;

const secretKey = () => {
  const encoded = process.env.ENCRYPTION_KEY;
  if (!encoded) throw new Error('ENCRYPTION_KEY is required before saving secret configuration.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== CONFIG_SECRET_KEY_BYTES) throw new Error('ENCRYPTION_KEY must decode to 32 bytes.');
  return key;
};

function decrypt(value: string): string {
  const parts = value.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Malformed encrypted configuration.');
  const [, iv, tag, body] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

/** Runtime readers always validate stored values against the current registry. */
export function runtimeConfig<K extends ConfigKey>(key: K): Promise<ConfigValue<K>>;
export function runtimeConfig(key: string): Promise<unknown>;
export async function runtimeConfig(key: string): Promise<unknown> {
  const definition = CONFIG_BY_KEY.get(key);
  if (!definition || definition.kind === 'secret') throw new Error('Unknown non-secret configuration key.');
  const row = await prisma.appSetting.findUnique({ where: { key }, select: { value: true, encrypted: true } });
  if (!row) return definition.defaultValue;
  if (row.encrypted) throw new Error('A non-secret setting was stored as encrypted.');
  const checked = definition.schema.safeParse(row.value);
  if (!checked.success) throw new Error(`Stored configuration is invalid: ${key}.`);
  return checked.data;
}

/** One validated database snapshot for a module's non-secret settings. Secret reads stay explicit. */
export async function runtimeConfigBatch(keys: readonly string[]): Promise<Record<string, unknown>> {
  const unique = [...new Set(keys)];
  const definitions = unique.map(key => {
    const definition = CONFIG_BY_KEY.get(key);
    if (!definition || definition.kind === 'secret') throw new Error('Unknown non-secret configuration key.');
    return definition;
  });
  if (!unique.length) return {};
  const rows = await prisma.appSetting.findMany({ where: { key: { in: unique } }, select: { key: true, value: true, encrypted: true } });
  const stored = new Map(rows.map(row => [row.key, row]));
  const values: Record<string, unknown> = {};
  for (const definition of definitions) {
    const row = stored.get(definition.key);
    if (row?.encrypted) throw new Error('A non-secret setting was stored as encrypted.');
    const checked = definition.schema.safeParse(row ? row.value : definition.defaultValue);
    if (!checked.success) throw new Error(`Stored configuration is invalid: ${definition.key}.`);
    values[definition.key] = checked.data;
  }
  return values;
}

export async function runtimeSecret(key: string): Promise<string | null> {
  const definition = CONFIG_BY_KEY.get(key);
  if (!definition || definition.kind !== 'secret') throw new Error('Unknown secret configuration key.');
  const row = await prisma.appSetting.findUnique({ where: { key }, select: { value: true, encrypted: true } });
  if (!row) return null;
  if (!row.encrypted || typeof row.value !== 'string') throw new Error(`Stored secret is invalid: ${key}.`);
  return decrypt(row.value);
}

export async function readConfig() {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: CONFIG_REGISTRY.map((item) => item.key) } }, select: { key: true, value: true, encrypted: true } });
  const stored = new Map(rows.map((row) => [row.key, row]));
  return CONFIG_REGISTRY.map((item) => {
    const row = stored.get(item.key);
    if (item.kind === 'secret') return { key: item.key, value: '', isSet: Boolean(row), source: row ? 'database' as const : 'default' as const };
    if (!row) return { key: item.key, value: item.defaultValue, isSet: false, source: 'default' as const };
    const raw = row.value as unknown;
    const parsed = item.schema.safeParse(raw);
    return { key: item.key, value: parsed.success ? parsed.data : item.defaultValue, isSet: parsed.success, source: parsed.success ? 'database' as const : 'default' as const };
  });
}

export { saveRootConfig as saveConfig, configAuditDetail } from '@/modules/root/server/configuration';
