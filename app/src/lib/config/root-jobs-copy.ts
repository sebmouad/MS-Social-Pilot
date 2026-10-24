/** Default operator copy for Root background job health. */
export const ROOT_JOBS_COPY = {
  unavailableTitle: 'Background work unavailable',
  unavailableBody: 'Worker health could not be loaded. Check database and service availability, then reload.',
  sectionLabel: 'Replacement background work',
  eyebrow: 'Operations',
  title: 'Background work',
  enabled: 'Execution enabled',
  disabled: 'Execution disabled',
  freshHeartbeat: 'Recent replacement-worker heartbeat',
  staleHeartbeat: 'Replacement-worker heartbeat is stale',
  noHeartbeat: 'No replacement-worker heartbeat',
  sharedHistory: 'Only replacement job history is shown. Shared jobs may cover several platforms; this is not platform-specific API health.',
  latestSucceeded: 'Latest attempt succeeded',
  latestFailed: 'Latest attempt failed',
  latestUnknown: 'Latest outcome unknown',
  noWindowAttempt: 'No attempt in this history window',
  recentAttempts: 'Recent attempts',
  caption: 'Replacement job attempts',
  job: 'Job',
  started: 'Started',
  result: 'Result',
  attempts: 'Attempts',
  duration: 'Duration',
  errorRecorded: 'error recorded; inspect service logs securely',
  inProgress: 'In progress',
  noAttempts: 'No recorded attempts.'
} as const;

export type RootJobsCopy = { [K in keyof typeof ROOT_JOBS_COPY]: string };

export function jobsCopyText(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}
