/** Registry validation boundaries, reused by Root audit forms; changing them requires a release. */
export const ROOT_AUDIT_BOUNDS = {
  retentionDays: { min: 0, max: 36500 }, exportRows: { min: 1, max: 100000 }, batchSize: { min: 1, max: 10000 },
} as const;
export const ROOT_AUDIT_DOWNLOAD = { objectUrlReleaseMs: 1000, filename: 'root-activity.csv' } as const;
export const ROOT_AUDIT_CONTROLS_COPY = {
  exportFailure: 'Export failed. Please retry.', invalidResponse: 'Export response was invalid. Please retry.',
  prepared: 'CSV prepared.', preparing: 'Preparing CSV…', export: 'Export CSV',
  coverage: 'All matching Root history, up to {limit} events. Oversized results are refused.',
  retention: 'Audit retention days (0 keeps forever)', exportRows: 'Export row limit', batchSize: 'Retention batch size per table',
  warning: 'Applies to Root and workspace activity. Older events are permanently deleted in bounded worker batches.',
  saving: 'Saving…', save: 'Save audit settings',
  invalidDays: 'Enter whole retention days from {min} to {max}.', saved: 'Retention saved.', saveFailure: 'Retention could not be saved. Please retry.',
} as const;
export type RootAuditControlsCopy = { [K in keyof typeof ROOT_AUDIT_CONTROLS_COPY]: string };
export type RootAuditDownloadPolicy = { objectUrlReleaseMs: number; filename: string };
export const auditControlsText = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (whole, key: string) => key in values ? String(values[key]) : whole);
