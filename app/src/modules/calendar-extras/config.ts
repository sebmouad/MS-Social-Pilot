import { z } from 'zod';
import { cron, entry } from '@/lib/config/entry';
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
 feedPath: '/api/calendar-feed/', postsPath: '/content', transactionTimeoutMs: 15000, transactionMaxWaitMs: 5000, requestMaxBytes: 65536,
};
export type Policy = z.infer<typeof policySchema>;

/** Public-data refresh run by the shared worker. Sources, bounds and hosts are Root-managed; nothing is read from code. */
export const refreshSchema = z.object({
 enabled: z.boolean(),
 holidaysUrl: z.string().url().max(500), trendsUrl: z.string().url().max(500),
 hostAllowlist: z.array(z.string().min(1).max(253)).min(1).max(20),
 holidayCountryYearsPerRun: z.number().int().min(1).max(200), holidayRefreshDays: z.number().int().min(1).max(730), holidayYearsAhead: z.number().int().min(0).max(5),
 trendCountriesPerRun: z.number().int().min(1).max(200), trendRefreshMinutes: z.number().int().min(5).max(10080),
 maxHolidaysPerCountryYear: z.number().int().min(1).max(1000), maxTrendsPerCountry: z.number().int().min(1).max(500),
 holidayNameLength: z.number().int().min(1).max(500), trendTitleLength: z.number().int().min(1).max(500), trendTrafficLength: z.number().int().min(1).max(100), trendNewsUrlLength: z.number().int().min(10).max(2000),
 fetchTimeoutMs: z.number().int().min(1000).max(60000), fetchMaxBytes: z.number().int().min(1024).max(10485760), fetchMaxRedirects: z.number().int().min(0).max(5),
 retainedCountries: z.number().int().min(1).max(500),
}).strict();
export const refreshDefaults: z.infer<typeof refreshSchema> = {
 enabled: true, holidaysUrl: 'https://date.nager.at/api/v3/PublicHolidays', trendsUrl: 'https://trends.google.com/trending/rss',
 hostAllowlist: ['date.nager.at', 'trends.google.com'],
 holidayCountryYearsPerRun: 12, holidayRefreshDays: 90, holidayYearsAhead: 1,
 trendCountriesPerRun: 20, trendRefreshMinutes: 180,
 maxHolidaysPerCountryYear: 100, maxTrendsPerCountry: 50,
 holidayNameLength: 200, trendTitleLength: 200, trendTrafficLength: 40, trendNewsUrlLength: 1000,
 fetchTimeoutMs: 15000, fetchMaxBytes: 1048576, fetchMaxRedirects: 2, retainedCountries: 250,
};
export type Refresh = z.infer<typeof refreshSchema>;
export const CALENDAR_EXTRAS_CONFIG = [
 entry({ key: 'calendarExtras.policy', group: 'Calendar extras', label: 'Calendar and subscription policy', description: 'Validated bounds, seasonal choices, note colors, feed window, paths and transaction policy.', kind: 'json', defaultValue: policyDefaults, schema: policySchema, consumption: 'active' }),
 entry({ key: 'calendarExtras.refresh', group: 'Calendar extras', label: 'Holiday and trend refresh', description: 'Switch, public data sources, allowed hosts, batch sizes, refresh ages, size limits and fetch bounds for the background holiday and trend jobs.', kind: 'json', defaultValue: refreshDefaults, schema: refreshSchema, consumption: 'active' }),
 entry({ key: 'calendarExtras.holidaysSchedule', group: 'Calendar extras', label: 'Holiday refresh schedule', description: 'Five-field cron schedule on which the worker fetches missing public holidays for audience countries.', kind: 'text', defaultValue: '17 4 * * *', schema: cron, consumption: 'active' }),
 entry({ key: 'calendarExtras.trendsSchedule', group: 'Calendar extras', label: 'Trend refresh schedule', description: 'Five-field cron schedule on which the worker fetches trending topics for audience countries.', kind: 'text', defaultValue: '7 */3 * * *', schema: cron, consumption: 'active' }),
 entry({ key: 'calendarExtras.customerCopy', group: 'Calendar extras', label: 'Calendar customer copy', description: 'English and French screen labels, feedback and safe service failures.', kind: 'json', defaultValue: copy, schema: copySchema, consumption: 'active' }),
] as const;
