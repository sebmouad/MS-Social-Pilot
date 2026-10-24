import { prisma } from '@/server/data';
import { runtimeConfigBatch } from '@/server/config/store';
import { WORKER_PREFIX } from '@/server/jobs/identity';
import { CONFIG_BY_KEY } from '@/lib/config/registry';

export type WorkerState = 'ok' | 'stale' | 'never' | 'unknown';
export type SystemHealth = { database: boolean; worker: { status: WorkerState; lastBeatSeconds: number | null } };

async function bounds() {
  const defaults = { timeoutMs: Number(CONFIG_BY_KEY.get('health.databaseTimeoutMs')?.defaultValue ?? 3000), staleSeconds: Number(CONFIG_BY_KEY.get('root.workerStaleSeconds')?.defaultValue ?? 300) };
  try {
    const values = await runtimeConfigBatch(['health.databaseTimeoutMs', 'root.workerStaleSeconds']);
    return { timeoutMs: values['health.databaseTimeoutMs'] as number, staleSeconds: values['root.workerStaleSeconds'] as number };
  } catch { return defaults; }
}

/**
 * Cheap, unauthenticated readiness facts for `/api/health` and the public Status page. The database round trip decides
 * the verdict; the worker is information only (restarting the web process cannot fix a stopped worker, and the worker
 * waits for the web process on first boot). Nothing here returns versions, settings or error text.
 */
export async function readSystemHealth(now = Date.now()): Promise<SystemHealth> {
  const { timeoutMs, staleSeconds } = await bounds();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const database = await Promise.race([
    prisma.$queryRaw`SELECT 1`.then(() => true, () => false),
    new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
  ]);
  clearTimeout(timer);
  if (!database) return { database, worker: { status: 'unknown', lastBeatSeconds: null } };
  try {
    const rows = await prisma.$queryRaw<Array<{ seenAt: Date }>>`SELECT "seenAt" FROM worker_heartbeats WHERE LEFT("workerId", ${WORKER_PREFIX.length}::int) = ${WORKER_PREFIX} ORDER BY "seenAt" DESC LIMIT 1`;
    const seen = rows[0]?.seenAt;
    if (!seen) return { database, worker: { status: 'never', lastBeatSeconds: null } };
    const seconds = Math.max(0, Math.round((now - seen.getTime()) / 1000));
    return { database, worker: { status: seconds > staleSeconds ? 'stale' : 'ok', lastBeatSeconds: seconds } };
  } catch {
    // A missing table is a migration not yet applied; it says nothing about this process.
    return { database, worker: { status: 'unknown', lastBeatSeconds: null } };
  }
}
