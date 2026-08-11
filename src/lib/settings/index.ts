import { prisma } from '../prisma';
import { decryptSecret, encryptSecret } from '../crypto';
import {
  SETTINGS_BY_KEY,
  SETTING_DEFINITIONS,
  type SettingDefinition,
} from './definitions';

/**
 * Reading and writing runtime configuration.
 *
 * Precedence is **database, then environment, then the registry default**. The
 * environment keeps working as it always did — an existing `.env` is still
 * honoured — but anything set through the config screen wins over it, so an
 * operator never has to edit a file on the server to change a job interval.
 *
 * Values are cached in the process for a short window. Two processes run this
 * app (the web server and the worker), and a change made in one reaches the
 * other on its next refresh rather than instantly; the TTL is what bounds that
 * lag. A write invalidates the cache in its own process immediately.
 */

export type SettingValue = string | number | boolean | string[];

/** How long a loaded snapshot is trusted before it is re-read. */
const CACHE_TTL_MS = 30_000;

let cache: Map<string, SettingValue> | null = null;
let loadedAt = 0;
let inFlight: Promise<Map<string, SettingValue>> | null = null;

function parseBoolean(raw: string): boolean {
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function parseList(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Clamp a number into the definition's declared bounds. */
function clamp(definition: SettingDefinition, value: number): number {
  const low = definition.min ?? Number.NEGATIVE_INFINITY;
  const high = definition.max ?? Number.POSITIVE_INFINITY;
  return Math.min(high, Math.max(low, value));
}

/**
 * Coerce whatever was stored or configured into the declared type.
 *
 * Everything arrives as a string from the environment and as loose JSON from
 * the database, and a setting that is meant to be a number must never reach a
 * caller as the string "30" — `"30" * 1000` is a bug that only shows up in
 * production timing.
 */
export function coerce(definition: SettingDefinition, raw: unknown): SettingValue | null {
  if (raw === null || raw === undefined) return null;

  switch (definition.type) {
    case 'number': {
      const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
      return Number.isFinite(parsed) ? clamp(definition, parsed) : null;
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : parseBoolean(String(raw));
    case 'list':
      if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
      return parseList(String(raw));
    default: {
      const text = String(raw);
      return text;
    }
  }
}

/** The value the environment supplies for a setting, if any. */
function fromEnv(definition: SettingDefinition): SettingValue | null {
  if (!definition.env) return null;
  const raw = process.env[definition.env];
  if (raw === undefined || raw === '') return null;
  return coerce(definition, raw);
}

async function load(): Promise<Map<string, SettingValue>> {
  const rows = await prisma.appSetting.findMany();
  const next = new Map<string, SettingValue>();

  for (const row of rows) {
    const definition = SETTINGS_BY_KEY.get(row.key);
    // A row for a key the code no longer knows about is kept in the table but
    // ignored, so rolling back a deploy does not lose the operator's value.
    if (!definition) continue;

    let raw: unknown = row.value;
    if (row.encrypted && typeof raw === 'string') {
      try {
        raw = decryptSecret(raw);
      } catch {
        // A key rotation makes old ciphertext unreadable. Fall through to the
        // environment rather than crashing every request.
        continue;
      }
    }

    const value = coerce(definition, raw);
    if (value !== null) next.set(row.key, value);
  }

  cache = next;
  loadedAt = Date.now();
  return next;
}

/**
 * Make sure a fresh-enough snapshot is in memory.
 *
 * Call this once at the top of anything that reads settings. Concurrent callers
 * share a single query rather than each issuing their own.
 */
export async function ensureSettings(): Promise<void> {
  if (cache && Date.now() - loadedAt < CACHE_TTL_MS) return;
  if (!inFlight) {
    inFlight = load().finally(() => {
      inFlight = null;
    });
  }
  await inFlight;
}

/** Drop the snapshot so the next read goes to the database. */
export function invalidateSettings(): void {
  cache = null;
  loadedAt = 0;
}

/**
 * Read a setting.
 *
 * Synchronous on purpose: it is called from deep inside request handling, and
 * an await on every read would spread through the whole codebase for no gain.
 * `ensureSettings()` at the entry point is what makes it correct — before the
 * first load this falls back to the environment, which is the same answer the
 * app gave before settings existed.
 */
export function setting<T extends SettingValue = SettingValue>(key: string): T {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition) throw new Error(`Unknown setting "${key}".`);

  const stored = cache?.get(key);
  if (stored !== undefined) return stored as T;

  return (fromEnv(definition) ?? definition.default) as T;
}

export function settingNumber(key: string): number {
  return setting<number>(key);
}

export function settingBoolean(key: string): boolean {
  return setting<boolean>(key);
}

export function settingString(key: string): string {
  return setting<string>(key);
}

export function settingList(key: string): string[] {
  return setting<string[]>(key);
}

export type SettingSource = 'database' | 'environment' | 'default';

export interface SettingView {
  key: string;
  group: string;
  type: string;
  label: string;
  description: string;
  hint?: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  workerRestart: boolean;
  source: SettingSource;
  /** Absent for secrets — only whether one is set is reported. */
  value?: SettingValue;
  hasValue: boolean;
  isSecret: boolean;
  defaultValue?: SettingValue;
  envVar?: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

/**
 * Every setting, with where its current value came from.
 *
 * The source matters operationally: "this is the default" and "someone set this
 * to the same value as the default" behave identically today and differently
 * the next time the default changes.
 */
export async function describeSettings(): Promise<SettingView[]> {
  const rows = await prisma.appSetting.findMany({
    include: { updatedBy: { select: { name: true } } },
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));

  await ensureSettings();

  return SETTING_DEFINITIONS.map((definition) => {
    const row = byKey.get(definition.key);
    const envValue = fromEnv(definition);

    const source: SettingSource = row ? 'database' : envValue !== null ? 'environment' : 'default';
    const value = setting(definition.key);
    const isSecret = definition.type === 'secret';

    return {
      key: definition.key,
      group: definition.group,
      type: definition.type,
      label: definition.label,
      description: definition.description,
      hint: definition.hint,
      options: definition.options,
      min: definition.min,
      max: definition.max,
      workerRestart: Boolean(definition.workerRestart),
      source,
      // A secret is never sent back to the browser, not even to the person who
      // set it: the config screen only needs to know whether one exists.
      ...(isSecret ? {} : { value, defaultValue: definition.default }),
      hasValue: isSecret ? String(value).length > 0 : true,
      isSecret,
      envVar: definition.env,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy?.name ?? null,
    };
  });
}

export class SettingError extends Error {}

/** Validate a submitted value against its definition. */
export function validate(definition: SettingDefinition, raw: unknown): SettingValue {
  if (definition.type === 'number') {
    const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
    if (!Number.isFinite(parsed)) {
      throw new SettingError(`${definition.label} must be a number.`);
    }
    if (definition.min !== undefined && parsed < definition.min) {
      throw new SettingError(`${definition.label} must be at least ${definition.min}.`);
    }
    if (definition.max !== undefined && parsed > definition.max) {
      throw new SettingError(`${definition.label} must be at most ${definition.max}.`);
    }
    return parsed;
  }

  if (definition.type === 'boolean') {
    return typeof raw === 'boolean' ? raw : parseBoolean(String(raw));
  }

  if (definition.type === 'list') {
    const list = Array.isArray(raw) ? raw.map(String) : parseList(String(raw));
    return list.map((entry) => entry.trim()).filter(Boolean);
  }

  if (definition.type === 'select') {
    const text = String(raw);
    if (definition.options && !definition.options.some((option) => option.value === text)) {
      throw new SettingError(`${definition.label} must be one of the listed options.`);
    }
    return text;
  }

  return String(raw);
}

/**
 * Store a value, replacing whatever was there.
 *
 * Secrets are encrypted with the same key that protects access tokens, so the
 * settings table is no more dangerous in a database dump than the accounts
 * table already was.
 */
export async function writeSetting(
  key: string,
  raw: unknown,
  userId: string | null,
): Promise<void> {
  const definition = SETTINGS_BY_KEY.get(key);
  if (!definition) throw new SettingError(`Unknown setting "${key}".`);

  const value = validate(definition, raw);
  const isSecret = definition.type === 'secret';

  // Clearing a secret removes the row rather than storing an empty string, so
  // the environment can take over again.
  if (isSecret && String(value).length === 0) {
    await clearSetting(key);
    return;
  }

  const stored = isSecret ? encryptSecret(String(value)) : value;

  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: stored as never, encrypted: isSecret, updatedById: userId },
    update: { value: stored as never, encrypted: isSecret, updatedById: userId },
  });

  invalidateSettings();
}

/** Remove the override, letting the environment or the default take over. */
export async function clearSetting(key: string): Promise<void> {
  if (!SETTINGS_BY_KEY.has(key)) throw new SettingError(`Unknown setting "${key}".`);
  await prisma.appSetting.deleteMany({ where: { key } });
  invalidateSettings();
}

export { SETTING_DEFINITIONS, SETTINGS_BY_KEY } from './definitions';
export { GROUP_LABELS, GROUP_ORDER } from './definitions';
export type { SettingDefinition, SettingGroup, SettingType } from './definitions';
