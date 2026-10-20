import { z } from 'zod';
import { cron, entry } from '@/lib/config/entry';

export const NOTIFICATIONS_DEFAULTS = {
  pageSize: 25,
  deliveryBatchSize: 50,
  maxAttempts: 4,
  retryDelaySeconds: 60,
  claimLeaseSeconds: 120,
  transactionTimeoutMs: 5000,
  transactionMaxWaitMs: 1500,
  deliveryOperationTimeoutMs: 55000,
  deliveryOperationMaxWaitMs: 2000,
  deliverySchedule: '*/1 * * * *',
  maxMutes: 500,
  maxRecipientsPerEvent: 200,
  maxPreferenceChannels: 1000,
  retentionDays: 365,
  preferenceDefaults: { onNoteMention: true, onQueueEmpty: true },
  eventCopy: {
    publish_failure: { title: 'Publication failed', body: 'A publication needs your attention.', frTitle: 'Échec de publication', frBody: 'Une publication nécessite votre attention.' },
    connection_expired: { title: 'Reconnect a connection', body: 'A workspace connection needs to be reconnected.', frTitle: 'Reconnecter une connexion', frBody: 'Une connexion de cet espace doit être rétablie.' },
    token_expiring: { title: 'Connection approaching expiry', body: 'Renew a workspace connection before it expires.', frTitle: 'Connexion bientôt expirée', frBody: 'Renouvelez une connexion avant son expiration.' },
    approval_request: { title: 'Post awaiting approval', body: 'A post is ready for review.', frTitle: 'Publication à valider', frBody: 'Une publication est prête à être examinée.' },
    approval_decision: { title: 'A decision on your post', body: 'Review the approval decision on your post.', frTitle: 'Décision sur votre publication', frBody: 'Consultez la décision de validation de votre publication.' },
    inbox_digest: { title: 'New inbox activity', body: 'Review new activity in your inbox.', frTitle: 'Activité dans la boîte de réception', frBody: 'Consultez les nouvelles activités dans votre boîte de réception.' },
    queue_empty: { title: 'Your queue is empty', body: 'Add content to keep this channel active.', frTitle: 'Votre file est vide', frBody: 'Ajoutez du contenu pour garder ce canal actif.' },
    draft_updated: { title: 'Your draft changed', body: 'A teammate updated your unpublished post.', frTitle: 'Votre brouillon a changé', frBody: 'Un collègue a modifié votre publication non publiée.' },
    moderation_alert: { title: 'Moderation needs attention', body: 'Review a moderation match in your inbox.', frTitle: 'Modération à examiner', frBody: 'Consultez une correspondance de modération dans votre boîte de réception.' },
    negative_spike: { title: 'Negative comment activity', body: 'Review increased negative activity in your inbox.', frTitle: 'Hausse des commentaires négatifs', frBody: 'Consultez la hausse des activités négatives dans votre boîte de réception.' },
    note_mention: { title: 'You were mentioned in a post note', body: 'A teammate mentioned you in an internal post note.' },
    mix_dry: { title: 'A content mix needs attention', body: 'A selected channel has no eligible posts for its content mix.' },
    unavailable: { title: 'Related item unavailable', body: 'This alert is still in your inbox, but its related item is no longer available.' },
  },
} as const;

