import { randomUUID } from 'node:crypto';
import { moduleManifests } from '@/modules';
import { PLATFORM_MODULES } from '@/platforms';
import { configurationOwner } from '@/lib/config/ownership';
import { CONFIG_REGISTRY } from '@/lib/config/registry';
import { prisma } from '@/server/data';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { cronMatches } from '@/server/jobs/cron';
import { REBUILD_WORKER_PREFIX } from '@/server/jobs/identity';
import { requireActiveRoot } from './operations';
import type { HealthStatus, ModuleHealthDeclaration } from './module-health-types';
import { OperationError } from '@/lib/operation-error';

type Job = { name: string; configKey: string };
type Scope = { id: string; title: string; kind: 'shared' | 'product' | 'platform'; health: ModuleHealthDeclaration; jobs: readonly Job[]; required: readonly string[]; enabledKey: string };
export const moduleHealthScopes: readonly Scope[] = [
  { id: 'shared', title: 'Shared controls', kind: 'shared', health: { configuration: true, jobHistory: true, pendingQueues: [] }, jobs: [], required: [], enabledKey: 'jobs.enabled' },
  ...moduleManifests.map(m => ({ id: `product:${m.id}`, title: m.title, kind: 'product' as const, health: m.health, jobs: m.jobs, required: [], enabledKey: `entitlements.modules.${m.id}` })),
  ...PLATFORM_MODULES.map(m => ({ id: `platform:${m.id}`, title: m.name, kind: 'platform' as const, health: m.health, jobs: [], required: m.requiredSettings, enabledKey: m.enabledKey })),
];
export type StoredHealthRun = { id: string; startedAt: Date; finishedAt: Date | null; outcome: string };
/** Schedule-aware freshness, using worker timezone and existing stale grace.
 * A bounded one-day search cannot establish freshness for older sparse schedules. */
export function jobHealth(run: StoredHealthRun | null, schedule: unknown, now: Date, graceSeconds: number) {
  let freshness: HealthStatus = 'unknown';
  if (run && typeof schedule === 'string' && run.startedAt <= now) {
    const end = Math.floor((now.getTime() - graceSeconds * 1000) / 60_000) * 60_000;
    const start = Math.max(Math.floor(run.startedAt.getTime() / 60_000) * 60_000 + 60_000, end - 86400000);
    try {
      cronMatches(schedule, now);
      freshness = run.startedAt.getTime() < end - 86400000 ? 'unknown' : 'pass';
      for (let at = end; at >= start; at -= 60_000) if (cronMatches(schedule, new Date(at))) { freshness = 'fail'; break; }
    } catch { freshness = 'unknown'; }
  }
  return { freshness, outcome: run?.finishedAt && run.finishedAt >= run.startedAt && run.finishedAt <= now ? run.outcome === 'ok' ? 'pass' as const : run.outcome === 'failed' ? 'fail' as const : 'unknown' as const : 'unknown' as const,
    runId: run?.id ?? null, startedAt: run?.startedAt.toISOString() ?? null, finishedAt: run?.finishedAt?.toISOString() ?? null,
    durationMs: run?.finishedAt && run.finishedAt >= run.startedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null };
}

