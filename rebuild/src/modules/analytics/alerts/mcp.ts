import { OperationError } from '@/lib/operation-error';
import { ALERT_METRICS, ALERT_OPERATORS } from './contracts';
import { listMetricAlertFirings, listMetricAlertRules, manageMetricAlertRule, type AlertActor } from './server/rules';

const id = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,200}$' };
const page = { type: 'object', properties: { page: { type: 'integer', minimum: 1 }, channelId: id, includeResolved: { type: 'boolean' } }, additionalProperties: false };
export const analyticsAlertToolDefinitions = [
  { name: 'list_metric_alerts', description: 'List metric alert rules within your channel scope, with their firing state and latest measured value, plus recent firings when asked. Measurements are stored data, never live provider reads.', inputSchema: page },
  { name: 'manage_metric_alert', description: 'Create, update, pause (enabled=false) or delete a metric alert rule on one channel you manage. Metrics: followers, views, engagements, posts; windows: 7 or 30 trailing days. A firing opens in the notification center while the stored value crosses the threshold. Confirmations: CREATE METRIC ALERT <channelId> <metric>, UPDATE METRIC ALERT <id>, DELETE METRIC ALERT <id>. Owners, admins and editors only.', inputSchema: { type: 'object', required: ['action', 'confirmation'], properties: { action: { type: 'string', enum: ['create', 'update', 'delete'] }, id, channelId: id, name: { type: 'string' }, metric: { type: 'string', enum: [...ALERT_METRICS] }, operator: { type: 'string', enum: [...ALERT_OPERATORS] }, threshold: { type: 'number' }, windowDays: { type: 'integer', enum: [7, 30] }, enabled: { type: 'boolean' }, confirmation: { type: 'string' } }, additionalProperties: false } },
] as const;
export async function executeAnalyticsAlertTool(actor: AlertActor, name: string, args: Record<string, unknown>) {
  if (name === 'list_metric_alerts') {
    const [rules, firings] = await Promise.all([listMetricAlertRules(actor, args), listMetricAlertFirings(actor, args)]);
    return { ...rules, firings: firings.firings, firingsHasMore: firings.hasMore };
  }
  if (name === 'manage_metric_alert') return manageMetricAlertRule(actor, args);
  throw new OperationError('invalid_request', 'Unknown metric alert action.');
}
