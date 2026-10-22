import { loadRootModuleHealth } from './module-health';
import { moduleManifests } from '@/modules';
import { ROOT_JOBS } from '@/modules/root/jobs';
import { Prisma } from '../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { REBUILD_WORKER_PREFIX } from '@/server/jobs/identity';

export async function requireActiveRoot(actorId: string, db = prisma) {
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { isInstanceOwner: true, disabledAt: true } });
  if (!actor?.isInstanceOwner || actor.disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
}
export const operationJobs = [...moduleManifests.flatMap(module => module.jobs.map(job => ({ ...job, moduleId: module.id }))), ...ROOT_JOBS.map(job => ({ ...job, moduleId: 'root' }))];

/** Rebuild-only, value-free telemetry. Never returns raw stored provider errors or summaries. */
export async function loadRootOperations(actorId: string, moduleId?: string, resultCap?: number) {
  await requireActiveRoot(actorId);
  if (moduleId !== undefined && !moduleManifests.some(module => module.id === moduleId)) throw new OperationError('invalid_request', 'Choose an installed product module.');
  if (resultCap !== undefined && (!Number.isSafeInteger(resultCap) || resultCap < 1)) throw new OperationError('invalid_request', 'Choose a valid result limit.');
  const [limit, staleSeconds, enabled, timeZone] = await Promise.all([runtimeConfig('root.operationsRecentLimit'), runtimeConfig('root.workerStaleSeconds'), runtimeConfig('jobs.enabled'), runtimeConfig('root.operationalTimezone')]);
  const jobs = operationJobs.filter(job => moduleId === undefined || job.moduleId === moduleId);
  const moduleHealth = await loadRootModuleHealth(actorId, moduleId === undefined ? undefined : `product:${moduleId}`);
  if (!jobs.length) return { moduleHealth, enabled, timeZone, jobs, worker: { state: 'not_applicable' as const, seenAt: null as string | null }, runs: [] };
  const names = jobs.map(job => job.name);
  const [runs, heartbeats] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; job: string; startedAt: Date; finishedAt: Date | null; outcome: string; attempts: number; hasError: boolean }>>(Prisma.sql`
      SELECT id, job, "startedAt", "finishedAt", outcome, attempts, (error IS NOT NULL) AS "hasError"
      FROM rebuild_sync_runs WHERE job IN (${Prisma.join(names)}) ORDER BY "startedAt" DESC, id DESC LIMIT ${Math.min(limit, resultCap ?? limit)}`),
    prisma.$queryRaw<Array<{ seenAt: Date }>>`SELECT "seenAt" FROM worker_heartbeats WHERE LEFT("workerId", ${REBUILD_WORKER_PREFIX.length}::int) = ${REBUILD_WORKER_PREFIX} ORDER BY "seenAt" DESC LIMIT 1`,
  ]);
  const seenAt = heartbeats[0]?.seenAt ?? null;
  return { moduleHealth, enabled, timeZone, jobs, worker: { state: seenAt ? Date.now() - seenAt.getTime() > staleSeconds * 1000 ? 'stale' as const : 'fresh' as const : 'never' as const, seenAt: seenAt?.toISOString() ?? null },
    runs: runs.map(run => ({ id: run.id, job: run.job, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null,
      outcome: run.outcome === 'ok' || run.outcome === 'failed' ? run.outcome : 'unknown', attempts: run.attempts,
      durationMs: run.finishedAt ? Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime()) : null, hasError: run.hasError })),
  };
}
