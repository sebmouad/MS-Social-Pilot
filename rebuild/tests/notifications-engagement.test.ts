import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ config: {} as Record<string, unknown>, preferences: { onMetricAlert: true, onReportDelivered: true, onTriageAssigned: true }, reportScope: null as readonly string[] | null, inboxChannels: ['channel-a'] as string[] }));
const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(), user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() } }));
const access = vi.hoisted(() => ({ report: vi.fn(), inbox: vi.fn() }));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'data.workspaceOperationTimeoutMs' ? 120000 : key === 'mail.connectionTimeoutMs' ? 10000 : key === 'mail.socketTimeoutMs' ? 20000 : state.config[key] }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: async (_userId: string, workspaceId: string) => ({ workspaceId }), canUseFeature: () => true, hasPlatformCapability: () => true }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({ pageScope: { all: true, ids: [] } }) }));
vi.mock('@/modules/analytics/reports/server/access', () => ({ authorizeReport: access.report }));
vi.mock('@/modules/inbox/server/access', () => ({ authorizeInbox: access.inbox }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, run: () => Promise<unknown>) => run(), assertWorkspaceNotPurging: async () => undefined }));
vi.mock('@/modules/publishing/server/read-scope', () => ({ selectedPublishingTargetIds: async () => [], publishingPostVisibilityWhere: () => ({}) }));

import { NOTIFICATIONS_CONFIG, NOTIFICATIONS_DEFAULTS } from '../src/modules/settings/notifications/config';
import { ADDITIONAL_NOTIFICATION_PREFERENCES, notificationPreferenceLabels } from '../src/modules/settings/notifications/catalog';
import { notificationEnqueueSchema, notificationPreferenceUpdateSchema } from '../src/modules/settings/notifications/contracts';
import { enqueueNotification, notificationPreferenceKey, notificationRecipientEligible, readNotificationPreferences, updateNotificationPreferences } from '../src/modules/settings/notifications/server';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { config: Object.fromEntries(NOTIFICATIONS_CONFIG.map(item => [item.key, item.defaultValue])), preferences: { onMetricAlert: true, onReportDelivered: true, onTriageAssigned: true }, reportScope: null, inboxChannels: ['channel-a'] });
  db.user.findUnique.mockResolvedValue({ disabledAt: null });
  db.membership.findUnique.mockResolvedValue({ role: 'owner' });
  access.report.mockImplementation(async () => ({ role: 'owner', scope: state.reportScope, providers: ['facebook'], canManage: true, maxItems: undefined }));
  access.inbox.mockImplementation(async () => ({ channels: [], channelIds: state.inboxChannels, timeZone: 'UTC' }));
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('SELECT to_jsonb(ns)')) return [{ preferences: state.preferences, muted: false }];
    if (sql.includes('SELECT "onNoteMention"')) return [{ onNoteMention: true, onQueueEmpty: true }];
    if (sql.includes('FROM notification_settings WHERE')) return [{ ...state.preferences, onPublishFailure: true, onTokenExpiry: true, onApprovalRequest: true, onApprovalDecision: true, onNewInbox: true, onDraftUpdated: true, onModerationAlert: true }];
    if (sql.includes('FROM users WHERE')) return [{ locale: 'en' }];
    if (sql.includes('FROM memberships m JOIN users u')) return [{ role: 'owner', disabledAt: null }];
    return [];
  });
  db.$executeRaw.mockResolvedValue(1);
});

