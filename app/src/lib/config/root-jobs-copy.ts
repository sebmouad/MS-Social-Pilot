/** Default operator copy for Root background job health. */
export const ROOT_JOBS_COPY = {
  unavailableTitle: 'Background work unavailable',
  unavailableBody: 'Worker health could not be loaded. Check database and service availability, then reload.',
  sectionLabel: 'Background work',
  eyebrow: 'Operations',
  title: 'Background work',
  enabled: 'Background work is on',
  disabled: 'Background work is off',
  freshHeartbeat: 'the worker is running, last seen',
  staleHeartbeat: 'the worker has not reported for a while, last seen',
  noHeartbeat: 'the worker has never reported',
  sharedHistory: 'Each tile is one recurring job and how its latest run ended. A job can serve several networks, so a failure here does not name the network.',
  latestSucceeded: 'Succeeded',
  latestFailed: 'Failed',
  latestUnknown: 'Outcome unknown',
  noWindowAttempt: 'Not run recently',
  recentAttempts: 'Recent runs',
  caption: 'Recent job runs',
  job: 'Job',
  started: 'Started',
  result: 'Result',
  attempts: 'Attempts',
  duration: 'Duration',
  errorRecorded: 'see the server logs',
  inProgress: 'In progress',
  noAttempts: 'No runs recorded yet.'
} as const;

export type RootJobsCopy = { [K in keyof typeof ROOT_JOBS_COPY]: string };

export function jobsCopyText(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}
