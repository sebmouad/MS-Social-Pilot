/** Default private-operator copy for platform publication evidence and actions. */
export const ROOT_EVIDENCE_COPY = {
  filter: 'Publication evidence filter',
  platformEvidence: 'Platform evidence',
  operationId: 'Publication operation ID',
  exactOperationId: 'Exact operation ID',
  applyFilter: 'Apply filter',
  resetFilter: 'Reset filter',
  unavailableTitle: 'Publication evidence unavailable',
  invalidOperationId: 'Enter one operation ID using 1–{limit} letters, numbers, underscores or hyphens.',
  unavailable: 'Platform receipt evidence could not be loaded. Reload this module or check installation storage availability.',
  platformOperations: 'Platform operations',
  evidenceBounds: 'Evidence is bounded to operation and receipt details. Any available action requires its own module-defined confirmation and acknowledgment.',
  noOperationEvidence: 'No publication evidence is recorded for this operation.',
  noPlatformEvidence: 'No publication evidence is recorded for this platform.',
  truncated: 'This history is truncated by the platform evidence limit. Use the Platform evidence sidebar filter to narrow the results. Configured limits still apply to a single operation.',
  details: 'Details',
  actions: 'Actions',
  viewReceiptDetails: 'View receipt details',
  viewReceiptDetailsFor: 'View receipt details for {id}',
  actionContext: 'Resolved action context',
  refreshNotice: 'Evidence refreshed. Check the current module action details before continuing.',
  enterField: 'Enter a value for {label}.',
  keepFieldWithin: 'Keep {label} within {limit} characters.',
  chooseField: 'Choose an option for {label}.',
  checkToContinue: 'Check this box to continue.',
  errorResultUnconfirmed: 'The result could not be confirmed. Review the current platform evidence before taking further action.',
  humanReportPrefix: 'Human report recorded. The platform did not independently confirm it. ',
  typeToConfirm: 'Type {confirmation} to confirm',
  exactConfirmation: 'Exact confirmation',
  closeAndReview: 'Close and review',
  cancel: 'Cancel',
  working: 'Working…',
  evidenceReadFailure: 'Platform publication evidence could not be loaded.',
  actionResultFailure: 'The platform action result could not be confirmed. Check the platform evidence before taking further action.',
  unavailablePolicy: 'The platform evidence policy is unavailable.',
  unavailableLimit: 'The platform publication evidence limit is unavailable.',
  choosePlatformAndLimit: 'Choose an installed platform and a valid publication operation or result limit.',
  chooseInstalledPlatform: 'Choose an installed platform.',
  unavailableEvidence: 'Publication evidence is not available for this installed platform.',
  choosePlatformForOperation: 'Choose a platform when filtering by publication operation.',
  enterValidAction: 'Enter one valid platform action and its exact confirmation.',
  enterValidFields: 'Enter valid module action fields.',
  actionUnavailable: 'This platform action is not available.'
} as const;

export type RootEvidenceCopy = { [K in keyof typeof ROOT_EVIDENCE_COPY]: string };

export function evidenceCopyText(template: string, values: Record<string, string | number>) {
  return template.replace(/\{([A-Za-z]+)\}/g, (match, key: string) => key in values ? String(values[key]) : match);
}
