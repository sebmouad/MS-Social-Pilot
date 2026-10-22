import { z } from 'zod';
import { entry } from '@/lib/config/entry';

const A = 'Integrations · REST API keys';
const W = 'Integrations · Outbound webhooks';
const O = 'Integrations · OAuth connectors';
const N = 'Integrations · Notifications';
const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Maps each Root key to the field it fills in {@link IntegrationsLimits}. */
export const LIMIT_FIELDS: Record<string, keyof IntegrationsLimits> = {};
function num(field: keyof IntegrationsLimits, key: string, group: string, label: string, description: string, defaultValue: number, schema: z.ZodNumber, consumption: 'active' | 'planned' = 'active') {
  LIMIT_FIELDS[key] = field;
  return entry({ key, group, label, kind: 'number', description, defaultValue, schema, consumption });
}

export type IntegrationsLimits = {
  apiMaxTokens: number; apiDefaultExpiryDays: number; apiMaxExpiryDays: number; apiLastUsedIntervalSeconds: number; apiV1MaxPageSize: number; apiV1RatePerMinute: number;
  webhookMaxEndpoints: number; webhookSendTimeoutMs: number; webhookLeaseSeconds: number; webhookBatchSize: number; webhookRetentionDays: number; webhookMaxPayloadBytes: number; webhookDeliveriesPageSize: number;
  oauthCodeTtlSeconds: number; oauthMaxClients: number; oauthMaxRedirectUris: number; oauthRegistrationsPerHour: number;
  notificationMaxMutes: number;
  transactionTimeoutMs: number; transactionMaxWaitMs: number;
};
/** Waits before attempts 2..n, in seconds. The delivery gives up after the last wait has been used. */
export type WebhookRetrySchedule = readonly number[];

