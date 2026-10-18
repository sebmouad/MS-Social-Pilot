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
    note_mention: { title: 'You were mentioned in a post note', body: 'A teammate mentioned you in an internal post note.' },
    mix_dry: { title: 'A content mix needs attention', body: 'A selected channel has no eligible posts for its content mix.' },
    unavailable: { title: 'Related item unavailable', body: 'This alert is still in your inbox, but its related item is no longer available.' },
  },
} as const;

const eventCopySchema = z.object({
  note_mention: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500) }).strict(),
  mix_dry: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500) }).strict(),
  unavailable: z.object({ title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(500) }).strict(),
}).strict();
const preferenceDefaultsSchema = z.object({ onNoteMention: z.boolean(), onQueueEmpty: z.boolean() }).strict();
const number = (min: number, max: number) => z.number().int().min(min).max(max);

export const NOTIFICATIONS_CONFIG = [
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
