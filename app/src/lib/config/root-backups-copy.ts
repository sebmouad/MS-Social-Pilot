/** Default operator copy for the Root backups and diagnostics page. */
export const ROOT_BACKUPS_COPY = {
  metadataTitle: 'Backups · Root',
  summaryUnavailable: 'Backup records are not available in this database. Backup state is unverified.',
  summaryRecent: 'Recent runs are recorded. Backup contents and restorability are not verified here.',
  summaryAttention: 'At least one backup check needs attention or has no record. Backup state is unverified.',
  limitEntries: 'Entries are written by the server backup scripts; this screen does not read the backup files.',
  limitRestore: 'A recorded success is not proof that a restore works for the current release.',
  limitNoActions: 'No backup, restore or rollback can be started from Root.',
  providerHealthNote: 'Provider connectivity is checked only by Root diagnostics for the owning module; nothing here implies it passed.',
  eyebrow: 'Root · Shared controls',
  title: 'Backups and diagnostics',
  intro: 'Read-only view of what the server backup scripts recorded. Root cannot start, restore or verify a backup from this screen.',
  unavailable: 'Status unavailable',
  recordsReadFailure: 'Backup records could not be read. Backup state is unverified.',
  limitsLabel: 'What this does not prove',
  lastSuccess: 'Last success {time} ({age} h ago)',
  lastSuccessAgeUnknown: 'Last success {time} (age unavailable)',
  noSuccess: 'No successful run recorded',
  staleAfter: 'Flagged as out of date after {hours} h. Archive contents unverified.',
  noRunsUnavailable: 'This database has no backup record table.',
  noRuns: 'No runs have been recorded. Backup state is unverified.',
  runsRegion: 'Recorded backup runs',
  runsCaption: 'Recorded backup and restore-test runs',
  runsTitle: 'Recorded runs',
  finished: 'Finished',
  kind: 'Kind',
  result: 'Result reported',
  note: 'Note',
  offsiteBackup: 'Off-site backup',
  restoreTest: 'Restore test',
  success: 'Success',
  failed: 'Failed',
  diagnosticsTitle: 'Installation diagnostics',
  diagnosticsFailure: 'Diagnostics could not be read.',
  openErrors: 'Open errors: {count} ({recent} seen in the last 24 hours)',
  errorsUnknown: 'Open errors: unknown (error log unavailable)',
  openErrorLog: 'Open the error log',
  openAlerts: 'Open system alerts: {count}',
  alertsUnknown: 'Open system alerts: unknown (alert records unavailable)',
  alertOpened: '{key} since {time}',
  providerHealth: 'Provider health: not assessed here. {note} Module checks run from each module\'s Root page and',
  operationsLink: 'Operations',
  state: {
    recent: 'Recorded recently',
    stale: 'Record is out of date',
    failed_latest: 'Latest run failed',
    never_recorded: 'Never recorded'
  }
} as const;

export type RootBackupsCopy = {
  [K in keyof typeof ROOT_BACKUPS_COPY]: K extends 'state'
    ? { [S in keyof typeof ROOT_BACKUPS_COPY.state]: string }
    : string
};

/** Replace only named placeholders; catalog values render as plain React text. */
export function backupsCopyText(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}