/** Root-managed bounds for API keys, webhooks, OAuth connectors and notification preferences. Read at use; no policy is hardcoded in services. */
export const INTEGRATIONS_CONFIG = [
  num('apiMaxTokens', 'integrations.api.maxTokensPerWorkspace', A, 'API keys per workspace', 'Most active REST API keys one workspace may hold.', 50, int(1, 1000)),
  num('apiDefaultExpiryDays', 'integrations.api.defaultExpiryDays', A, 'Default key lifetime (days)', 'Lifetime of a new API key when the creator does not choose one.', 90, int(1, 730)),
  num('apiMaxExpiryDays', 'integrations.api.maxExpiryDays', A, 'Maximum key lifetime (days)', 'Longest lifetime an API key (including connector keys) may be given.', 365, int(1, 1095)),
  num('apiLastUsedIntervalSeconds', 'integrations.api.lastUsedIntervalSeconds', A, 'Last-used update interval (seconds)', 'A key records its last use at most this often.', 60, int(1, 86400)),
  num('apiV1MaxPageSize', 'integrations.api.v1MaxPageSize', A, 'REST list size limit', 'Most items one REST list call returns. Planned: no paged v1 list endpoint exists yet (webhooks and identity are unpaged).', 100, int(1, 500), 'planned'),
  num('apiV1RatePerMinute', 'integrations.api.v1RatePerMinute', A, 'REST requests per minute', 'Requests one API key may make per minute.', 120, int(1, 100000)),
  entry({ key: 'integrations.api.allowNonExpiringLegacyKeys', group: A, label: 'Accept legacy keys without expiry', kind: 'boolean', description: 'Migrated keys created before expiry existed keep working while this is on. New keys always expire.', defaultValue: false, schema: z.boolean(), consumption: 'active' }),
  num('webhookMaxEndpoints', 'integrations.webhooks.maxEndpointsPerWorkspace', W, 'Webhook endpoints per workspace', 'Most outbound webhook endpoints one workspace may hold.', 20, int(1, 500)),
  entry({ key: 'integrations.webhooks.retryDelaysSeconds', group: W, label: 'Retry waits (seconds)', kind: 'json', description: 'Waits before attempts 2, 3, ...; the delivery is marked failed after the last one.', defaultValue: [60, 300, 1800, 7200, 43200], schema: z.array(int(1, 604800)).min(1).max(12), consumption: 'active' }),
  num('webhookSendTimeoutMs', 'integrations.webhooks.sendTimeoutMs', W, 'Delivery timeout (ms)', 'How long one delivery may wait for the receiver to answer.', 10000, int(1000, 60000)),
  num('webhookLeaseSeconds', 'integrations.webhooks.leaseSeconds', W, 'Delivery lease (seconds)', 'A delivery being sent is hidden from other runners for this long.', 120, int(10, 3600)),
  num('webhookBatchSize', 'integrations.webhooks.batchSize', W, 'Deliveries per run', 'Most deliveries one runner pass claims.', 50, int(1, 500)),
  num('webhookRetentionDays', 'integrations.webhooks.retentionDays', W, 'Delivery log retention (days)', 'Settled deliveries older than this are removed.', 30, int(1, 365)),
  num('webhookMaxPayloadBytes', 'integrations.webhooks.maxPayloadBytes', W, 'Payload size limit (bytes)', 'Largest event payload that is queued; larger events are dropped and counted.', 65536, int(1024, 1048576)),
  num('webhookDeliveriesPageSize', 'integrations.webhooks.deliveriesPageSize', W, 'Delivery log page size', 'Deliveries listed on one page of the log.', 50, int(5, 200)),
  num('oauthCodeTtlSeconds', 'integrations.oauth.codeTtlSeconds', O, 'Authorization code lifetime (seconds)', 'How long a consent code can be swapped for a key.', 300, int(30, 900)),
  num('oauthMaxClients', 'integrations.oauth.maxClients', O, 'Registered connectors', 'Most connector clients the installation stores; further registration is refused.', 500, int(1, 100000)),
  num('oauthMaxRedirectUris', 'integrations.oauth.maxRedirectUris', O, 'Redirect addresses per connector', 'Most redirect addresses one connector may register.', 10, int(1, 50)),
  num('oauthRegistrationsPerHour', 'integrations.oauth.registrationsPerHour', O, 'Registrations per hour', 'Connector registrations accepted per caller address per hour.', 20, int(1, 10000)),
  num('notificationMaxMutes', 'integrations.notifications.maxMutes', N, 'Muted channel limit', 'Most per-channel mutes one person may store.', 5000, int(0, 50000)),
  num('transactionTimeoutMs', 'integrations.transactionTimeoutMs', 'Integrations · Operations', 'Mutation timeout (ms)', 'Longest one integrations change may run.', 5000, int(500, 30000)),
  num('transactionMaxWaitMs', 'integrations.transactionMaxWaitMs', 'Integrations · Operations', 'Mutation wait (ms)', 'Longest wait for a slot before an integrations change.', 2000, int(100, 10000)),
  entry({ key: 'integrations.api.enabled', group: A, label: 'REST API keys available', kind: 'boolean', description: 'When off, new keys cannot be made and existing keys stop authenticating (they are not revoked).', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'integrations.webhooks.enabled', group: W, label: 'Outbound webhooks available', kind: 'boolean', description: 'When off, endpoints cannot be changed, events are not queued and queued deliveries are not sent.', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'integrations.oauth.enabled', group: O, label: 'OAuth connectors available', kind: 'boolean', description: 'When off, connectors cannot register, ask for consent or swap codes.', defaultValue: true, schema: z.boolean(), consumption: 'active' }),
  entry({ key: 'integrations.webhooks.hostAllowlist', group: W, label: 'Webhook host allowlist', kind: 'json', description: 'When not empty, webhooks may only target these hosts (and their subdomains). Public addresses only either way.', defaultValue: [], schema: z.array(z.string().trim().min(1).max(200)).max(100), consumption: 'active' }),
] as const;

export const INTEGRATIONS_SWITCHES = { api: 'integrations.api.enabled', webhooks: 'integrations.webhooks.enabled', oauth: 'integrations.oauth.enabled' } as const;
