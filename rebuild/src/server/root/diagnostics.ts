import { diagnosticRecoverySeconds, withinDiagnosticDeadline } from '@/server/diagnostics/deadline';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/client';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { OperationError } from '@/lib/operation-error';
import { diagnosticChecks } from '@/server/diagnostics/checks';
import { diagnosticCheckSchema, diagnosticInput, diagnosticRunSchema, diagnosticScope, diagnosticConfirmation, type DiagnosticReceipt, type DiagnosticRun } from '@/lib/diagnostics';
import { requireActiveRoot } from './operations';

async function scopeFor(actorId: string, scopeId: string) {
  await requireActiveRoot(actorId);
  const scope = diagnosticScope(scopeId);
  if (!scope) throw new OperationError('invalid_request', 'Choose an installed diagnostic scope.');
  return scope;
}

/** No secret values, raw transport errors, arbitrary URLs or arbitrary executable checks. */
export async function listRootDiagnostics(actorId: string, scopeId: string, resultCap?: number) {
  const scope = await scopeFor(actorId, scopeId);
  if (resultCap !== undefined && (!Number.isSafeInteger(resultCap) || resultCap < 1)) throw new OperationError('invalid_request', 'Choose a valid diagnostic result limit.');
  const [limit, enabled, minimumIntervalSeconds, incompleteRunStaleSeconds, timeZone, runTimeoutMs, databaseTimeoutMs] = await Promise.all([runtimeConfig('diagnostics.historyLimit'), runtimeConfig('diagnostics.enabled'), runtimeConfig('diagnostics.minimumIntervalSeconds'), runtimeConfig('diagnostics.incompleteRunStaleSeconds'), runtimeConfig('root.operationalTimezone'), runtimeConfig('diagnostics.runTimeoutMs'), runtimeConfig('diagnostics.databaseTimeoutMs')]);
  const [rows, connections] = await Promise.all([
    prisma.$queryRaw<Array<{ detail: unknown; createdAt: Date }>>`SELECT detail, "createdAt" FROM root_activities WHERE action = 'diagnostics.started' AND detail->>'scope' = ${scopeId} ORDER BY "createdAt" DESC, id DESC LIMIT ${Math.min(limit, resultCap ?? limit)}`,
    scope.owner.kind === 'platform' ? prisma.socialAccount.findMany({ where: { provider: scope.owner.id }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: Math.min(limit, resultCap ?? limit), select: { id: true, name: true, workspaceId: true } }) : Promise.resolve([]),
  ]);
  const ids = rows.flatMap(row => {
    const detail = row.detail as Record<string, unknown> | null;
    return detail && typeof detail.runId === 'string' ? [detail.runId] : [];
  });
  const completed = ids.length ? await prisma.$queryRaw<Array<{ detail: unknown }>>(Prisma.sql`SELECT detail FROM root_activities WHERE action = 'diagnostics.completed' AND detail->>'scope' = ${scopeId} AND detail->>'id' IN (${Prisma.join(ids)}) ORDER BY "createdAt" DESC LIMIT ${ids.length}`) : [];
  const results = completed.flatMap(row => { const parsed = diagnosticRunSchema.safeParse(row.detail); return parsed.success ? [parsed.data] : []; });
  const history = rows.flatMap(row => {
    const detail = row.detail as Record<string, unknown> | null;
    if (!detail || typeof detail.runId !== 'string') return [];
    return [{ id: detail.runId, startedAt: row.createdAt.toISOString(), result: results.find(result => result.id === detail.runId) ?? null }];
  });
  return { scope: scopeId, label: scope.label, timeZone, enabled, minimumIntervalSeconds, incompleteRunStaleSeconds: diagnosticRecoverySeconds(incompleteRunStaleSeconds, runTimeoutMs, databaseTimeoutMs), connections, history, connectionLimit: Math.min(limit, resultCap ?? limit) };
}

