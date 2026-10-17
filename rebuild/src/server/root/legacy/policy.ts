import { CONFIG_BY_KEY } from '@/lib/config/registry';
import { ROOT_LEGACY_CONFIG } from './config';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import type { Prisma } from '../../../../generated/client';

type Key = typeof ROOT_LEGACY_CONFIG[number]['key'];
const DEFINITIONS = new Map<string, typeof ROOT_LEGACY_CONFIG[number]>(ROOT_LEGACY_CONFIG.map(item => [item.key, item]));
const unavailable = () => new OperationError('unavailable', 'Root operational limits are unavailable. Try again after the Root settings are registered.');

/** Never run a bounded Root operation using source defaults when host registration is missing. */
export async function legacySetting(key: Key): Promise<number> {
  const definition = DEFINITIONS.get(key);
  if (!definition || !CONFIG_BY_KEY.has(key)) throw unavailable();
  try {
    const parsed = definition.schema.safeParse(await runtimeConfig(key));
    if (!parsed.success || typeof parsed.data !== 'number' || !Number.isSafeInteger(parsed.data)) throw unavailable();
    return parsed.data;
  } catch { throw unavailable(); }
}

const TX_BOUNDS = ['root.accountOperationTimeoutMs', 'root.accountOperationLockWaitMs'] as const;
async function txBound(key: typeof TX_BOUNDS[number]): Promise<number> {
  const definition = CONFIG_BY_KEY.get(key);
  if (!definition) throw unavailable();
  try {
    const parsed = definition.schema.safeParse(await runtimeConfig(key));
    if (!parsed.success || typeof parsed.data !== 'number' || !Number.isSafeInteger(parsed.data)) throw unavailable();
    return parsed.data;
  } catch { throw unavailable(); }
}

/** Run a Root mutation under the Root-managed transaction timeout and lock wait (fail closed when unavailable). */
export async function rootTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const [timeout, maxWait] = await Promise.all([txBound(TX_BOUNDS[0]), txBound(TX_BOUNDS[1])]);
  return prisma.$transaction(fn, { timeout, maxWait });
}

/** Preserve consistent pagination when an MCP caller has a smaller result ceiling. */
export function rootResultLimit(configured: number, requested?: number) {
  if (requested === undefined) return configured;
  if (!Number.isSafeInteger(requested) || requested < 1) throw new OperationError('invalid_request', 'Choose a valid result limit.');
  return Math.min(configured, requested);
}
