import { prisma } from '@/server/data';
import { assertRootActor, isMissingRelation, redact } from './authz';
import { rootResultLimit, adminSetting } from './policy';
import { runtimeConfig } from '@/server/config/store';
import { ROOT_BACKUPS_COPY } from '@/lib/config/root-backups-copy';

type Run = { id: string; kind: string; status: string; detail: string | null; startedAt: Date; finishedAt: Date };
export type BackupState = 'recent' | 'stale' | 'failed_latest' | 'never_recorded';

const KINDS = [
  { kind: 'offsite', labelKey: 'offsiteBackup' },
  { kind: 'restore_test', labelKey: 'restoreTest' },
] as const;

async function backupCopy() {
  return runtimeConfig('root.backupsCopy').catch(() => ROOT_BACKUPS_COPY);
}

export async function readRootBackupStatus(actorId: string, now: Date = new Date(), resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const [copy, limit, offsiteHours, restoreDays] = await Promise.all([backupCopy(), adminSetting('root.admin.backupRunHistoryLimit'), adminSetting('root.admin.offsiteBackupMaxAgeHours'), adminSetting('root.admin.restoreTestMaxAgeDays')]);
  let runs: Run[];
  let latestRuns: Run[];
  let successRuns: Run[];
  try {
    runs = await prisma.$queryRaw<Run[]>`SELECT id, kind, status, detail, "startedAt", "finishedAt" FROM backup_runs ORDER BY "finishedAt" DESC, id LIMIT ${rootResultLimit(limit, resultCap)}`;
    latestRuns = await prisma.$queryRaw<Run[]>`SELECT DISTINCT ON (kind) id, kind, status, detail, "startedAt", "finishedAt" FROM backup_runs WHERE kind IN ('offsite', 'restore_test') ORDER BY kind, "finishedAt" DESC, id DESC`;
    successRuns = await prisma.$queryRaw<Run[]>`SELECT DISTINCT ON (kind) id, kind, status, detail, "startedAt", "finishedAt" FROM backup_runs WHERE kind IN ('offsite', 'restore_test') AND status = 'ok' ORDER BY kind, "finishedAt" DESC, id DESC`;
  } catch (error) {
    if (!isMissingRelation(error)) throw error;
    return { source: 'unavailable' as const, checks: [], runs: [], limits: [copy.limitEntries, copy.limitRestore, copy.limitNoActions], summary: copy.summaryUnavailable };
  }
  const maxAge = { offsite: offsiteHours * 3_600_000, restore_test: restoreDays * 86_400_000 } as const;
  const checks = KINDS.map(({ kind, labelKey }) => {
    const latest = latestRuns.find(run => run.kind === kind) ?? null;
    const lastOk = successRuns.find(run => run.kind === kind && run.status === 'ok') ?? null;
    const age = lastOk ? now.getTime() - lastOk.finishedAt.getTime() : null;
    const state: BackupState = !latest ? 'never_recorded' : latest.status !== 'ok' ? 'failed_latest' : age! > maxAge[kind] ? 'stale' : 'recent';
    return {
      kind, label: copy[labelKey], state,
      lastSuccessAt: lastOk ? lastOk.finishedAt.toISOString() : null, lastRunAt: latest ? latest.finishedAt.toISOString() : null, lastRunStatus: latest?.status ?? null,
      ageHours: age === null ? null : Math.floor(age / 3_600_000), staleAfterHours: Math.round(maxAge[kind] / 3_600_000),
      verification: 'recorded_by_script' as const,
    };
  });
  const detailMax = await adminSetting('root.admin.errorMessageMaxCharacters');
  return {
    source: 'backup_runs' as const, checks, limits: [copy.limitEntries, copy.limitRestore, copy.limitNoActions],
    runs: runs.map(run => ({ id: run.id, kind: run.kind, status: run.status, detail: redact(run.detail, detailMax), startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt.toISOString() })),
    summary: checks.every(check => check.state === 'recent') ? copy.summaryRecent : copy.summaryAttention,
  };
}

/** Open installation alerts and error counts: facts the app itself recorded. Provider health is deliberately not assessed. */
export async function readRootDiagnosticsSummary(actorId: string, now: Date = new Date(), resultCap?: number) {
  await assertRootActor(prisma, actorId);
  const [copy, alertLimit] = await Promise.all([backupCopy(), adminSetting('root.admin.openAlertLimit')]);
  const limit = rootResultLimit(alertLimit, resultCap);
  const alerts = await prisma.$queryRaw<Array<{ id: string; key: string; openedAt: Date }>>`SELECT id, key, "openedAt" FROM system_alerts WHERE "resolvedAt" IS NULL ORDER BY "openedAt" DESC, id LIMIT ${limit}`.then(rows => ({ available: true as const, rows }), error => { if (isMissingRelation(error)) return { available: false as const, rows: [] }; throw error; });
  // The openLast24h response field and its reporting window are existing metric semantics; the catalog controls only its display copy.
  const errors = await prisma.$queryRaw<Array<{ open: number; last24h: number }>>`SELECT COUNT(*) FILTER (WHERE "resolvedAt" IS NULL)::int AS open, COUNT(*) FILTER (WHERE "resolvedAt" IS NULL AND "lastSeenAt" >= ${new Date(now.getTime() - 86_400_000)})::int AS last24h FROM error_events`.then(rows => ({ available: true as const, open: rows[0]?.open ?? 0, last24h: rows[0]?.last24h ?? 0 }), error => { if (isMissingRelation(error)) return { available: false as const, open: 0, last24h: 0 }; throw error; });
  return {
    openAlerts: alerts.available ? alerts.rows.map(alert => ({ id: alert.id, key: alert.key, openedAt: alert.openedAt.toISOString() })) : null,
    errors: errors.available ? { open: errors.open, openLast24h: errors.last24h } : null,
    providerHealth: { state: 'not_assessed' as const, note: copy.providerHealthNote },
  };
}