const eventCopySchema = z.object({
  publish_failure: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), frTitle: z.string().trim().min(1).max(120), frBody: z.string().trim().min(1).max(500) }).strict().default(NOTIFICATIONS_DEFAULTS.eventCopy.publish_failure),
  connection_expired: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), frTitle: z.string().trim().min(1).max(120), frBody: z.string().trim().min(1).max(500) }).strict().default(NOTIFICATIONS_DEFAULTS.eventCopy.connection_expired),
  token_expiring: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), frTitle: z.string().trim().min(1).max(120), frBody: z.string().trim().min(1).max(500) }).strict().default(NOTIFICATIONS_DEFAULTS.eventCopy.token_expiring),
  approval_request: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), frTitle: z.string().trim().min(1).max(120), frBody: z.string().trim().min(1).max(500) }).strict().default(NOTIFICATIONS_DEFAULTS.eventCopy.approval_request),
  approval_decision: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), frTitle: z.string().trim().min(1).max(120), frBody: z.string().trim().min(1).max(500) }).strict().default(NOTIFICATIONS_DEFAULTS.eventCopy.approval_decision),
  inbox_digest: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), frTitle: z.string().trim().min(1).max(120), frBody: z.string().trim().min(1).max(500) }).strict().default(NOTIFICATIONS_DEFAULTS.eventCopy.inbox_digest),
  queue_empty: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), frTitle: z.string().trim().min(1).max(120), frBody: z.string().trim().min(1).max(500) }).strict().default(NOTIFICATIONS_DEFAULTS.eventCopy.queue_empty),
  draft_updated: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), frTitle: z.string().trim().min(1).max(120), frBody: z.string().trim().min(1).max(500) }).strict().default(NOTIFICATIONS_DEFAULTS.eventCopy.draft_updated),
  moderation_alert: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), frTitle: z.string().trim().min(1).max(120), frBody: z.string().trim().min(1).max(500) }).strict().default(NOTIFICATIONS_DEFAULTS.eventCopy.moderation_alert),
  negative_spike: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500), frTitle: z.string().trim().min(1).max(120), frBody: z.string().trim().min(1).max(500) }).strict().default(NOTIFICATIONS_DEFAULTS.eventCopy.negative_spike),
  note_mention: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500) }).strict(),
  mix_dry: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500) }).strict(),
  unavailable: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500) }).strict(),
}).strict();
const preferenceDefaultsSchema = z.object({ onNoteMention: z.boolean(), onQueueEmpty: z.boolean() }).strict();
const number = (min: number, max: number) => z.number().int().min(min).max(max);

