import { z } from 'zod';
import { entry } from '@/lib/config/entry';
import { copy, copySchema } from './copy';
import { RULES } from './contracts';

export const policySchema = z.object({
 pageSize: z.number().int().min(1).max(500), maxRows: z.number().int().min(1).max(10000), maxTitle: z.number().int().min(1).max(1000),
 maxTargets: z.number().int().min(1).max(5000), maxIdentifier: z.number().int().min(1).max(1000), maxRangeDays: z.number().int().min(1).max(3660),
 defaultRangeDays: z.number().int().min(1).max(366), maxShiftMinutes: z.number().int().min(0).max(1440), maxExtraTimes: z.number().int().min(1).max(100),
 enabledRules: z.array(z.enum(RULES)).min(1), colors: z.array(z.enum(['blue', 'green', 'amber', 'red', 'purple'])).min(1),
 maxKeywords: z.number().int().min(1).max(100), maxKeywordLength: z.number().int().min(1).max(500), trendMaxAgeHours: z.number().int().min(1).max(720),
 feedPastDays: z.number().int().min(0).max(3660), feedAheadDays: z.number().int().min(1).max(3660), feedMaxEvents: z.number().int().min(1).max(10000),
 feedEventMinutes: z.number().int().min(1).max(1440), feedSummaryLength: z.number().int().min(1).max(1000), tokenBytes: z.number().int().min(32).max(128),
 feedStatuses: z.array(z.enum(['scheduled', 'pending_approval', 'published', 'publishing', 'partially_failed', 'failed'])).min(1),
 feedPath: z.string().regex(/^\/api\/[a-z0-9/-]+\/$/), postsPath: z.string().regex(/^\/[a-z0-9/-]+$/),
 transactionTimeoutMs: z.number().int().min(1000).max(60000), transactionMaxWaitMs: z.number().int().min(100).max(30000),
 requestMaxBytes: z.number().int().min(1024).max(1048576),
}).strict().refine(p => p.defaultRangeDays <= p.maxRangeDays && p.pageSize <= p.maxRows);
export const policyDefaults: z.infer<typeof policySchema> = {
 pageSize: 40, maxRows: 2000, maxTitle: 120, maxTargets: 500, maxIdentifier: 200, maxRangeDays: 730, defaultRangeDays: 90,
 maxShiftMinutes: 720, maxExtraTimes: 12, enabledRules: [...RULES], colors: ['blue', 'green', 'amber', 'red', 'purple'],
 maxKeywords: 30, maxKeywordLength: 80, trendMaxAgeHours: 36, feedPastDays: 30, feedAheadDays: 180, feedMaxEvents: 1000,
 feedEventMinutes: 15, feedSummaryLength: 80, tokenBytes: 32, feedStatuses: ['scheduled', 'pending_approval', 'published', 'publishing', 'partially_failed', 'failed'],
 feedPath: '/api/calendar-feed/', postsPath: '/publishing/posts', transactionTimeoutMs: 15000, transactionMaxWaitMs: 5000, requestMaxBytes: 65536,
};
export type Policy = z.infer<typeof policySchema>;
export const CALENDAR_EXTRAS_CONFIG = [
 entry({ key: 'calendarExtras.policy', group: 'Calendar extras', label: 'Calendar and subscription policy', description: 'Validated bounds, seasonal choices, note colors, feed window, paths and transaction policy.', kind: 'json', defaultValue: policyDefaults, schema: policySchema, consumption: 'active' }),
 entry({ key: 'calendarExtras.customerCopy', group: 'Calendar extras', label: 'Calendar customer copy', description: 'English and French screen labels, feedback and safe service failures.', kind: 'json', defaultValue: copy, schema: copySchema, consumption: 'active' }),
] as const;
