import { z } from 'zod';
import { entry, cron } from '@/lib/config/entry';

export const ROLLUPS_POLICY_DEFAULTS = {
  /** Recent days recomputed by every run so late-arriving syncs are absorbed. */
  dailyLookbackDays: 7,
  /** Oldest span backfilled for a channel with no rollups yet, per run. */
  backfillDays: 400,
  /** Ranges longer than this render weekly points from the weekly rollups. */
  weeklyThresholdDays: 120,
  /** Most channels precomputed per workspace in one run; uncovered channels fall back to detailed reads. */
  batchTargets: 200,
  /** How long worker coverage records are kept for the read preference. */
  runHistoryDays: 90,
  transactionTimeoutMs: 10000,
  transactionMaxWaitMs: 5000,
} as const;
export const ROLLUPS_POLICY_SCHEMA = z.object({
  dailyLookbackDays: z.number().int().min(1).max(90),
  backfillDays: z.number().int().min(31).max(3650),
  weeklyThresholdDays: z.number().int().min(31).max(3650),
  batchTargets: z.number().int().min(1).max(2000),
  runHistoryDays: z.number().int().min(7).max(3650),
  transactionTimeoutMs: z.number().int().min(1000).max(60000),
  transactionMaxWaitMs: z.number().int().min(500).max(30000),
}).strict();
export type RollupsPolicy = z.infer<typeof ROLLUPS_POLICY_SCHEMA>;

/** Root settings owned by the Analytics module for precomputed rollups. */
export const ROLLUPS_CONFIG = [
  entry({ key: 'analytics.rollups.schedule', group: 'Sync schedules', label: 'Analytics rollup schedule', kind: 'text', description: 'Five-field cron schedule in the server timezone for precomputing daily and weekly channel rollups from stored insights. No provider request is made.', defaultValue: '30 1 * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'analytics.rollups.policy', group: 'Analytics metrics', label: 'Rollup precomputation policy', kind: 'json', description: 'Lookback window recomputed by every run, cold-channel backfill span, range length that switches reads to weekly points, per-workspace channel batch, coverage-record retention and change-transaction bounds.', defaultValue: ROLLUPS_POLICY_DEFAULTS, schema: ROLLUPS_POLICY_SCHEMA, consumption: 'active' }),
] as const;