/** Persist intent before any checks; a failed completion audit never erases returned results. */
export async function runRootDiagnostics(actorId: string, input: unknown): Promise<DiagnosticReceipt> {
  await requireActiveRoot(actorId);
  const parsed = diagnosticInput.safeParse(input);
  if (!parsed.success || parsed.data.confirmation !== diagnosticConfirmation(parsed.data.scope)) throw new OperationError('invalid_request', 'Choose an installed scope and provide its exact diagnostic confirmation.');
  const { scope: scopeId, connectionId } = parsed.data;
  const scope = diagnosticScope(scopeId)!;
  if (connectionId && scope.owner.kind !== 'platform') throw new OperationError('invalid_request', 'Only a platform diagnostic accepts a connection.');
  const [enabled, minimumInterval, timeout, incompleteRunStaleSeconds, runTimeoutMs] = await Promise.all([runtimeConfig('diagnostics.enabled'), runtimeConfig('diagnostics.minimumIntervalSeconds'), runtimeConfig('diagnostics.databaseTimeoutMs'), runtimeConfig('diagnostics.incompleteRunStaleSeconds'), runtimeConfig('diagnostics.runTimeoutMs')]);
  if (!enabled) throw new OperationError('unavailable', 'Diagnostics are disabled in Shared configuration.');
  if (connectionId && scope.owner.kind === 'platform' && !await prisma.socialAccount.findFirst({ where: { id: connectionId, provider: scope.owner.id }, select: { id: true } })) throw new OperationError('not_found', 'Selected connection is unavailable for this platform.');
  const recoverySeconds = diagnosticRecoverySeconds(incompleteRunStaleSeconds, runTimeoutMs, timeout);
  const runId = `diag_${randomUUID()}`;
  // Stable advisory-lock namespace is a persistence protocol, not operator policy.
  // Scope-wide cooldown also prevents rotating connection IDs to bypass it.
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(timeout)}, true)`;
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${'rebuild:diagnostics'}), hashtext(${scopeId}))`;
    const actors = await tx.$queryRaw<Array<{ isInstanceOwner: boolean; disabledAt: Date | null }>>`SELECT "isInstanceOwner", "disabledAt" FROM users WHERE id = ${actorId} FOR SHARE`;
    if (!actors[0]?.isInstanceOwner || actors[0].disabledAt) throw new OperationError('forbidden', 'Installation-owner access is required.');
    const recent = await tx.$queryRaw<Array<{ present: boolean }>>`SELECT EXISTS(SELECT 1 FROM root_activities AS started WHERE action = 'diagnostics.started' AND detail->>'scope' = ${scopeId} AND (
      "createdAt" > (NOW() AT TIME ZONE 'UTC') - ${minimumInterval} * INTERVAL '1 second'
      OR "createdAt" > (NOW() AT TIME ZONE 'UTC') - GREATEST(${incompleteRunStaleSeconds}::int, COALESCE((started.detail->>'recoverySeconds')::int, ${recoverySeconds}::int)) * INTERVAL '1 second'
        AND NOT EXISTS (SELECT 1 FROM root_activities AS completed WHERE completed.action = 'diagnostics.completed' AND completed.detail->>'id' = started.detail->>'runId' AND completed.detail->>'scope' = ${scopeId})
    )) AS present`;
    if (recent[0]?.present) throw new OperationError('conflict', 'This scope was tested recently or still has an unconfirmed run. Wait for its diagnostic interval or recovery window before retrying.');
    await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`${runId}_started`}, ${actorId}, 'diagnostics.started', ${JSON.stringify({ runId, scope: scopeId, connectionId: connectionId ?? null, recoverySeconds })}::jsonb, NOW() AT TIME ZONE 'UTC')`;
  }, { timeout, maxWait: timeout });
  const startedAt = new Date().toISOString();
  const checks: DiagnosticRun['checks'] = [];
  const signal = AbortSignal.timeout(runTimeoutMs);
  try {
    const definitions = await withinDiagnosticDeadline(() => diagnosticChecks(actorId, scopeId, connectionId), signal);
    for (const definition of definitions) {
      if (signal.aborted) { checks.push({ id: definition.id, label: definition.label, status: 'skipped', code: 'deadline_exceeded', message: 'Skipped because this suite reached its configured deadline.', durationMs: 0 }); continue; }
      const start = performance.now();
      let outcome;
      try { outcome = await withinDiagnosticDeadline(() => definition.run(signal), signal); }
      catch { outcome = signal.aborted ? { status: 'fail' as const, code: 'check_timed_out', message: 'Check exceeded the configured suite deadline. Provider requests were cancelled; check service availability before retrying.' } : { status: 'fail' as const, code: 'check_failed', message: 'Check could not complete. Review this scope’s settings and service availability. Internal error details are withheld.' }; }
      checks.push(diagnosticCheckSchema.parse({ id: definition.id, label: definition.label, ...outcome, durationMs: Math.max(0, Math.round(performance.now() - start)) }));
    }
  } catch {
    checks.push({ id: 'diagnostic_setup', label: 'Diagnostic setup', status: 'fail', code: signal.aborted ? 'setup_timed_out' : 'setup_failed', message: signal.aborted ? 'Suite deadline reached while preparing checks. Review service availability before retrying.' : 'Checks could not be prepared. Review module configuration and service availability.', durationMs: 0 });
  }
  const result: DiagnosticRun = { id: runId, scope: scopeId, connectionId: connectionId ?? null, startedAt, finishedAt: new Date().toISOString(), checks };
  try {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(timeout)}, true)`;
      await tx.$executeRaw`INSERT INTO root_activities (id, "actorId", action, detail, "createdAt") VALUES (${`${runId}_completed`}, ${actorId}, 'diagnostics.completed', ${JSON.stringify(result)}::jsonb, NOW() AT TIME ZONE 'UTC')`;
    }, { timeout, maxWait: timeout });
    return { ...result, auditRecorded: true };
  } catch { return { ...result, auditRecorded: false, warning: 'Checks finished, but their completion audit could not be recorded. Keep this receipt; history may show an unconfirmed run.' }; }
}
