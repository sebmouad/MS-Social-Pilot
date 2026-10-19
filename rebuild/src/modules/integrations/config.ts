import { z } from 'zod';
import { cron, entry } from '@/lib/config/entry';

const A = 'Integrations · REST API';
const W = 'Integrations · Outbound webhooks';
const O = 'Integrations · Operations';
const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Maps each Root key to the field it fills in {@link IntegrationsLimits}. */
export const LIMIT_FIELDS: Record<string, keyof IntegrationsLimits> = {};
function num(field: keyof IntegrationsLimits, key: string, group: string, label: string, description: string, defaultValue: number, schema: z.ZodNumber) {
  LIMIT_FIELDS[key] = field;
  return entry({ key, group, label, kind: 'number', description, defaultValue, schema, consumption: 'active' });
}

export type IntegrationsLimits = {
  apiRatePerMinute: number; apiFailedAuthPerMinute: number;
  webhookMaxEndpoints: number; webhookSendTimeoutMs: number; webhookLeaseSeconds: number; webhookBatchSize: number; webhookRetentionDays: number;
  webhookMaxPayloadBytes: number; webhookDeliveriesPageSize: number; webhookEventLookbackMinutes: number; webhookEventScanLimit: number; webhookRevealsPerHour: number;
  transactionTimeoutMs: number; transactionMaxWaitMs: number;
};

/**
 * Root-managed bounds for outbound webhooks and the key-authenticated REST API. Read at use; no policy is hardcoded in services.
 * Every key is consumed by `server/core.ts#runtime()` or by the delivery job.
 */
export const INTEGRATIONS_CONFIG = [
  entry({ key: 'integrations.api.enabled', group: A, label: 'REST API available', kind: 'boolean', description: 'When off, /api/v1 refuses every request. API keys themselves stay as they are.', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
  num('apiRatePerMinute', 'integrations.api.ratePerMinute', A, 'REST requests per minute', 'Requests one API key may make to /api/v1 per minute.', 120, int(1, 100000)),
  num('apiFailedAuthPerMinute', 'integrations.api.failedAuthPerMinute', A, 'Rejected REST credentials per minute', 'Requests with a missing or wrong key one caller address may make per minute before it is throttled.', 30, int(1, 10000)),
  entry({ key: 'integrations.webhooks.enabled', group: W, label: 'Outbound webhooks available', kind: 'boolean', description: 'When off, endpoints cannot be changed, events are not queued and queued deliveries are not sent.', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
  num('webhookMaxEndpoints', 'integrations.webhooks.maxEndpointsPerWorkspace', W, 'Webhook endpoints per workspace', 'Most outbound webhook endpoints one workspace may hold.', 20, int(1, 500)),
  entry({ key: 'integrations.webhooks.retryDelaysSeconds', group: W, label: 'Retry waits (seconds)', kind: 'json', description: 'Waits before attempts 2, 3, ...; the delivery is marked failed after the last one.', defaultValue: [60, 300, 1800, 7200, 43200], schema: z.array(int(1, 604800)).min(1).max(12), consumption: 'active' }),
  num('webhookSendTimeoutMs', 'integrations.webhooks.sendTimeoutMs', W, 'Delivery timeout (ms)', 'How long one delivery may wait for the receiver to answer.', 10000, int(1000, 60000)),
  num('webhookLeaseSeconds', 'integrations.webhooks.leaseSeconds', W, 'Delivery lease (seconds)', 'A delivery being sent is hidden from other runners for this long.', 120, int(10, 3600)),
  num('webhookBatchSize', 'integrations.webhooks.batchSize', W, 'Deliveries per run', 'Most deliveries one runner pass claims.', 50, int(1, 500)),
  num('webhookRetentionDays', 'integrations.webhooks.retentionDays', W, 'Delivery log retention (days)', 'Settled deliveries older than this are removed.', 30, int(1, 365)),
  num('webhookMaxPayloadBytes', 'integrations.webhooks.maxPayloadBytes', W, 'Payload size limit (bytes)', 'Largest event payload that is queued; larger events are dropped.', 65536, int(1024, 1048576)),
  num('webhookDeliveriesPageSize', 'integrations.webhooks.deliveriesPageSize', W, 'Delivery log page size', 'Deliveries listed on one page of the log.', 50, int(5, 200)),
  num('webhookEventLookbackMinutes', 'integrations.webhooks.eventLookbackMinutes', W, 'Event scan window (minutes)', 'Post results younger than this are checked for webhook events on each delivery run. Repeats are ignored, so the window may exceed the run interval.', 180, int(5, 10080)),
  num('webhookEventScanLimit', 'integrations.webhooks.eventScanLimit', W, 'Event scan size', 'Most post results one delivery run turns into events.', 500, int(1, 5000)),
  num('webhookRevealsPerHour', 'integrations.webhooks.revealsPerHour', W, 'Secret reveals per hour', 'Times one person may show webhook signing secrets per hour.', 20, int(1, 1000)),
  entry({ key: 'integrations.webhooks.deliverySchedule', group: W, label: 'Delivery schedule', kind: 'text', description: 'Five-field cron schedule of the shared webhook delivery job.', defaultValue: '* * * * *', schema: cron, consumption: 'active' }),
  entry({ key: 'integrations.webhooks.hostAllowlist', group: W, label: 'Webhook host allowlist', kind: 'json', description: 'When not empty, webhooks may only target these hosts (and their subdomains). Public addresses only either way.', defaultValue: [], schema: z.array(z.string().trim().min(1).max(200)).max(100), consumption: 'active' }),
  num('transactionTimeoutMs', 'integrations.transactionTimeoutMs', O, 'Mutation timeout (ms)', 'Longest one integrations change may run.', 5000, int(500, 30000)),
  num('transactionMaxWaitMs', 'integrations.transactionMaxWaitMs', O, 'Mutation wait (ms)', 'Longest wait for a slot before an integrations change.', 2000, int(100, 10000)),
] as const;

export const INTEGRATIONS_SWITCHES = { api: 'integrations.api.enabled', webhooks: 'integrations.webhooks.enabled' } as const;
