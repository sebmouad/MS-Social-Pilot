import { z } from 'zod';
import { entry } from '@/lib/config/entry';

const G = 'Analytics · Report workflows';
const num = (key: string, label: string, description: string, defaultValue: number, min: number, max: number) =>
  entry({ key, group: G, label, kind: 'number', description, defaultValue, schema: z.number().int().min(min).max(max), consumption: 'active' });

/** Root-managed bounds for report templates and schedule definitions. */
export const REPORT_WORKFLOW_CONFIG = [
  num('analytics.reports.pageSize', 'Report list page size', 'Templates or schedules listed on one page.', 25, 5, 100),
  num('analytics.reports.maxTemplates', 'Report templates per workspace', 'Most saved report templates one workspace may keep.', 50, 1, 500),
  num('analytics.reports.templateNameMaxCharacters', 'Template name limit', 'Longest report template name.', 60, 10, 200),
  num('analytics.reports.maxSchedules', 'Report schedules per workspace', 'Most scheduled report definitions one workspace may keep.', 50, 1, 500),
  num('analytics.reports.maxRecipients', 'Recipients per schedule', 'Most recipients one scheduled report may list.', 10, 1, 100),
  num('analytics.reports.dueBatchSize', 'Schedules claimed per run', 'Most due report schedules one job run claims.', 50, 1, 500),
  num('analytics.reports.transactionTimeoutMs', 'Report change timeout (ms)', 'Transaction time allowed for one report workflow change.', 10000, 1000, 60000),
  num('analytics.reports.transactionMaxWaitMs', 'Report change lock wait (ms)', 'Wait allowed for the workspace lock on a report change.', 5000, 500, 30000),
  num('analytics.reports.maxOutputRows', 'Report rows', 'Most data rows one generated report may contain; longer output is cut and marked as truncated.', 5000, 100, 100000),
  num('analytics.reports.maxOutputBytes', 'Report size limit (bytes)', 'Largest generated report (CSV, JSON or printable page) in bytes; longer output is cut and marked as truncated.', 1000000, 10000, 20000000),
  num('analytics.reports.maxStoredArtifactBytes', 'Prepared report storage limit (bytes)', 'Largest combined stored CSV, JSON, printable page and report metadata for one prepared download.', 3300000, 20000, 45000000),
  num('analytics.reports.runLeaseSeconds', 'Report run lease (seconds)', 'How long a worker may hold a report run before it is recorded as interrupted. An interrupted delivery is never resent automatically.', 600, 60, 3600),
  num('analytics.reports.runHistoryPageSize', 'Run history page size', 'Report runs listed on one page.', 25, 5, 100),
  num('analytics.reports.staleSweepBatchSize', 'Interrupted runs closed per job run', 'Most expired report runs one job run closes; the rest wait for the next run.', 50, 1, 500),
  num('analytics.reports.finishRetries', 'Run result write retries', 'Extra attempts to record a finished report run before leaving it for the interruption sweep. Delivery is never retried.', 2, 0, 5),
  num('analytics.reports.outputRetentionHours', 'Prepared report retention (hours)', 'How long a prepared download is kept so an interrupted request can be recovered with the same request id. Afterwards the result is gone and never regenerated automatically; the run history entry remains.', 24, 1, 720),
  entry({ key: 'analytics.reports.sendTime', group: G, label: 'Scheduled report time', kind: 'text', description: 'Workspace-local HH:MM at which weekly and monthly runs fall due.', defaultValue: '08:00', schema: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), consumption: 'active' }),
] as const;
