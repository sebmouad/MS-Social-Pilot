import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { ADS_REPORT_DEFAULT_POLICY } from './report-policy';

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
})] as const;
