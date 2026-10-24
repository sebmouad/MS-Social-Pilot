import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../generated/client';

const databaseUrl = process.env.REBUILD_PREVIEW_DATABASE_URL;
const state = vi.hoisted(() => ({ client: undefined as unknown as Record<string, unknown> }));
vi.mock('../src/server/data', () => ({
  prisma: new Proxy({}, {
    get: (_target, property) => {
      const value = state.client?.[property as string];
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(state.client) : value;
    },
  }),
}));

import { clearExpiredOutputs, finishRun, type RunRef } from '../src/modules/analytics/reports/generation/run-store';
import { runDueReportSchedules } from '../src/modules/analytics/reports/generation/runs';
import { resetReportCapabilityCache, unregisterReportGeneration } from '../src/modules/analytics/reports/generation/registry';
import type { ReportLimits } from '../src/modules/analytics/reports/server/limits';

const reportConfigDefaults: ReportLimits = {
  pageSize: 25, maxTemplates: 50, nameMax: 60, maxSchedules: 50, maxRecipients: 10,
  dueBatch: 50, timeout: 10_000, maxWait: 5_000, sendTime: '08:00', maxRows: 5_000,
  maxBytes: 1_000_000, maxStoredBytes: 2_200_000, leaseSeconds: 600, historyPageSize: 25,
  staleBatch: 1, finishRetries: 2, retentionHours: 24,
};

function isolated(url: string, connectionLimit?: number) {
  const parsed = new URL(url);
  if (process.env.NODE_ENV === 'production' || !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || !decodeURIComponent(parsed.pathname).endsWith('_preview')
    || ['host', 'hostaddr', 'socket'].some(key => parsed.searchParams.has(key))) throw new Error('Only isolated loopback preview database permitted.');
  if (connectionLimit) parsed.searchParams.set('connection_limit', String(connectionLimit));
  return new PrismaClient({ datasources: { db: { url: parsed.toString() } } });
}

