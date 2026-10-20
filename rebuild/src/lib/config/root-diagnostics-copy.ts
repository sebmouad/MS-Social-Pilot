/** Default operator copy for the shared Root diagnostics panel. */
export const ROOT_DIAGNOSTICS_COPY = {
  unavailableTitle: 'Diagnostics unavailable',
  unavailableBody: 'History could not be loaded. Check service availability and reload this section.',
  sectionLabel: '{label} diagnostics',
  controls: 'Diagnostic controls',
  title: 'Diagnostics',
  testConnection: 'Test connection',
  configurationOnly: 'Configuration only',
  connectionLimit: 'Showing {limit} recent connections. HTTP/MCP can test another exact connection ID.',
  testing: 'Testing…',
  run: 'Run diagnostics',
  wait: 'Wait at least {interval}s between runs. Unconfirmed runs can block retries for {stale}s.',
  moduleHealth: 'Module health',
  explanation: 'Run checks from the sidebar. Provider checks read the selected connection; they do not publish, change ads or send messages. Passes prove only the stated checks.',
  disabled: 'Diagnostics are disabled in Shared configuration.',
  fallbackFailure: 'Run could not be confirmed. Check history before retrying.',
  invalidReceipt: 'Invalid receipt',
  outcomeUnconfirmed: 'Run outcome is unconfirmed. Check diagnostic history before trying again.',
  auditWarning: 'Completion audit could not be recorded. Keep these results and inspect history before repeating.',
  checksFinished: 'Checks finished: {passed} passed, {failed} failed, {skipped} skipped.',
  latestResults: 'Latest results',
  connection: 'Connection {id}',
  noConnection: 'No connection selected',
  pass: 'Pass',
  fail: 'Fail',
  skipped: 'Skipped',
  noResults: 'No completed diagnostic results yet.',
  recentRuns: 'Recent runs',
  historyResult: '{failed} failed, {skipped} skipped',
  startedUnconfirmed: 'Started; completion unconfirmed',
  viewResults: 'View results',
  noRuns: 'No runs recorded for this scope.',
  auditActivity: 'View diagnostic audit activity'
} as const;

export type RootDiagnosticsCopy = { [K in keyof typeof ROOT_DIAGNOSTICS_COPY]: string };

export function diagnosticsCopyText(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}