describe('engagement notification events', () => {
  it('requires a channel for metric, report and triage events', async () => {
    for (const kind of ['metric_alert', 'report_delivered', 'triage_assigned'] as const) {
      expect(notificationEnqueueSchema.safeParse({ eventId: 'e1', workspaceId: 'w', userId: 'u', kind }).success).toBe(false);
      expect(notificationEnqueueSchema.safeParse({ eventId: 'e1', workspaceId: 'w', userId: 'u', kind, targetId: 'channel-a' }).success).toBe(true);
    }
  });

  it('maps the new events to their own email switches', () => {
    expect(notificationPreferenceKey('metric_alert')).toBe('onMetricAlert');
    expect(notificationPreferenceKey('report_delivered')).toBe('onReportDelivered');
    expect(notificationPreferenceKey('triage_assigned')).toBe('onTriageAssigned');
    expect(ADDITIONAL_NOTIFICATION_PREFERENCES).toEqual(expect.arrayContaining(['onMetricAlert', 'onReportDelivered', 'onTriageAssigned']));
    for (const key of ['onMetricAlert', 'onReportDelivered', 'onTriageAssigned'] as const) {
      expect(notificationPreferenceLabels.en[key].length).toBeGreaterThan(0);
      expect(notificationPreferenceLabels.fr[key].length).toBeGreaterThan(0);
    }
  });

  it('keeps saved event copy without the new entries usable', () => {
    const definition = NOTIFICATIONS_CONFIG.find(item => item.key === 'notifications.eventCopy')!;
    const { metric_alert: _a, report_delivered: _b, triage_assigned: _c, ...savedBefore } = NOTIFICATIONS_DEFAULTS.eventCopy;
    const parsed = definition.schema.safeParse(savedBefore);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.metric_alert.title).toBe(NOTIFICATIONS_DEFAULTS.eventCopy.metric_alert.title);
      expect(parsed.data.report_delivered.frTitle).toBe(NOTIFICATIONS_DEFAULTS.eventCopy.report_delivered.frTitle);
      expect(parsed.data.triage_assigned.body).toBe(NOTIFICATIONS_DEFAULTS.eventCopy.triage_assigned.body);
    }
  });

  it('checks report scope for metric and report events, inbox scope for triage', async () => {
    const tx = db as unknown as Parameters<typeof notificationRecipientEligible>[0];
    expect(await notificationRecipientEligible(tx, { eventId: 'e1', workspaceId: 'workspace-a', userId: 'user-a', kind: 'metric_alert', targetId: 'channel-a' })).toBe(true);
    expect(await notificationRecipientEligible(tx, { eventId: 'e2', workspaceId: 'workspace-a', userId: 'user-a', kind: 'report_delivered', targetId: 'channel-a' })).toBe(true);
    state.reportScope = ['channel-b'];
    expect(await notificationRecipientEligible(tx, { eventId: 'e3', workspaceId: 'workspace-a', userId: 'user-a', kind: 'metric_alert', targetId: 'channel-a' })).toBe(false);
    state.reportScope = null;
    expect(await notificationRecipientEligible(tx, { eventId: 'e4', workspaceId: 'workspace-a', userId: 'user-a', kind: 'triage_assigned', targetId: 'channel-a' })).toBe(true);
    state.inboxChannels = [];
    expect(await notificationRecipientEligible(tx, { eventId: 'e5', workspaceId: 'workspace-a', userId: 'user-a', kind: 'triage_assigned', targetId: 'channel-a' })).toBe(false);
  });

  it('enqueues the in-app item and starts email cancelled when the member opted out', async () => {
    const tx = db as unknown as Parameters<typeof enqueueNotification>[0];
    const first = await enqueueNotification(tx, { eventId: 'metric_alert_rule-a_fire-a', workspaceId: 'workspace-a', userId: 'user-a', kind: 'metric_alert', targetId: 'channel-a' });
    expect(first.inserted).toBe(true);
    state.preferences = { onMetricAlert: false, onReportDelivered: true, onTriageAssigned: true };
    const second = await enqueueNotification(tx, { eventId: 'metric_alert_rule-a_fire-b', workspaceId: 'workspace-a', userId: 'user-a', kind: 'metric_alert', targetId: 'channel-a' });
    expect(second.inserted).toBe(true);
    const inserts = db.$executeRaw.mock.calls.map(sqlOf).filter(sql => sql.includes('INSERT INTO rebuild_notifications'));
    expect(inserts).toHaveLength(2);
  });

  it('reads and writes the new email switches', async () => {
    const view = await readNotificationPreferences(actor);
    expect(view.preferences).toMatchObject({ onMetricAlert: true, onReportDelivered: true, onTriageAssigned: true });
    const parsed = notificationPreferenceUpdateSchema.safeParse({ onMetricAlert: false, confirmation: 'UPDATE NOTIFICATION PREFERENCES' });
    expect(parsed.success).toBe(true);
    db.$transaction.mockImplementation(async (run: (tx: unknown) => Promise<unknown>) => run(db));
    await updateNotificationPreferences(actor, { onMetricAlert: false, onReportDelivered: false, onTriageAssigned: false, confirmation: 'UPDATE NOTIFICATION PREFERENCES' });
    const update = db.$executeRaw.mock.calls.map(sqlOf).find(sql => sql.includes('UPDATE notification_settings SET'))!;
    expect(update).toContain('"onMetricAlert"');
    expect(update).toContain('"onReportDelivered"');
    expect(update).toContain('"onTriageAssigned"');
  });
});