describe.skipIf(!databaseUrl)('Analytics Reports durable run writes on isolated PostgreSQL', () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const workspaceId = `preview_reports82_${suffix}`;
  const targetId = `${workspaceId}_target`;
  const purgeWorkspaceId = `${workspaceId}_purge`;
  const purgeTargetId = `${purgeWorkspaceId}_target`;
  const scheduleId = `${workspaceId}_schedule`;
  const rowId = (name: string) => `${workspaceId}_${name}`;
  const actor = { userId: null, workspaceId };
  const now = new Date('2026-10-18T12:00:00.000Z');
  let db: PrismaClient;
  let contender: PrismaClient;

  async function insertRun(name: string, options: { status?: string; token?: string; leaseUntil?: Date; scheduleId?: string | null } = {}) {
    const id = rowId(name);
    const token = options.token ?? `claim_${name}`;
    const status = options.status ?? 'generating';
    const finishedAt = ['claimed', 'generating', 'delivering'].includes(status) ? null : now;
    await db.$executeRaw`INSERT INTO report_runs (id, "workspaceId", "scheduleId", "targetId", kind, "idempotencyKey", "claimToken", "requestHash", "periodStart", "periodEnd", status, "leaseUntil", "finishedAt") VALUES (${id}, ${workspaceId}, ${options.scheduleId ?? null}, ${targetId}, 'manual', ${`idem_${id}`}, ${token}, ${'a'.repeat(64)}, '2026-10-01', '2026-10-07', ${status}, ${options.leaseUntil ?? new Date(now.getTime() + 60_000)}, ${finishedAt})`;
    return { id, token };
  }

  async function cleanup() {
    await db.$executeRaw`DELETE FROM workspace_data_purges WHERE "workspaceId" = ANY(${[workspaceId, purgeWorkspaceId]}::text[])`;
    await db.$executeRaw`DELETE FROM report_runs WHERE "workspaceId" = ANY(${[workspaceId, purgeWorkspaceId]}::text[])`;
    await db.$executeRaw`DELETE FROM report_schedules WHERE "workspaceId" = ANY(${[workspaceId, purgeWorkspaceId]}::text[])`;
    await db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId" = ANY(${[workspaceId, purgeWorkspaceId]}::text[]) AND (action LIKE 'analytics.reports82.%' OR action IN ('analytics.report_output_expired', 'analytics.report_run_interrupted'))`;
    await db.target.deleteMany({ where: { id: { in: [targetId, purgeTargetId] } } });
    await db.workspace.deleteMany({ where: { id: { in: [workspaceId, purgeWorkspaceId] } } });
  }

  beforeAll(async () => {
    db = isolated(databaseUrl!);
    contender = isolated(databaseUrl!, 1);
    await cleanup();
    await db.workspace.create({ data: { id: workspaceId, name: 'Disposable Reports 82', slug: workspaceId, timezone: 'UTC' } });
    await db.target.create({ data: { id: targetId, workspaceId, type: 'page', providerId: `${targetId}_provider`, name: 'Synthetic report channel', enabled: true, canPublish: true, createdAt: now } });
    state.client = db as unknown as Record<string, unknown>;
  });

  afterAll(async () => {
    state.client = undefined as unknown as Record<string, unknown>;
    try {
      if (db) {
        await cleanup();
        expect(await db.workspace.count({ where: { id: workspaceId } })).toBe(0);
        expect(await db.target.count({ where: { id: targetId } })).toBe(0);
        expect(await db.workspace.count({ where: { id: purgeWorkspaceId } })).toBe(0);
        expect(await db.target.count({ where: { id: purgeTargetId } })).toBe(0);
        const leftovers = await db.$queryRaw<Array<{ n: bigint }>>`SELECT (SELECT COUNT(*) FROM report_runs WHERE "workspaceId" = ${workspaceId}) + (SELECT COUNT(*) FROM report_schedules WHERE "workspaceId" = ${workspaceId}) + (SELECT COUNT(*) FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND (action LIKE 'analytics.reports82.%' OR action IN ('analytics.report_output_expired', 'analytics.report_run_interrupted'))) AS n`;
        expect(Number(leftovers[0]!.n)).toBe(0);
      }
    } finally { await Promise.all([db?.$disconnect(), contender?.$disconnect()]); }
  });

  it('fences stale, expired, and terminal claims without changing evidence or writing audit', async () => {
    const stale = await insertRun('stale');
    const expired = await insertRun('expired', { leaseUntil: new Date(now.getTime() - 1) });
    const terminal = await insertRun('terminal', { status: 'failed' });
    for (const [entry, token] of [[stale, 'another-worker'], [expired, expired.token], [terminal, terminal.token]] as const) {
      const ref: RunRef = { id: entry.id, workspaceId, token };
      await expect(finishRun(ref, { status: 'completed', rowCount: 12 }, () => now, 0, {
        audit: { actor, action: 'analytics.reports82.stale_attempt', detail: { runId: entry.id } },
      })).resolves.toBe(false);
    }
    const rows = await db.$queryRaw<Array<{ id: string; status: string; rowCount: number | null; finishedAt: Date | null }>>`SELECT id, status, "rowCount", "finishedAt" FROM report_runs WHERE id = ANY(${[stale.id, expired.id, terminal.id]}::text[]) ORDER BY id`;
    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.id === stale.id)).toMatchObject({ status: 'generating', rowCount: null, finishedAt: null });
    expect(rows.find(row => row.id === expired.id)).toMatchObject({ status: 'generating', rowCount: null, finishedAt: null });
    expect(rows.find(row => row.id === terminal.id)).toMatchObject({ status: 'failed', rowCount: null });
    const audits = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.reports82.stale_attempt'`;
    expect(Number(audits[0]!.n)).toBe(0);
  }, 30000);

  it('rolls back a terminal change if its audit insert fails, and commits a valid completion and audit once', async () => {
    const rollback = await insertRun('audit_rollback');
    const rollbackRef: RunRef = { id: rollback.id, workspaceId, token: rollback.token };
    await expect(finishRun(rollbackRef, { status: 'completed', rowCount: 4 }, () => now, 0, {
      audit: { actor, action: 'analytics.reports82.rollback', detail: { poison: '\u0000' } },
    })).resolves.toBe(false);
    const unchanged = await db.$queryRaw<Array<{ status: string; rowCount: number | null; finishedAt: Date | null }>>`SELECT status, "rowCount", "finishedAt" FROM report_runs WHERE id = ${rollback.id}`;
    expect(unchanged[0]).toMatchObject({ status: 'generating', rowCount: null, finishedAt: null });
    const failedAudit = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.reports82.rollback'`;
    expect(Number(failedAudit[0]!.n)).toBe(0);

    const valid = await insertRun('audit_valid');
    const validRef: RunRef = { id: valid.id, workspaceId, token: valid.token };
    await expect(finishRun(validRef, { status: 'completed', rowCount: 8, truncated: false }, () => now, 0, {
      audit: { actor, action: 'analytics.reports82.completed', detail: { runId: valid.id, rows: 8 } },
    })).resolves.toBe(true);
    const completed = await db.$queryRaw<Array<{ status: string; rowCount: number; finishedAt: Date | null }>>`SELECT status, "rowCount", "finishedAt" FROM report_runs WHERE id = ${valid.id}`;
    expect(completed[0]).toMatchObject({ status: 'completed', rowCount: 8, finishedAt: now });
    const committedAudit = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.reports82.completed' AND detail->>'runId' = ${valid.id}`;
    expect(Number(committedAudit[0]!.n)).toBe(1);
  }, 30000);

  it('clears expired output and expiry together while preserving report history and recording one audit', async () => {
    const id = rowId('output_expiry');
    const expiredAt = new Date(now.getTime() - 60_000);
    const output = JSON.stringify({ filename: 'synthetic-report.csv', csv: 'date,views\\n2026-10-01,5' });
    await db.$executeRaw`INSERT INTO report_runs (id, "workspaceId", "targetId", kind, "idempotencyKey", "claimToken", "requestHash", "periodStart", "periodEnd", status, "leaseUntil", "finishedAt", "rowCount", output, "outputExpiresAt") VALUES (${id}, ${workspaceId}, ${targetId}, 'manual', ${`idem_${id}`}, ${`claim_${id}`}, ${'b'.repeat(64)}, '2026-10-01', '2026-10-07', 'completed', ${now}, ${now}, 1, ${output}::jsonb, ${expiredAt})`;
    state.client = db as unknown as Record<string, unknown>;
    await expect(clearExpiredOutputs(10, now)).resolves.toBe(1);
    const rows = await db.$queryRaw<Array<{ status: string; rowCount: number; output: unknown; outputExpiresAt: Date | null }>>`SELECT status, "rowCount", output, "outputExpiresAt" FROM report_runs WHERE id = ${id}`;
    expect(rows).toEqual([{ status: 'completed', rowCount: 1, output: null, outputExpiresAt: null }]);
    const audits = await db.$queryRaw<Array<{ n: bigint; runs: number }>>`SELECT COUNT(*)::bigint AS n, MAX((detail->>'runs')::int) AS runs FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.report_output_expired'`;
    expect(Number(audits[0]!.n)).toBe(1);
    expect(audits[0]!.runs).toBe(1);
  }, 30000);

  it('skips expired artifacts in a purging workspace and still clears eligible workspace output', async () => {
    await db.workspace.create({ data: { id: purgeWorkspaceId, name: 'Disposable Reports purge scope', slug: purgeWorkspaceId, timezone: 'UTC' } });
    await db.target.create({ data: { id: purgeTargetId, workspaceId: purgeWorkspaceId, type: 'page', providerId: `${purgeTargetId}_provider`, name: 'Synthetic purge channel', enabled: true, canPublish: true, createdAt: now } });
    const expiredAt = new Date(now.getTime() - 90_000);
    const output = JSON.stringify({ filename: 'synthetic-expired.csv', csv: 'date,views' });
    const eligibleId = rowId('output_eligible');
    const purgingId = rowId('output_purging');
    const insertArtifact = (id: string, ownerWorkspaceId: string, ownerTargetId: string) => db.$executeRaw`INSERT INTO report_runs (id, "workspaceId", "targetId", kind, "idempotencyKey", "claimToken", "requestHash", "periodStart", "periodEnd", status, "leaseUntil", "finishedAt", "rowCount", output, "outputExpiresAt") VALUES (${id}, ${ownerWorkspaceId}, ${ownerTargetId}, 'manual', ${`idem_${id}`}, ${`claim_${id}`}, ${'c'.repeat(64)}, '2026-10-01', '2026-10-07', 'completed', ${now}, ${now}, 1, ${output}::jsonb, ${expiredAt})`;
    await insertArtifact(eligibleId, workspaceId, targetId);
    await insertArtifact(purgingId, purgeWorkspaceId, purgeTargetId);
    await db.$executeRaw`INSERT INTO workspace_data_purges ("workspaceId", status, "requestedById", "mediaRoot", "requestedAt", "updatedAt") VALUES (${purgeWorkspaceId}, 'requested', ${'synthetic_reports82_owner'}, ${`/tmp/${purgeWorkspaceId}`}, ${now}, ${now})`;
    const auditsBefore = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.report_output_expired'`;

    state.client = db as unknown as Record<string, unknown>;
    await expect(clearExpiredOutputs(10, now)).resolves.toBe(1);
    const artifactRows = await db.$queryRaw<Array<{ id: string; output: unknown; outputExpiresAt: Date | null; status: string; rowCount: number }>>`SELECT id, output, "outputExpiresAt", status, "rowCount" FROM report_runs WHERE id = ANY(${[eligibleId, purgingId]}::text[]) ORDER BY id`;
    expect(artifactRows).toEqual([
      { id: eligibleId, output: null, outputExpiresAt: null, status: 'completed', rowCount: 1 },
      { id: purgingId, output: JSON.parse(output), outputExpiresAt: expiredAt, status: 'completed', rowCount: 1 },
    ].sort((a, b) => a.id.localeCompare(b.id)));
    const eligibleAudit = await db.$queryRaw<Array<{ n: bigint; runs: number }>>`SELECT COUNT(*)::bigint AS n, MAX((detail->>'runs')::int) AS runs FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.report_output_expired'`;
    const purgeAudit = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM activity_logs WHERE "workspaceId" = ${purgeWorkspaceId} AND action = 'analytics.report_output_expired'`;
    expect(Number(eligibleAudit[0]!.n) - Number(auditsBefore[0]!.n)).toBe(1);
    expect(eligibleAudit[0]!.runs).toBe(1);
    expect(Number(purgeAudit[0]!.n)).toBe(0);
  }, 30000);

  it('preserves history when a schedule is deleted and removes it on target or workspace erasure', async () => {
    await db.$executeRaw`INSERT INTO report_schedules (id, "workspaceId", "targetId", frequency, recipients, "nextRunAt") VALUES (${scheduleId}, ${workspaceId}, ${targetId}, 'weekly', ARRAY[]::text[], ${now})`;
    const scheduled = await insertRun('schedule_fk', { scheduleId });
    await db.$executeRaw`DELETE FROM report_schedules WHERE id = ${scheduleId}`;
    const detached = await db.$queryRaw<Array<{ scheduleId: string | null }>>`SELECT "scheduleId" FROM report_runs WHERE id = ${scheduled.id}`;
    expect(detached).toEqual([{ scheduleId: null }]);

    const targetHistory = await insertRun('target_erasure');
    await db.target.delete({ where: { id: targetId } });
    const afterTargetErasure = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM report_runs WHERE id = ${targetHistory.id}`;
    expect(afterTargetErasure).toEqual([]);

    await db.target.create({ data: { id: targetId, workspaceId, type: 'page', providerId: `${targetId}_provider_again`, name: 'Synthetic report channel', enabled: true, canPublish: true, createdAt: now } });
    const workspaceHistory = await insertRun('workspace_erasure');
    await db.workspace.delete({ where: { id: workspaceId } });
    const afterWorkspaceErasure = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM report_runs WHERE id = ${workspaceHistory.id}`;
    expect(afterWorkspaceErasure).toEqual([]);
    // Restore fixture for the verified suite cleanup; this workspace is synthetic and empty after erasure.
    await db.workspace.create({ data: { id: workspaceId, name: 'Disposable Reports 82', slug: workspaceId, timezone: 'UTC' } });
    await db.target.create({ data: { id: targetId, workspaceId, type: 'page', providerId: `${targetId}_provider_restored`, name: 'Synthetic report channel', enabled: true, canPublish: true, createdAt: now } });
  }, 30000);

  it('rejects inserts and updates during active erasure while still allowing history deletion', async () => {
    const existing = await insertRun('purge_gate');
    await db.$executeRaw`INSERT INTO workspace_data_purges ("workspaceId", status, "requestedById", "mediaRoot", "requestedAt", "updatedAt") VALUES (${workspaceId}, 'requested', ${'synthetic_reports82_owner'}, ${`/tmp/${workspaceId}`}, ${now}, ${now})`;
    try {
      await expect(insertRun('purge_blocked')).rejects.toMatchObject({ code: 'P2010', meta: { code: '55000' } });
      await expect(db.$executeRaw`UPDATE report_runs SET status = 'failed', "finishedAt" = ${now} WHERE id = ${existing.id}`).rejects.toMatchObject({ code: 'P2010', meta: { code: '55000' } });
      await db.$executeRaw`DELETE FROM report_runs WHERE id = ${existing.id}`;
      const remains = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM report_runs WHERE id = ${existing.id}`;
      expect(remains).toEqual([]);
      const existingWorkspace = await db.workspace.findUnique({ where: { id: workspaceId } });
      expect(existingWorkspace).not.toBeNull();
    } finally {
      await db.$executeRaw`DELETE FROM workspace_data_purges WHERE "workspaceId" = ${workspaceId}`;
    }
  }, 30000);

  it('orders a fenced writer against workspace erasure without leaving a run or audit behind', async () => {
    const fixture = await insertRun('purge_race');
    const pidRows = await contender.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    const writerPid = pidRows[0]!.pid;
    let locked!: () => void;
    const lockHeld = new Promise<void>(resolve => { locked = resolve; });
    const erasure = db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
      await tx.$executeRaw`INSERT INTO workspace_data_purges ("workspaceId", status, "requestedById", "mediaRoot", "requestedAt", "updatedAt") VALUES (${workspaceId}, 'requested', ${'synthetic_reports82_owner'}, ${`/tmp/${workspaceId}`}, ${now}, ${now})`;
      locked();
      // A bounded poll proves the worker reached the trigger and is waiting on this parent lock.
      let waiting = false;
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const rows = await tx.$queryRaw<Array<{ blocked: boolean }>>`SELECT ${writerPid} <> 0 AND pg_blocking_pids(${writerPid}::integer) @> ARRAY[pg_backend_pid()] AS blocked`;
        blocked = rows[0]?.blocked === true;
        if (blocked) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting, `No backend reported this erasure transaction as the writer blocker (writer pid=${writerPid}, last blocked=${blocked})`).toBe(true);
      // Real erasure deletes children while holding the workspace lock; a row-lock inversion here
      // would deadlock against fencedUpdate's row update followed by the purge gate's parent lock.
      await tx.$executeRaw`DELETE FROM report_runs WHERE id = ${fixture.id}`;
    }, { timeout: 10000 });
    const writer = (async () => {
      await Promise.race([lockHeld, erasure.then(() => { throw new Error('Erasure ended before acquiring and holding the workspace lock'); })]);
      state.client = contender as unknown as Record<string, unknown>;
      // The one-connection pool reuses this known PID for finishRun; polling below confirms the UPDATE is actually blocked.
      return finishRun({ id: fixture.id, workspaceId, token: fixture.token }, { status: 'completed', rowCount: 3 }, () => now, 0, {
        audit: { actor, action: 'analytics.reports82.purge_race', detail: { runId: fixture.id } },
      });
    })();
    await expect(erasure).resolves.toBeUndefined();
    await expect(writer).resolves.toBe(false);
    state.client = db as unknown as Record<string, unknown>;
    await db.$executeRaw`DELETE FROM workspace_data_purges WHERE "workspaceId" = ${workspaceId}`;
    const remaining = await db.$queryRaw<Array<{ runId: string | null; audits: bigint }>>`SELECT (SELECT id FROM report_runs WHERE id = ${fixture.id}) AS "runId", (SELECT COUNT(*)::bigint FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.reports82.purge_race') AS audits`;
    expect(remaining).toEqual([{ runId: null, audits: BigInt(0) }]);
  }, 15000);

  it('orders expired-output maintenance against workspace erasure without deadlock or an expiry audit', async () => {
    const id = rowId('expiry_purge_race');
    const expiredAt = new Date('1970-01-01T00:00:00.000Z');
    const output = JSON.stringify({ filename: 'synthetic-expired.csv', csv: 'date,views\\n2026-10-01,2' });
    await db.$executeRaw`INSERT INTO report_runs (id, "workspaceId", "targetId", kind, "idempotencyKey", "claimToken", "requestHash", "periodStart", "periodEnd", status, "leaseUntil", "finishedAt", "rowCount", output, "outputExpiresAt") VALUES (${id}, ${workspaceId}, ${targetId}, 'manual', ${`idem_${id}`}, ${`claim_${id}`}, ${'d'.repeat(64)}, '2026-10-01', '2026-10-07', 'completed', ${now}, ${now}, 1, ${output}::jsonb, ${expiredAt})`;

    try {
      // The maintenance query is global. Limit it to one and prove this uniquely old
      // synthetic fixture is first, so no unrelated preview artifact can be swept.
      const firstEligible = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM report_runs WHERE output IS NOT NULL AND ("outputExpiresAt" IS NULL OR "outputExpiresAt" < ${now}) ORDER BY "outputExpiresAt" ASC NULLS FIRST LIMIT 1`;
      expect(firstEligible).toEqual([{ id }]);
      const auditsBefore = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.report_output_expired'`;

      const pidRows = await contender.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      const maintenancePid = pidRows[0]!.pid;
      // One connection makes the PID observed above the exact backend used by the worker.
      await contender.$executeRawUnsafe("SET statement_timeout = '7000ms'");

      let locked!: () => void;
      const lockHeld = new Promise<void>(resolve => { locked = resolve; });
      const erasure = db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '7000ms'`;
        await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
        await tx.$executeRaw`INSERT INTO workspace_data_purges ("workspaceId", status, "requestedById", "mediaRoot", "requestedAt", "updatedAt") VALUES (${workspaceId}, 'requested', ${'synthetic_reports82_owner'}, ${`/tmp/${workspaceId}`}, ${now}, ${now})`;
        locked();

        // Wait until clearExpiredOutputs has locked the run and reached its purge-gate
        // trigger. Erasure then deletes that same child while it owns the workspace row.
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const rows = await tx.$queryRaw<Array<{ blocked: boolean }>>`SELECT ${maintenancePid} <> 0 AND pg_blocking_pids(${maintenancePid}::integer) @> ARRAY[pg_backend_pid()] AS blocked`;
          blocked = rows[0]?.blocked === true;
          if (blocked) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(blocked, `Expired-output worker PID ${maintenancePid} never reached the workspace purge-gate lock`).toBe(true);
        await tx.$executeRaw`DELETE FROM report_runs WHERE id = ${id}`;
      }, { timeout: 10000 });

      await lockHeld;
      state.client = contender as unknown as Record<string, unknown>;
      const maintenance = clearExpiredOutputs(1, now);
      const [erasureResult, maintenanceResult] = await Promise.allSettled([erasure, maintenance]);
      const sqlState = (error: unknown) => {
        if (!error || typeof error !== 'object') return 'unknown';
        const value = error as { code?: unknown; meta?: { code?: unknown }; cause?: unknown };
        if (typeof value.meta?.code === 'string') return value.meta.code;
        if (typeof value.code === 'string') return value.code;
        if (value.cause && typeof value.cause === 'object') return sqlState(value.cause);
        return 'unknown';
      };
      expect(erasureResult.status, `Erasure failed with SQLSTATE ${erasureResult.status === 'rejected' ? sqlState(erasureResult.reason) : 'none'}`).toBe('fulfilled');
      expect(maintenanceResult.status, `Output maintenance failed with SQLSTATE ${maintenanceResult.status === 'rejected' ? sqlState(maintenanceResult.reason) : 'none'}`).toBe('fulfilled');
      if (maintenanceResult.status === 'fulfilled') expect(maintenanceResult.value).toBe(0);

      const remaining = await db.$queryRaw<Array<{ runId: string | null; auditDelta: bigint }>>`SELECT (SELECT id FROM report_runs WHERE id = ${id}) AS "runId", ((SELECT COUNT(*)::bigint FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.report_output_expired') - ${auditsBefore[0]!.n}) AS "auditDelta"`;
      expect(remaining).toEqual([{ runId: null, auditDelta: BigInt(0) }]);
    } finally {
      state.client = db as unknown as Record<string, unknown>;
      await db.$executeRaw`DELETE FROM workspace_data_purges WHERE "workspaceId" = ${workspaceId}`;
      await db.$executeRaw`DELETE FROM report_runs WHERE id = ${id}`;
      await db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.report_output_expired'`;
    }
  }, 15000);

  it('orders the stale-run interruption sweep against workspace erasure without deadlock or an interruption audit', async () => {
    const fixture = await insertRun('stale_sweep_purge_race', { leaseUntil: new Date('1970-01-01T00:00:00.000Z') });
    try {
      // The sweep is global, so use a one-row Root batch and verify this uniquely old
      // synthetic lease is first before the worker can touch any candidate.
      const firstStale = await db.$queryRaw<Array<{ id: string }>>`SELECT r.id FROM report_runs r WHERE r.status IN ('claimed','generating','delivering') AND r."leaseUntil" < ${now} AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = r."workspaceId" AND p.status::text <> 'completed') ORDER BY r."leaseUntil" ASC, r.id ASC LIMIT 1`;
      expect(firstStale).toEqual([{ id: fixture.id }]);
      // runDueReportSchedules also runs the output-retention sweep before returning
      // disabled. Assert it has no unrelated eligible artifact to clean in this probe.
      const outputCandidates = await db.$queryRaw<Array<{ id: string }>>`SELECT r.id FROM report_runs r WHERE r.output IS NOT NULL AND (r."outputExpiresAt" IS NULL OR r."outputExpiresAt" < ${now}) AND NOT EXISTS (SELECT 1 FROM workspace_data_purges p WHERE p."workspaceId" = r."workspaceId" AND p.status::text <> 'completed') ORDER BY r."outputExpiresAt" ASC NULLS FIRST LIMIT 1`;
      expect(outputCandidates).toEqual([]);
      const auditsBefore = await db.$queryRaw<Array<{ n: bigint }>>`SELECT COUNT(*)::bigint AS n FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.report_run_interrupted'`;

      const pidRows = await contender.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      const workerPid = pidRows[0]!.pid;
      await contender.$executeRawUnsafe("SET statement_timeout = '7000ms'");

      let locked!: () => void;
      const lockHeld = new Promise<void>(resolve => { locked = resolve; });
      const erasure = db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '7000ms'`;
        await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${workspaceId} FOR UPDATE`;
        await tx.$executeRaw`INSERT INTO workspace_data_purges ("workspaceId", status, "requestedById", "mediaRoot", "requestedAt", "updatedAt") VALUES (${workspaceId}, 'requested', ${'synthetic_reports82_owner'}, ${`/tmp/${workspaceId}`}, ${now}, ${now})`;
        locked();

        // The real worker job must reach the gate while this erasure owns the parent
        // lock. Deleting the child then exposes any child-row/parent-row inversion.
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const rows = await tx.$queryRaw<Array<{ blocked: boolean }>>`SELECT ${workerPid} <> 0 AND pg_blocking_pids(${workerPid}::integer) @> ARRAY[pg_backend_pid()] AS blocked`;
          blocked = rows[0]?.blocked === true;
          if (blocked) break;
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(blocked, `Report worker PID ${workerPid} never reached a lock blocked by this erasure transaction`).toBe(true);
        await tx.$executeRaw`DELETE FROM report_runs WHERE id = ${fixture.id}`;
      }, { timeout: 10000 });

      await Promise.race([lockHeld, erasure.then(() => { throw new Error('Erasure ended before acquiring and holding the workspace lock'); })]);
      unregisterReportGeneration();
      resetReportCapabilityCache();
      state.client = contender as unknown as Record<string, unknown>;
      const job = runDueReportSchedules({ now, limits: reportConfigDefaults });
      const [erasureResult, jobResult] = await Promise.allSettled([erasure, job]);
      const sqlState = (error: unknown): string => {
        if (!error || typeof error !== 'object') return 'unknown';
        const value = error as { code?: unknown; meta?: { code?: unknown }; cause?: unknown };
        if (typeof value.meta?.code === 'string') return value.meta.code;
        if (typeof value.code === 'string') return value.code;
        return value.cause && typeof value.cause === 'object' ? sqlState(value.cause) : 'unknown';
      };
      expect(erasureResult.status, `Erasure failed with SQLSTATE ${erasureResult.status === 'rejected' ? sqlState(erasureResult.reason) : 'none'}`).toBe('fulfilled');
      expect(jobResult.status, `Reports worker failed with SQLSTATE ${jobResult.status === 'rejected' ? sqlState(jobResult.reason) : 'none'}`).toBe('fulfilled');
      if (jobResult.status === 'fulfilled') expect(jobResult.value).toMatchObject({ disabled: true, interrupted: 0, maintenanceFailures: 0, cleared: 0 });

      const remaining = await db.$queryRaw<Array<{ runId: string | null; auditDelta: bigint }>>`SELECT (SELECT id FROM report_runs WHERE id = ${fixture.id}) AS "runId", ((SELECT COUNT(*)::bigint FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.report_run_interrupted') - ${auditsBefore[0]!.n}) AS "auditDelta"`;
      expect(remaining).toEqual([{ runId: null, auditDelta: BigInt(0) }]);
    } finally {
      state.client = db as unknown as Record<string, unknown>;
      await db.$executeRaw`DELETE FROM workspace_data_purges WHERE "workspaceId" = ${workspaceId}`;
      await db.$executeRaw`DELETE FROM report_runs WHERE id = ${fixture.id}`;
      await db.$executeRaw`DELETE FROM activity_logs WHERE "workspaceId" = ${workspaceId} AND action = 'analytics.report_run_interrupted'`;
      unregisterReportGeneration();
      resetReportCapabilityCache();
    }
  }, 15000);
});
