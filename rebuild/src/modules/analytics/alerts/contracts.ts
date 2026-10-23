import { z } from 'zod';

/**
 * Metric alert rules (Analytics-owned). A rule watches one stored channel
 * metric over a trailing window and fires while the measured value crosses
 * the threshold. Evaluation reads stored data only through the channel
 * module's neutral measures (the same goalMeasures/posts reads as Goals)
 * and never contacts a provider.
 */
export const ALERT_METRICS = ['followers', 'views', 'engagements', 'posts'] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];
export const ALERT_OPERATORS = ['above', 'below'] as const;
export type AlertOperator = (typeof ALERT_OPERATORS)[number];
export const ALERT_WINDOWS = [7, 30] as const;
export type AlertWindowDays = (typeof ALERT_WINDOWS)[number];
export const ALERT_NAME_MAX = 80;
export const ALERT_THRESHOLD_MAX = 1_000_000_000;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const alertListSchema = z.object({ page: z.number().int().min(1).max(10000).optional(), channelId: id.optional(), includeResolved: z.boolean().optional() }).strict();
export const alertRuleActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    channelId: id,
    name: z.string().trim().min(1).max(ALERT_NAME_MAX),
    metric: z.enum(ALERT_METRICS),
    operator: z.enum(ALERT_OPERATORS),
    threshold: z.number().min(0).max(ALERT_THRESHOLD_MAX),
    windowDays: z.union([z.literal(7), z.literal(30)]),
    enabled: z.boolean().optional(),
    confirmation: z.string().max(500),
  }).strict(),
  z.object({
    action: z.literal('update'),
    id,
    name: z.string().trim().min(1).max(ALERT_NAME_MAX),
    metric: z.enum(ALERT_METRICS),
    operator: z.enum(ALERT_OPERATORS),
    threshold: z.number().min(0).max(ALERT_THRESHOLD_MAX),
    windowDays: z.union([z.literal(7), z.literal(30)]),
    enabled: z.boolean(),
    confirmation: z.string().max(500),
  }).strict(),
  z.object({ action: z.literal('delete'), id, confirmation: z.string().max(500) }).strict(),
]);
export type AlertRuleAction = z.infer<typeof alertRuleActionSchema>;

export const alertConfirmation = {
  createRule: (channelId: string, metric: string) => `CREATE METRIC ALERT ${channelId} ${metric}`,
  updateRule: (id: string) => `UPDATE METRIC ALERT ${id}`,
  deleteRule: (id: string) => `DELETE METRIC ALERT ${id}`,
} as const;

export type MetricAlertRuleView = {
  id: string; channelId: string; channelName: string | null; channelAvailable: boolean;
  name: string; metric: AlertMetric; operator: AlertOperator; threshold: number;
  windowDays: AlertWindowDays; enabled: boolean;
  state: 'firing' | 'ok' | 'unknown';
  lastActual: number | null; lastEvaluatedAt: Date | null;
  createdAt: Date; updatedAt: Date;
};
export type MetricAlertFiringView = {
  id: string; ruleId: string; ruleName: string; channelId: string; channelName: string | null;
  metric: AlertMetric; operator: AlertOperator; threshold: number;
  actual: number; periodStart: Date; periodEnd: Date;
  state: 'fired' | 'resolved'; firedAt: Date; resolvedAt: Date | null;
};
