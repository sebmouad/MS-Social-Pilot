import { alertsCopyDefaults } from './copy';
import { analyticsCopySchema } from '../copy';
import { z } from 'zod';
import { entry, cron } from '@/lib/config/entry';

export const ALERTS_POLICY_DEFAULTS = {
  maxRulesPerWorkspace: 50,
  rulesPageSize: 25,
  firingsPageSize: 25,
  evaluateBatchSize: 100,
  transactionTimeoutMs: 10000,
  transactionMaxWaitMs: 5000,
} as const;
export const ALERTS_POLICY_SCHEMA = z.object({
  maxRulesPerWorkspace: z.number().int().min(1).max(500),
  rulesPageSize: z.number().int().min(5).max(100),
  firingsPageSize: z.number().int().min(5).max(100),
  evaluateBatchSize: z.number().int().min(1).max(500),
  transactionTimeoutMs: z.number().int().min(1000).max(60000),
  transactionMaxWaitMs: z.number().int().min(500).max(30000),
}).strict();

/** Root settings owned by the Analytics module for metric alerts. */
export const ALERTS_CONFIG = [
  entry({ key: 'analytics.alerts.schedule', group: 'Sync schedules', label: 'Metric alert schedule', kind: 'text', description: 'Five-field cron schedule in the server timezone for evaluating metric alert rules on stored data.', defaultValue: '*/10 * * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'analytics.alerts.policy', group: 'Analytics · Metric alerts', label: 'Metric alert bounds', kind: 'json', description: 'Rules per workspace, list page sizes, rules evaluated per worker run and change-transaction bounds.', defaultValue: ALERTS_POLICY_DEFAULTS, schema: ALERTS_POLICY_SCHEMA, consumption: 'active' }),
  entry({ key: 'analytics.alertsCopy', group: 'Analytics · Customer copy', label: 'Metric alert copy', kind: 'json', description: 'English and French customer labels and feedback for metric alerts.', defaultValue: alertsCopyDefaults, schema: analyticsCopySchema(alertsCopyDefaults), consumption: 'active' }),
] as const;
