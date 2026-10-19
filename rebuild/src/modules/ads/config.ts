import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { ADS_REPORT_DEFAULT_POLICY } from './report-policy';
import { ADS_READ_DEFAULT_POLICY, ADS_READ_MAX_ROWS_SCHEMA, ADS_READ_PAGE_SIZE_SCHEMA } from './read-policy';
import { ADS_ANALYSIS_CONFIG } from './analysis/config';
import { ADS_MANAGEMENT_CONFIG } from './management/config';
import { ADS_DETAIL_MAX_BYTES_SCHEMA, ADS_OUTPUT_DEFAULT_POLICY, ADS_EXPORT_FILE_NAME_SCHEMA, ADS_EXPORT_MAX_BYTES_SCHEMA } from './output-policy';

const preset = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/).refine(value => value !== 'custom', 'The custom range id is reserved.'),
  days: z.number().int().positive().max(3650),
  label: z.string().superRefine((value, context) => {
    if (/[\u0000-\u001f\u007f]/.test(value)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Labels cannot contain control characters.' });
  }).transform(value => value.trim()).pipe(z.string().min(1).max(80)),
}).strict();

// These catalog/count/id caps are code-owned integrity bounds on Root-authored data.
export const ADS_REPORT_POLICY_SCHEMA = z.object({
  presets: z.array(preset).min(1).max(12),
  defaultPreset: z.string(),
  maxRangeDays: z.number().int().min(1).max(3650),
  maxFilterCharacters: z.number().int().min(10).max(2048),
}).strict().superRefine((policy, context) => {
  const ids = policy.presets.map(item => item.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['presets'], message: 'Preset ids must be unique.' });
  if (!ids.includes(policy.defaultPreset)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['defaultPreset'], message: 'Default preset must be in the preset list.' });
  if (policy.presets.some(item => item.days > policy.maxRangeDays)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['maxRangeDays'], message: 'Every preset must fit the maximum report range.' });
  if (policy.presets.some(item => item.id.length > policy.maxFilterCharacters)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['presets'], message: 'Preset ids must fit the filter character limit.' });
});

export const ADS_CONFIG = [entry({
  key: 'ads.reportingFilters', group: 'Ads · Reporting', label: 'Report filters', kind: 'json',
  description: 'Configure the available report date presets, default range and maximum filter bounds.',
  defaultValue: ADS_REPORT_DEFAULT_POLICY, schema: ADS_REPORT_POLICY_SCHEMA, consumption: 'active',
}), entry({
  key: 'ads.reportPageSize', group: 'Ads · Reporting', label: 'Report page size', kind: 'number',
  description: 'Default number of Ads report results per page.',
  defaultValue: ADS_READ_DEFAULT_POLICY.pageSize, schema: ADS_READ_PAGE_SIZE_SCHEMA, consumption: 'active',
}), entry({
  key: 'ads.reportMaxRows', group: 'Ads · Reporting', label: 'Maximum report rows', kind: 'number',
  description: 'Maximum stored insight rows loaded by one Ads report request.',
  defaultValue: ADS_READ_DEFAULT_POLICY.maxRows, schema: ADS_READ_MAX_ROWS_SCHEMA, consumption: 'active',
}), entry({
  key: 'ads.detailMaxBytes', group: 'Ads · Reporting', label: 'Maximum detail response bytes', kind: 'number',
  description: 'Maximum UTF-8 size of one complete Ads daily report response.',
  defaultValue: ADS_OUTPUT_DEFAULT_POLICY.detailMaxBytes, schema: ADS_DETAIL_MAX_BYTES_SCHEMA, consumption: 'active',
}), entry({
  key: 'ads.exportMaxBytes', group: 'Ads · Reporting', label: 'Maximum CSV export bytes', kind: 'number',
  description: 'Maximum UTF-8 size of one complete Ads CSV export.',
  defaultValue: ADS_OUTPUT_DEFAULT_POLICY.exportMaxBytes, schema: ADS_EXPORT_MAX_BYTES_SCHEMA, consumption: 'active',
}), entry({
  key: 'ads.exportFileName', group: 'Ads · Reporting', label: 'CSV export filename', kind: 'text',
  description: 'Safe filename used for complete Ads CSV report downloads.',
  defaultValue: ADS_OUTPUT_DEFAULT_POLICY.exportFileName, schema: ADS_EXPORT_FILE_NAME_SCHEMA, consumption: 'active',
})] as const;

/** Every Root setting this product module declares. The registry merges installed modules; edit only here. */
export const ADS_MODULE_CONFIG = [
  ...ADS_CONFIG,
  ...ADS_ANALYSIS_CONFIG,
  ...ADS_MANAGEMENT_CONFIG,
  entry({ key: 'ads.managementEnabled', group: 'Ads controls', label: 'Ads management enabled', kind: 'boolean', description: 'Allow authorized workspace owners and admins to use supported advertising management operations. Platform grants, account scope and confirmations are still required.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
] as const;