/** Installation-wide evidence only; never accepts workspace or provider credentials. */
export async function loadRootModuleHealth(actorId: string, scopeId?: string) {
  await requireActiveRoot(actorId);
  if (scopeId !== undefined && !moduleHealthScopes.some(s => s.id === scopeId)) throw new OperationError('invalid_request', 'Choose an installed module.');
  const started = performance.now();
  const now = new Date();
  const grace = await runtimeConfig('root.workerStaleSeconds');
  const enabled = await runtimeConfig('jobs.enabled');
  const stored = new Map((await prisma.appSetting.findMany({ select: { key: true, value: true, encrypted: true } })).map(row => [row.key, row]));
  const modules = await Promise.all(moduleHealthScopes.filter(s => scopeId === undefined || s.id === scopeId).map(async scope => {
    const from = performance.now();
    const available = await runtimeConfig(scope.enabledKey).then(value => typeof value === 'boolean' ? value : null).catch(() => null);
    const definitions = CONFIG_REGISTRY.filter(d => { const owner = configurationOwner(d.key); return owner.kind === scope.kind && (owner.kind === 'shared' || owner.id === scope.id.split(':')[1]); });
    const configuration: { key: string; status: HealthStatus }[] = scope.health.configuration ? await Promise.all(definitions.map(async d => {
      try {
        const row = stored.get(d.key);
        if (row && (row.encrypted !== (d.kind === 'secret') || d.kind !== 'secret' && !d.schema.safeParse(row.value).success)) return { key: d.key, status: 'fail' as const };
        const value = d.kind === 'secret' ? await runtimeSecret(d.key) : row?.value ?? d.defaultValue;
        const missing = scope.required.includes(d.key) && (value == null || value === '' || Array.isArray(value) && !value.length);
        return { key: d.key, status: missing ? 'fail' as const : 'pass' as const };
      } catch { return { key: d.key, status: 'unknown' as const }; }
    })) : [];
    const jobs = scope.health.jobHistory ? await Promise.all(scope.jobs.map(async job => {
      try {
        const run = await prisma.rebuildSyncRun.findFirst({ where: { job: job.name, owner: { startsWith: REBUILD_WORKER_PREFIX } }, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], select: { id: true, startedAt: true, finishedAt: true, outcome: true } });
        return { name: job.name, ...jobHealth(run, enabled ? await runtimeConfig(job.configKey) : null, now, grace) };
      } catch { return { name: job.name, ...jobHealth(null, null, now, grace) }; }
    })) : [];
    const queues = await Promise.all(scope.health.pendingQueues.map(async name => {
      try {
        const count = name === 'scheduledPosts' ? await prisma.post.count({ where: { status: 'scheduled', scheduledAt: { lte: now }, targets: { some: { status: 'pending' } } } })
          : name === 'publicationAttempts' ? await prisma.publicationAttempt.count({ where: { ...(scope.kind === 'platform' ? { provider: scope.id.slice('platform:'.length) } : {}), state: { in: ['started', 'uncertain', 'submitted', 'receipt_recorded'] } } })
          : await prisma.rebuildWorkspaceExport.count({ where: { status: { in: ['requested', 'running'] }, expiresAt: { gt: now } } });
        // A count alone does not prove failure without an age/SLA policy.
        return { name, count, status: count === 0 ? 'pass' as HealthStatus : 'unknown' as HealthStatus };
      } catch { return { name, count: null, status: 'unknown' as HealthStatus }; }
    }));
    const worker = scope.kind === 'shared' ? await prisma.$queryRaw<Array<{ seenAt: Date }>>`SELECT "seenAt" FROM worker_heartbeats WHERE LEFT("workerId", ${REBUILD_WORKER_PREFIX.length}::int) = ${REBUILD_WORKER_PREFIX} ORDER BY "seenAt" DESC LIMIT 1`.then(rows => ({ seenAt: rows[0]?.seenAt.toISOString() ?? null, status: !rows[0] || rows[0].seenAt > now ? 'unknown' as HealthStatus : now.getTime() - rows[0].seenAt.getTime() > grace * 1000 ? 'fail' as HealthStatus : 'pass' as HealthStatus })).catch(() => ({ seenAt: null, status: 'unknown' as HealthStatus })) : null;
    const statuses = [...(worker ? [worker.status] : []), ...configuration.map(c => c.status), ...jobs.flatMap(j => [j.freshness, j.outcome]), ...queues.map(q => q.status)];
    const status: HealthStatus = statuses.includes('fail') ? 'fail' : !statuses.length || statuses.includes('unknown') || !jobs.length || !queues.length ? 'unknown' : 'pass';
    return { id: scope.id, kind: scope.kind, title: scope.title, status, available, configuration, jobs, queues, worker, durationMs: Math.round(performance.now() - from) };
  }));
  await requireActiveRoot(actorId);
  const id = `health_${randomUUID()}`;
  await prisma.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${id}, ${actorId}, 'modules.health.inspected', ${JSON.stringify({ scopes: modules.map(m => ({ id: m.id, status: m.status })), checkedAt: now.toISOString() })}::jsonb, NOW())`;
  return { id, checkedAt: now.toISOString(), durationMs: Math.round(performance.now() - started), auditRecorded: true, jobsEnabled: enabled, modules };
}
