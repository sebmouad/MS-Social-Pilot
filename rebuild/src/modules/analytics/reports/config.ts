import { z } from 'zod';
import { entry } from '@/lib/config/entry';

export const RESPONSE_ANALYSIS_LIMITS = { messages: { default: 20000, min: 100, max: 100000 }, events: { default: 20000, min: 100, max: 100000 }, members: { default: 25, min: 1, max: 500 } } as const;

export const LINK_REPORT_POLICY_SCHEMA = z.object({
  links: z.number().int().min(1).max(10000),
  days: z.number().int().min(1).max(3660),
}).strict();
export const LINK_REPORT_DEFAULTS = { links: 100, days: 366 };

export const PUBLICATION_REPORT_POLICY_SCHEMA = z.object({
  publishedRows: z.number().int().min(1).max(10000),
  failedRows: z.number().int().min(1).max(10000),
  excerptCharacters: z.number().int().min(20).max(2000),
}).strict();
export const PUBLICATION_REPORT_DEFAULTS = { publishedRows: 100, failedRows: 100, excerptCharacters: 240 };

export const TOP_POST_CONTENT_POLICY_SCHEMA = z.object({
  imagePreviews: z.boolean(),
  mediaUrlTemplate: z.string().min(1).max(2000).refine(value => /^\/(?!\/)[a-zA-Z0-9/_-]*\{id\}$/.test(value), 'Use an absolute application path ending in {id}.'),
  posts: z.number().int().min(1).max(100),
  textCharacters: z.number().int().min(120).max(20000),
  mediaPerPost: z.number().int().min(1).max(50),
  urlCharacters: z.number().int().min(100).max(8000),
  previewCharacters: z.number().int().min(20).max(2000),
}).strict();
export const TOP_POST_CONTENT_DEFAULTS = { imagePreviews: true, mediaUrlTemplate: '/api/media/{id}', posts: 10, textCharacters: 4000, mediaPerPost: 10, urlCharacters: 2000, previewCharacters: 240 };

const G = 'Analytics · Report workflows';
const num = (key: string, label: string, description: string, defaultValue: number, min: number, max: number) =>
  entry({ key, group: G, label, kind: 'number', description, defaultValue, schema: z.number().int().min(min).max(max), consumption: 'active' });

/** Root-managed bounds for report templates and schedule definitions. */
export const REPORT_WORKFLOW_CONFIG = [
  entry({ key: 'analytics.reports.linkDetails', group: G, label: 'Link report details', kind: 'json', description: 'Independent per-link inventory and UTC click-day row bounds in the Destinations report section. Recorded period clicks may be incomplete after retention; daily counts are independent of inventory clipping.', defaultValue: LINK_REPORT_DEFAULTS, schema: LINK_REPORT_POLICY_SCHEMA, consumption: 'active' }),
  entry({ key: 'analytics.reports.topPostContent', group: G, label: 'Top post content', kind: 'json', description: 'Ranked post count, destination text, attachment count, URL and article preview bounds, image preview switch and authenticated media path template. Report content is saved local state, not a remote snapshot.', defaultValue: TOP_POST_CONTENT_DEFAULTS, schema: TOP_POST_CONTENT_POLICY_SCHEMA, consumption: 'active' }),
  entry({ key: 'analytics.reports.publicationDetails', group: G, label: 'Publication report details', kind: 'json', description: 'Maximum published and currently failed destination rows and content excerpt length in the Published posts report section. Daily UTC totals are counted independently; clipped logs are disclosed.', defaultValue: PUBLICATION_REPORT_DEFAULTS, schema: PUBLICATION_REPORT_POLICY_SCHEMA, consumption: 'active' }),
  num('analytics.reports.responseEventLimit', 'Response analysis workflow events', 'Maximum stored resolution and reopening events examined per channel report. Truncation suppresses resolution durations and is disclosed.', RESPONSE_ANALYSIS_LIMITS.events.default, RESPONSE_ANALYSIS_LIMITS.events.min, RESPONSE_ANALYSIS_LIMITS.events.max),
  num('analytics.reports.responseMessageLimit', 'Response analysis records per source', 'Maximum stored messages and comments examined separately, including pre-period context. Incomplete boundary threads are excluded; truncation and stored-only coverage are disclosed.', RESPONSE_ANALYSIS_LIMITS.messages.default, RESPONSE_ANALYSIS_LIMITS.messages.min, RESPONSE_ANALYSIS_LIMITS.messages.max),
  num('analytics.reports.responseMemberLimit', 'Response analysis member rows', 'Maximum replying members listed in each combined, comment and conversation summary of one channel report; including their slowest replies and saved-resolution outcomes; omitted members are disclosed separately.', RESPONSE_ANALYSIS_LIMITS.members.default, RESPONSE_ANALYSIS_LIMITS.members.min, RESPONSE_ANALYSIS_LIMITS.members.max),
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
