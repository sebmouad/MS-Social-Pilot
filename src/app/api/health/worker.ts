import { prisma } from '@/lib/prisma';

/**
 * A heartbeat older than this means the worker has stopped.
 *
 * The same two minutes the Setup screen uses (`src/lib/setup.ts`): the worker
 * writes its row every thirty seconds, so this is four missed beats — enough
 * that a restart or a slow publish does not page anybody.
 */
export const WORKER_STALE_MS = 2 * 60 * 1000;

export interface WorkerStatus {
  /** `missing` means no worker has ever reported against this database. */
  status: 'ok' | 'stale' | 'missing';
  /** Seconds since the newest heartbeat, or null when there is none. */
  lastBeatSeconds: number | null;
}

/**
 * The newest heartbeat across every worker, not any one of them: several
 * workers is a supported deployment, and one that has stopped must not make a
 * running fleet look dead.
 *
 * Reports an age and nothing else. The row also holds the worker's hostname
 * and job list, which are nobody's business on an unauthenticated route.
 */
export async function readWorkerStatus(now: number = Date.now()): Promise<WorkerStatus> {
  const newest = await prisma.workerHeartbeat.findFirst({
    orderBy: { seenAt: 'desc' },
    select: { seenAt: true },
  });

  if (!newest) return { status: 'missing', lastBeatSeconds: null };

  // Clamped: a clock that runs slightly behind the worker's must not report a
  // heartbeat from the future.
  const age = Math.max(0, now - newest.seenAt.getTime());
  return {
    status: age < WORKER_STALE_MS ? 'ok' : 'stale',
    lastBeatSeconds: Math.round(age / 1000),
  };
}
