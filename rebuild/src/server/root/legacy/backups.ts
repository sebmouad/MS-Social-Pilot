import { prisma } from '@/server/data';
import { assertRootActor, isMissingRelation, redact } from './authz';
import { rootResultLimit, legacySetting } from './policy';

type Run = { id: string; kind: string; status: string; detail: string | null; startedAt: Date; finishedAt: Date };
export type BackupState = 'recent' | 'stale' | 'failed_latest' | 'never_recorded';

const KINDS = [
  { kind: 'offsite', label: 'Off-site backup' },
  { kind: 'restore_test', label: 'Restore test' },
] as const;

/**
 * What can truthfully be read: rows the external backup scripts recorded in
 * `backup_runs`. This service never runs, schedules, inspects or restores a
 * backup, so a "recent" entry means "a script reported success recently", not
 * that the archive exists or restores. That limit is returned with the data.
 */
export const BACKUP_LIMITS = [
  'Entries are written by the server backup scripts; this screen does not read the backup files.',
  'A recorded success is not proof that a restore works for the current release.',
  'No backup, restore or rollback can be started from Root.',
] as const;

export async function readRootBackupStatus(actorId: string, now: Date = new Date(), resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const [limit, offsiteHours, restoreDays] = await Promise.all([legacySetting('root.legacy.backupRunHistoryLimit'), legacySetting('root.legacy.offsiteBackupMaxAgeHours'), legacySetting('root.legacy.restoreTestMaxAgeDays')]);
  let runs: Run[];
  let latestRuns: Run[];
  let successRuns: Run[];
  try {
    runs = await prisma.$queryRaw<Run[]>`SELECT id, kind, status, detail, "startedAt", "finishedAt" FROM backup_runs ORDER BY "finishedAt" DESC, id LIMIT ${rootResultLimit(limit, resultCap)}`;
    latestRuns = await prisma.$queryRaw<Run[]>`SELECT DISTINCT ON (kind) id, kind, status, detail, "startedAt", "finishedAt" FROM backup_runs WHERE kind IN ('offsite', 'restore_test') ORDER BY kind, "finishedAt" DESC, id DESC`;
    successRuns = await prisma.$queryRaw<Run[]>`SELECT DISTINCT ON (kind) id, kind, status, detail, "startedAt", "finishedAt" FROM backup_runs WHERE kind IN ('offsite', 'restore_test') AND status = 'ok' ORDER BY kind, "finishedAt" DESC, id DESC`;
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    return { source: 'unavailable' as const, checks: [], runs: [], limits: BACKUP_LIMITS, summary: 'Backup records are not available in this database. Backup state is unverified.' };
  }
  const maxAge = { offsite: offsiteHours * 3_600_000, restore_test: restoreDays * 86_400_000 } as const;
  const checks = KINDS.map(({ kind, label }) => {
    const latest = latestRuns.find(run => run.kind === kind) ?? null;
    const lastOk = successRuns.find(run => run.kind === kind && run.status === 'ok') ?? null;
    const age = lastOk ? now.getTime() - lastOk.finishedAt.getTime() : null;
    const state: BackupState = !latest ? 'never_recorded' : latest.status !== 'ok' ? 'failed_latest' : age! > maxAge[kind] ? 'stale' : 'recent';
    return {
      kind, label, state,
      lastSuccessAt: lastOk ? lastOk.finishedAt.toISOString() : null, lastRunAt: latest ? latest.finishedAt.toISOString() : null, lastRunStatus: latest?.status ?? null,
      ageHours: age === null ? null : Math.floor(age / 3_600_000), staleAfterHours: Math.round(maxAge[kind] / 3_600_000),
      verification: 'recorded_by_script' as const,
    };
  });
  const detailMax = await legacySetting('root.legacy.errorMessageMaxCharacters');
  return {
    source: 'backup_runs' as const, checks, limits: BACKUP_LIMITS,
    runs: runs.map(run => ({ id: run.id, kind: run.kind, status: run.status, detail: redact(run.detail, detailMax), startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt.toISOString() })),
    summary: checks.every(check => check.state === 'recent') ? 'Recent runs are recorded. Backup contents and restorability are not verified here.' : 'At least one backup check needs attention or has no record. Backup state is unverified.',
  };
}

/** Open installation alerts and error counts: facts the app itself recorded. Provider health is deliberately not assessed. */
export async function readRootDiagnosticsSummary(actorId: string, now: Date = new Date(), resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const limit = rootResultLimit(await legacySetting('root.legacy.openAlertLimit'), resultCap);
  const alerts = await prisma.$queryRaw<Array<{ id: string; key: string; openedAt: Date }>>`SELECT id, key, "openedAt" FROM system_alerts WHERE "resolvedAt" IS NULL ORDER BY "openedAt" DESC, id LIMIT ${limit}`.then(rows => ({ available: true as const, rows }), error => { if (isMissingRelation(error)) return { available: false as const, rows: [] }; throw error; });
  const errors = await prisma.$queryRaw<Array<{ open: number; last24h: number }>>`SELECT COUNT(*) FILTER (WHERE "resolvedAt" IS NULL)::int AS open, COUNT(*) FILTER (WHERE "resolvedAt" IS NULL AND "lastSeenAt" >= ${new Date(now.getTime() - 86_400_000)})::int AS last24h FROM error_events`.then(rows => ({ available: true as const, open: rows[0]?.open ?? 0, last24h: rows[0]?.last24h ?? 0 }), error => { if (isMissingRelation(error)) return { available: false as const, open: 0, last24h: 0 }; throw error; });
  return {
    openAlerts: alerts.available ? alerts.rows.map(alert => ({ id: alert.id, key: alert.key, openedAt: alert.openedAt.toISOString() })) : null,
    errors: errors.available ? { open: errors.open, openLast24h: errors.last24h } : null,
    providerHealth: { state: 'not_assessed' as const, note: 'Provider connectivity is checked only by Root diagnostics for the owning module; nothing here implies it passed.' },
  };
}
