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
 * Values are cached per process, and the cache is validated against a **version
 * stamp** rather than simply expiring. Several processes run this app — the web
 * server, the worker, and more than one of each behind a load balancer — and a
 * blind TTL meant they could disagree about configuration for its whole length,
 * including feature switches that decide which OAuth scopes a login asks for.
 *
 * The stamp is `max(updatedAt)` and the row count together: an update moves the
 * maximum, an insert moves both, and a delete moves the count (or the maximum,
 * if it removed the newest row). Reading it is one aggregate over a table with a
 * few dozen rows, so it is checked at most once a second and the full reload
 * happens only when it has actually changed. Worst-case staleness is that
 * second, and steady-state cost is one trivial query per second per process
 * whatever the traffic.
 */

export type SettingValue = string | number | boolean | string[];

/** How often the version stamp is checked. Not how long values are trusted. */
const STAMP_CHECK_MS = 1_000;

/** What identifies a version of the settings table. */
interface Stamp {
  count: number;
  updatedAt: number;
}

let cache: Map<string, SettingValue> | null = null;
let stamp: Stamp | null = null;
let checkedAt = 0;
let inFlight: Promise<void> | null = null;

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

async function readStamp(): Promise<Stamp> {
  const result = await prisma.appSetting.aggregate({
    _count: { key: true },
    _max: { updatedAt: true },
  });

  return {
    count: result._count.key,
    updatedAt: result._max.updatedAt?.getTime() ?? 0,
  };
}

function sameStamp(left: Stamp | null, right: Stamp): boolean {
  return left !== null && left.count === right.count && left.updatedAt === right.updatedAt;
}

async function load(next: Stamp): Promise<void> {
  const rows = await prisma.appSetting.findMany();
  const loaded = new Map<string, SettingValue>();

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
    if (value !== null) loaded.set(row.key, value);
  }

  cache = loaded;
  stamp = next;
}

/**
 * Make sure the in-memory snapshot matches the database.
 *
 * Call this once at the top of anything that reads settings. Concurrent callers
 * share a single check rather than each issuing their own.
 */
export async function ensureSettings(): Promise<void> {
  if (cache && Date.now() - checkedAt < STAMP_CHECK_MS) return;

  if (!inFlight) {
    inFlight = (async () => {
      const next = await readStamp();
      // The common case: nothing has changed anywhere, so the snapshot stands
      // and the only cost was the aggregate.
      if (cache && sameStamp(stamp, next)) return;
      await load(next);
    })()
      .then(() => {
        checkedAt = Date.now();
      })
      .finally(() => {
        inFlight = null;
      });
  }

  await inFlight;
}

/** Drop the snapshot so the next read goes to the database. */
export function invalidateSettings(): void {
  cache = null;
  stamp = null;
  checkedAt = 0;
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

  const text = String(raw);
  if (definition.pattern && text !== '' && !definition.pattern.regex.test(text)) {
    throw new SettingError(definition.pattern.message);
  }
  return text;
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
