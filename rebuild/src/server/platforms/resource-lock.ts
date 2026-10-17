import type { Prisma } from '../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';

export type SelectedResource = { kind: 'target' | 'adAccount'; id: string };

/** Shared lock protocol for collectors and selection/disconnection mutations. */
export async function lockSelectedResources(tx: Prisma.TransactionClient, workspaceId: string, resources: readonly SelectedResource[]) {
  if (!workspaceId || resources.some(resource => !resource || !['target', 'adAccount'].includes(resource.kind) || typeof resource.id !== 'string' || !resource.id)) {
    throw new OperationError('invalid_request', 'Choose valid connected resources.');
  }
  const keys = [...new Set(resources.map(resource => JSON.stringify(['selected-resource', workspaceId, resource.kind, resource.id])))].sort();
  for (const key of keys) {
    const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired`;
    if (rows[0]?.acquired !== true) throw new OperationError('conflict', 'Another connection operation is running. Try again after it finishes.');
  }
}

/** Caller owns the outer workspace guard. Every local write must use the supplied transaction. */
export async function withSelectedResourceOperation<T>(workspaceId: string, resource: SelectedResource, run: (tx: Prisma.TransactionClient, signal: AbortSignal) => Promise<T>): Promise<T> {
  const [timeout, maxWait, grace, workspaceTimeout] = await Promise.all([
    runtimeConfig('sync.resourceOperationTimeoutMs'), runtimeConfig('sync.resourceOperationMaxWaitMs'),
    runtimeConfig('sync.resourceFinalizationGraceMs'), runtimeConfig('data.workspaceOperationTimeoutMs'),
  ]);
  if (![timeout, maxWait, grace, workspaceTimeout].every(value => Number.isSafeInteger(value) && value > 0) || timeout + maxWait + grace >= workspaceTimeout) {
    throw new OperationError('unavailable', 'Automatic synchronization is temporarily unavailable.');
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await prisma.$transaction(async tx => {
      await lockSelectedResources(tx, workspaceId, [resource]);
      timer = setTimeout(() => controller.abort(), timeout);
      const result = await run(tx, controller.signal);
      controller.signal.throwIfAborted();
      return result;
    }, { timeout: timeout + grace, maxWait });
  } finally {
    controller.abort();
    if (timer !== undefined) clearTimeout(timer);
  }
}
