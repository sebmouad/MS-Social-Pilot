import { reportDocumentCatalogDefaults, reportDocumentCopySchema } from './reports/generation/copy';
import { overviewCopyCatalogDefaults, overviewCopySchema } from './overview-copy';
import { responseTimeCopyDefaults, responseTimeCopySchema, errorCopyDefaults, errorCopySchema, recordsCopyDefaults, recordsCopySchema, workspaceCopyDefaults, workspaceCopySchema, demographicsCopyDefaults, demographicsCopySchema, reportCopyDefaults, goalsCopyDefaults, downloadCopyDefaults, reportCopySchema, goalsCopySchema, downloadCopySchema } from './copy';
import { z } from 'zod';
import { entry, cron } from '@/lib/config/entry';
import { DEMOGRAPHICS_CONFIG } from './demographics/config';
import { PINNED_METRIC_CONFIG } from './pins/config';
import { COMPARISON_CONFIG } from './comparison/config';
import { REPORT_WORKFLOW_CONFIG } from './reports/config';
import { REPORT_UI_CONFIG, REPORT_HOST_CONFIG } from './report-ui-config';
import { ANALYTICS_EXPLORER_CONFIG } from './explorer-config';

/** Every Root setting this product module declares. The registry merges installed modules; edit only here. */
export const ANALYTICS_MODULE_CONFIG = [
  entry({ key: 'analytics.responseTimeCopy', group: 'Analytics · Customer copy', label: 'Response time copy', kind: 'json', description: 'English and French duration, business-hours and reply labels.', defaultValue: responseTimeCopyDefaults, schema: responseTimeCopySchema, consumption: 'active' }),
  entry({ key: 'analytics.reportDocumentCopy', group: 'Analytics · Customer copy', label: 'Report document copy', kind: 'json', description: 'English and French downloadable report wording.', defaultValue: reportDocumentCatalogDefaults, schema: reportDocumentCopySchema, consumption: 'active' }),
  entry({ key: 'analytics.reportDocumentLocale', group: 'Analytics · Customer copy', label: 'Report document language', kind: 'select', description: 'Language for generated downloadable reports.', defaultValue: 'en', schema: z.enum(['en', 'fr']), options: [{ value: 'en', label: 'English' }, { value: 'fr', label: 'French' }], consumption: 'active' }),
  entry({ key: 'analytics.errorCopy', group: 'Analytics · Customer copy', label: 'Service error copy', kind: 'json', description: 'English and French shared service errors.', defaultValue: errorCopyDefaults, schema: errorCopySchema, consumption: 'active' }),
  entry({ key: 'analytics.recordsCopy', group: 'Analytics · Customer copy', label: 'Post and ad-object explorer copy', kind: 'json', description: 'English and French customer labels and feedback.', defaultValue: recordsCopyDefaults, schema: recordsCopySchema, consumption: 'active' }),
  entry({ key: 'analytics.overviewCopy', group: 'Analytics · Customer copy', label: 'Overview copy', kind: 'json', description: 'English and French Analytics overview labels and feedback.', defaultValue: overviewCopyCatalogDefaults, schema: overviewCopySchema, consumption: 'active' }),
  entry({ key: 'analytics.workspaceCopy', group: 'Analytics · Customer copy', label: 'Explorer, comparison and pins copy', kind: 'json', description: 'English and French customer labels and feedback.', defaultValue: workspaceCopyDefaults, schema: workspaceCopySchema, consumption: 'active' }),
  entry({ key: 'analytics.demographicsCopy', group: 'Analytics · Customer copy', label: 'Audience history copy', kind: 'json', description: 'English and French audience-history labels and feedback.', defaultValue: demographicsCopyDefaults, schema: demographicsCopySchema, consumption: 'active' }),
  entry({ key: 'analytics.reportsCopy', group: 'Analytics · Customer copy', label: 'Reports copy', kind: 'json', description: 'English and French customer labels and feedback.', defaultValue: reportCopyDefaults, schema: reportCopySchema, consumption: 'active' }),
  entry({ key: 'analytics.goalsCopy', group: 'Analytics · Customer copy', label: 'Goals copy', kind: 'json', description: 'English and French customer labels and feedback.', defaultValue: goalsCopyDefaults, schema: goalsCopySchema, consumption: 'active' }),
  entry({ key: 'analytics.downloadCopy', group: 'Analytics · Customer copy', label: 'Download copy', kind: 'json', description: 'English and French customer labels and feedback.', defaultValue: downloadCopyDefaults, schema: downloadCopySchema, consumption: 'active' }),

  entry({ key: 'analytics.adObjects.pageSize', group: 'Analytics · Ad objects', label: 'Objects per page', kind: 'number', description: 'Stored ad-object summaries per Analytics page.', defaultValue: 25, schema: z.number().int().min(1).max(200), consumption: 'active' }),
  entry({ key: 'analytics.adObjects.maxRows', group: 'Analytics · Ad objects', label: 'Ad-object row limit', kind: 'number', description: 'Complete stored dataset and export row ceiling. Oversized reads are refused.', defaultValue: 10000, schema: z.number().int().min(1).max(100000), consumption: 'active' }),
  entry({ key: 'analytics.adObjects.maxBytes', group: 'Analytics · Ad objects', label: 'Ad-object output bytes', kind: 'number', description: 'Maximum serialized JSON/CSV result size; narrow filters when exceeded.', defaultValue: 2000000, schema: z.number().int().min(1024).max(20000000), consumption: 'active' }),
  entry({ key: 'analytics.postsPageSize', group: 'Analytics · Posts', label: 'Posts per page', kind: 'number', description: 'Published post rows per explorer page.', defaultValue: 25, schema: z.number().int().min(1).max(200), consumption: 'active' }),
  ...DEMOGRAPHICS_CONFIG,
  ...PINNED_METRIC_CONFIG,
  ...COMPARISON_CONFIG,
  ...REPORT_WORKFLOW_CONFIG,
  ...REPORT_UI_CONFIG,
  ...REPORT_HOST_CONFIG,
  ...ANALYTICS_EXPLORER_CONFIG,
  entry({ key: 'analytics.defaultRangeDays', group: 'Analytics metrics', label: 'Default analytics window (days)', kind: 'number', description: 'Default inclusive UTC calendar window; capped by the maximum range.', defaultValue: 30, schema: z.number().int().min(1).max(3650), consumption: 'active' }),
  entry({ key: 'analytics.metricPageSize', group: 'Analytics metrics', label: 'Metrics per page', kind: 'number', description: 'Number of metric summaries shown on one Analytics page.', defaultValue: 12, schema: z.number().int().min(1).max(100), consumption: 'active' }),
  entry({ key: 'analytics.detailPageSize', group: 'Analytics metrics', label: 'Metric detail rows per page', kind: 'number', description: 'Number of dated values or resource/category rows on one detail page.', defaultValue: 50, schema: z.number().int().min(1).max(1000), consumption: 'active' }),
  entry({ key: 'analytics.chartPoints', group: 'Analytics metrics', label: 'Chart preview points', kind: 'number', description: 'Latest dated points shown in metric previews; full series remains available through detail pagination.', defaultValue: 28, schema: z.number().int().min(1).max(3660), consumption: 'active' }),
  entry({ key: 'analytics.searchMaxLength', group: 'Analytics metrics', label: 'Metric search length', kind: 'number', description: 'Maximum characters accepted by Analytics metric search.', defaultValue: 200, schema: z.number().int().min(1).max(2000), consumption: 'active' }),
  entry({ key: 'analytics.maxRangeDays', group: 'Analytics metrics', label: 'Maximum analytics range (days)', kind: 'number', description: 'Largest UTC calendar range accepted by Analytics, CSV and MCP reads.', defaultValue: 366, schema: z.number().int().min(1).max(3650), consumption: 'active' }),
  entry({ key: 'analytics.reportExportRows', group: 'Analytics metrics', label: 'Report CSV row limit', kind: 'number', description: 'Maximum data rows included in a report CSV download; truncated exports are marked.', defaultValue: 5000, schema: z.number().int().min(1).max(100000), consumption: 'active' }),
  entry({ key: 'analytics.reportMaxChannels', group: 'Analytics metrics', label: 'Maximum Analytics resources per selection', kind: 'number', description: 'Maximum selected channels or ad accounts accepted in one Analytics read.', defaultValue: 500, schema: z.number().int().min(1).max(5000), consumption: 'active' }),
  entry({ key: 'sync.analytics.schedule', group: 'Sync schedules', label: 'Analytics sync schedule', kind: 'text', description: 'Five-field cron schedule in the server timezone.', defaultValue: '15 * * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'retention.analyticsDays', group: 'Retention', label: 'Analytics history retention (days)', kind: 'number', description: 'How long imported analytics history is kept.', defaultValue: 730, schema: z.number().int().min(1).max(3650), consumption: 'planned' }),
] as const;