export const NOTIFICATIONS_CONFIG = [
  entry({ key: 'notifications.connectionWarningDays', group: 'Settings · Notifications', label: 'Connection expiry warning (days)', kind: 'number', description: 'Warn connection administrators before recorded credential expiry.', defaultValue: 7, schema: number(1, 90), consumption: 'active' }),
  entry({ key: 'notifications.connectionScanBatch', group: 'Settings · Notifications', label: 'Connection alert scan batch', kind: 'number', description: 'Maximum accounts inspected per rotating durable scan.', defaultValue: 100, schema: number(1, 1000), consumption: 'active' }),
  entry({ key: 'notifications.pageSize', group: 'Settings · Notifications', label: 'Notification page size', kind: 'number', description: 'Maximum in-app notifications returned on one page.', defaultValue: NOTIFICATIONS_DEFAULTS.pageSize, schema: number(5, 100), consumption: 'active' }),
  entry({ key: 'notifications.deliveryBatchSize', group: 'Settings · Notifications', label: 'Notification delivery batch size', kind: 'number', description: 'Maximum due notification emails claimed in one worker run.', defaultValue: NOTIFICATIONS_DEFAULTS.deliveryBatchSize, schema: number(1, 500), consumption: 'active' }),
  entry({ key: 'notifications.maxAttempts', group: 'Settings · Notifications', label: 'Notification email attempts', kind: 'number', description: 'Maximum bounded retry count for errors confirmed before SMTP delivery starts.', defaultValue: NOTIFICATIONS_DEFAULTS.maxAttempts, schema: number(1, 10), consumption: 'active' }),
  entry({ key: 'notifications.retryDelaySeconds', group: 'Settings · Notifications', label: 'Notification email retry delay', kind: 'number', description: 'Delay before retrying a failure known to have occurred before SMTP I/O.', defaultValue: NOTIFICATIONS_DEFAULTS.retryDelaySeconds, schema: number(5, 3600), consumption: 'active' }),
  entry({ key: 'notifications.claimLeaseSeconds', group: 'Settings · Notifications', label: 'Notification email claim lease', kind: 'number', description: 'Maximum time an SMTP delivery claim may remain active before it is made uncertain and held.', defaultValue: NOTIFICATIONS_DEFAULTS.claimLeaseSeconds, schema: number(10, 900), consumption: 'active' }),
  entry({ key: 'notifications.transactionTimeoutMs', group: 'Settings · Notifications', label: 'Notification transaction timeout', kind: 'number', description: 'Maximum duration of one notification persistence transaction.', defaultValue: NOTIFICATIONS_DEFAULTS.transactionTimeoutMs, schema: number(500, 30000), consumption: 'active' }),
  entry({ key: 'notifications.transactionMaxWaitMs', group: 'Settings · Notifications', label: 'Notification transaction lock wait', kind: 'number', description: 'Maximum wait for a notification persistence transaction.', defaultValue: NOTIFICATIONS_DEFAULTS.transactionMaxWaitMs, schema: number(100, 10000), consumption: 'active' }),
  entry({ key: 'notifications.deliveryOperationTimeoutMs', group: 'Settings · Notifications', label: 'Notification email operation timeout', kind: 'number', description: 'Maximum transaction time while rechecking authority, sending one notification email and recording its outcome; must cover configured mail connection and socket timeouts.', defaultValue: NOTIFICATIONS_DEFAULTS.deliveryOperationTimeoutMs, schema: number(1000, 300000), consumption: 'active' }),
  entry({ key: 'notifications.deliveryOperationMaxWaitMs', group: 'Settings · Notifications', label: 'Notification email lock wait', kind: 'number', description: 'Maximum wait to start a notification email operation transaction.', defaultValue: NOTIFICATIONS_DEFAULTS.deliveryOperationMaxWaitMs, schema: number(100, 30000), consumption: 'active' }),
  entry({ key: 'notifications.maxMutes', group: 'Settings · Notifications', label: 'Muted channel limit', kind: 'number', description: 'Maximum selected channels a member can mute for empty queue alerts.', defaultValue: NOTIFICATIONS_DEFAULTS.maxMutes, schema: number(1, 5000), consumption: 'active' }),
  entry({ key: 'notifications.maxRecipientsPerEvent', group: 'Settings · Notifications', label: 'Recipients per notification event', kind: 'number', description: 'Maximum active workspace recipients considered for one event; oversized recipient sets are refused.', defaultValue: NOTIFICATIONS_DEFAULTS.maxRecipientsPerEvent, schema: number(1, 5000), consumption: 'active' }),
  entry({ key: 'notifications.maxPreferenceChannels', group: 'Settings · Notifications', label: 'Notification preference channel directory', kind: 'number', description: 'Maximum selected channels loaded for personal notification preferences. Larger directories are refused rather than shown partially.', defaultValue: NOTIFICATIONS_DEFAULTS.maxPreferenceChannels, schema: number(1, 10000), consumption: 'active' }),
  entry({ key: 'notifications.retentionDays', group: 'Settings · Notifications', label: 'Settled notification retention', kind: 'number', description: 'Days to retain settled notification rows. Pending, sending and uncertain email outcomes are never automatically purged.', defaultValue: NOTIFICATIONS_DEFAULTS.retentionDays, schema: number(1, 3650), consumption: 'active' }),
  entry({ key: 'notifications.preferenceDefaults', group: 'Settings · Notifications', label: 'Default event email preferences', kind: 'json', description: 'Defaults for existing notification_settings event switches when a member has no saved workspace preferences.', defaultValue: NOTIFICATIONS_DEFAULTS.preferenceDefaults, schema: preferenceDefaultsSchema, consumption: 'active' }),
  entry({ key: 'notifications.deliverySchedule', group: 'Settings · Notifications', label: 'Notification delivery schedule', kind: 'text', description: 'Five-field cron schedule for the shared notification delivery job.', defaultValue: NOTIFICATIONS_DEFAULTS.deliverySchedule, schema: cron, consumption: 'active' }),
  entry({ key: 'notifications.eventCopy', group: 'Settings · Notifications', label: 'Notification event copy', kind: 'json', description: 'Safe title and body shown for supported in-app events and emails. Post and note content is never inserted.', defaultValue: NOTIFICATIONS_DEFAULTS.eventCopy, schema: eventCopySchema, consumption: 'active' }),
] as const;

export type NotificationBounds = {
  pageSize: number; deliveryBatchSize: number; maxAttempts: number; retryDelaySeconds: number;
  claimLeaseSeconds: number; transactionTimeoutMs: number; transactionMaxWaitMs: number;
  deliveryOperationTimeoutMs: number; deliveryOperationMaxWaitMs: number;
  maxMutes: number; maxRecipientsPerEvent: number; maxPreferenceChannels: number; retentionDays: number;
  preferenceDefaults: z.infer<typeof preferenceDefaultsSchema>;
};
export type NotificationEventCopy = z.infer<typeof eventCopySchema>;
