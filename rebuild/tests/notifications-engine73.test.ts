import { beforeEach, describe, expect, it, vi } from 'vitest';

type Query = { sql: string; values: unknown[] };
const state = vi.hoisted(() => ({
  queries: [] as Query[], executions: [] as Query[],
  visiblePost: true, noteValid: true, preferenceEnabled: true, muted: false,
  insertResults: [1] as number[], emailState: 'pending' as string, sendStatus: 'sent' as string,
  failInsert: false, failFinish: false, sends: 0, config: {} as Record<string, unknown>,
}));
const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn(),
  user: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() }, post: { findFirst: vi.fn() },
}));
vi.mock('@/server/data', () => ({ prisma: db }));
vi.mock('@/server/config/store', () => ({ runtimeConfig: async (key: string) => key === 'data.workspaceOperationTimeoutMs' ? 120000 : key === 'mail.connectionTimeoutMs' ? 10000 : key === 'mail.socketTimeoutMs' ? 20000 : state.config[key] }));
vi.mock('@/server/data-control/guard', () => ({ withWorkspaceOperation: (_id: string, run: () => Promise<unknown>) => run() }));
vi.mock('@/server/entitlements', () => ({ loadEntitlements: async (_userId: string, workspaceId: string) => ({ workspaceId }), canUseFeature: () => true }));
vi.mock('@/server/permissions', () => ({ canAccessFeature: () => true }));
vi.mock('@/server/permissions/loader', () => ({ loadPermissions: async () => ({ pageScope: { all: true, ids: [] } }) }));
vi.mock('@/modules/publishing/server/access', () => ({ authorizePublishing: async (actor: { userId: string; workspaceId: string }) => ({ actor, role: 'owner', permissions: { pageScope: { all: true, ids: [] } }, entitlements: { workspaceId: actor.workspaceId } }) }));
vi.mock('@/modules/publishing/server/read-scope', () => ({
  selectedPublishingTargetIds: async () => ['target-a'],
  publishingPostVisibilityWhere: (workspaceId: string, ids: string[], own: string | undefined) => ({ workspaceId, visibleTargetIds: ids, ownAuthor: own }),
}));
vi.mock('@/server/mail', () => ({ publicMailOrigin: async () => 'https://mail.example.test', sendTransactionalMail: async () => { state.sends += 1; return { status: state.sendStatus }; } }));

import { NOTIFICATIONS_CONFIG } from '../src/modules/settings/notifications/config';
import { enqueueNotification, listNotifications, markNotificationRead, notificationConfirmation, readNotificationPreferences } from '../src/modules/settings/notifications/server';
import { deliverNotifications } from '../src/modules/settings/notifications/delivery';

const actor = { userId: 'user-a', workspaceId: 'workspace-a' };
const noteEvent = { eventId: 'note_note-a', workspaceId: 'workspace-a', userId: 'user-a', kind: 'note_mention' as const, postId: 'post-a', noteId: 'note-a' };
const now = new Date('2026-10-18T12:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, { queries: [], executions: [], visiblePost: true, noteValid: true, preferenceEnabled: true, muted: false, insertResults: [1], emailState: 'pending', sendStatus: 'sent', failInsert: false, failFinish: false, sends: 0, config: Object.fromEntries(NOTIFICATIONS_CONFIG.map(item => [item.key, item.defaultValue])) });
  db.user.findUnique.mockResolvedValue({ disabledAt: null });
  db.membership.findUnique.mockResolvedValue({ role: 'owner' });
  db.post.findFirst.mockImplementation(async ({ where }: { where: { workspaceId: string } }) => state.visiblePost && where.workspaceId === actor.workspaceId ? { id: 'post-a' } : null);
  db.$transaction.mockImplementation(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
  db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = { sql: strings.join('?'), values }; state.queries.push(query);
    if (query.sql.includes('SELECT to_jsonb(ns)')) return [{ preferences: { onNoteMention: state.preferenceEnabled, onQueueEmpty: state.preferenceEnabled }, muted: state.muted }];
    if (query.sql.includes('SELECT "onNoteMention"')) return [{ onNoteMention: state.preferenceEnabled, onQueueEmpty: state.preferenceEnabled }];
    if (query.sql.includes('SELECT n.id FROM post_notes')) return state.noteValid ? [{ id: 'note-a' }] : [];
    if (query.sql.includes('SELECT n.id, n."workspaceId", n."userId"')) return [{ id: 'row-a', workspaceId: actor.workspaceId, userId: actor.userId, eventId: 'note_note-a', kind: 'note_mention', postId: 'post-a', noteId: 'note-a', targetId: null, labelId: null, attempt: 0 }];
    if (query.sql.includes('SELECT n.id, n."workspaceId"')) return state.emailState === 'pending' ? [{ id: 'row-a', workspaceId: actor.workspaceId }] : [];
    if (query.sql.includes('FOR SHARE OF p, n')) return state.noteValid ? [{ id: 'note-a' }] : [];
    if (query.sql.includes('FROM rebuild_notifications n JOIN users')) {
      return state.emailState === 'sending' ? [{ id: 'row-a', workspaceId: actor.workspaceId, userId: actor.userId, eventId: 'note_note-a', kind: 'note_mention', postId: 'post-a', noteId: 'note-a', targetId: null, labelId: null, attempt: 0, email: 'member@example.test', emailVerifiedAt: now, disabledAt: null }] : [];
    }
    if (query.sql.includes('FROM memberships m JOIN users u')) return [{ role: 'owner', disabledAt: null }];
    if (query.sql.includes('FROM rebuild_notifications WHERE')) {
      return state.emailState === 'pending' ? [{ id: 'row-a', eventId: 'note_note-a', workspaceId: actor.workspaceId, userId: actor.userId, kind: 'note_mention', createdAt: now, updatedAt: now, readAt: null, emailSentAt: null, emailState: 'pending', postId: 'post-a', noteId: 'note-a', targetId: null, labelId: null }] : [];
    }
    return [];
  });
  db.$executeRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = { sql: strings.join('?'), values }; state.executions.push(query);
    if (state.failInsert && query.sql.includes('INSERT INTO rebuild_notifications')) throw new Error('database unavailable');
    if (state.failFinish && query.sql.includes('"emailSentAt"')) throw new Error('database unavailable after SMTP');
    if (query.sql.includes('INSERT INTO rebuild_notifications')) return state.insertResults.shift() ?? 0;
    if (query.sql.includes("SET \"emailState\" = 'uncertain'")) {
      const cutoff = query.values.find(value => value instanceof Date) as Date | undefined;
      if (state.emailState === 'sending' && cutoff && cutoff.getTime() >= now.getTime() + 120000) {
        state.emailState = 'uncertain';
        return 1;
      }
      return 0;
    }
    if (query.sql.includes("SET \"emailState\" = 'sending'")) { state.emailState = 'sending'; return 1; }
    if (query.sql.includes('SET "emailState" =')) {
      const next = query.values[0]; if (typeof next === 'string') state.emailState = next;
      else if (query.sql.includes("'uncertain'")) state.emailState = 'uncertain';
      else state.emailState = 'sent';
      return 1;
    }
    return 1;
  });
});

describe('notification engine persistence and access', () => {
  it('returns only the caller’s personal switches and selected channel mutes', async () => {
    const view = await readNotificationPreferences(actor);
    expect(view.preferences).toEqual({ onNoteMention: true, onQueueEmpty: true });
    expect(state.queries.some(query => query.sql.includes('notification_settings') && query.values.includes(actor.userId) && query.values.includes(actor.workspaceId))).toBe(true);
  });

  it('scopes pages and read actions by both workspace and personal recipient', async () => {
    await listNotifications(actor, { page: 2, unreadOnly: true });
    const query = state.queries.find(item => item.sql.includes('FROM rebuild_notifications WHERE'))!;
    expect(query.sql).toContain('"workspaceId"'); expect(query.sql).toContain('"userId"');
    expect(query.values).toContain(actor.workspaceId); expect(query.values).toContain(actor.userId);
    await markNotificationRead(actor, { id: 'row-a', confirmation: notificationConfirmation.read('row-a') });
    const update = state.executions.find(item => item.sql.includes('UPDATE rebuild_notifications'))!;
    expect(update.values).toContain(actor.workspaceId); expect(update.values).toContain(actor.userId);
  });

  it('keeps eligible in-app alerts when the legacy email switch is off', async () => {
    state.preferenceEnabled = false;
    const tx = db as unknown as Parameters<typeof enqueueNotification>[0];
    await expect(enqueueNotification(tx, noteEvent)).resolves.toMatchObject({ inserted: true });
    const insert = state.executions.find(item => item.sql.includes('INSERT INTO rebuild_notifications'))!;
    expect(insert.values).toContain('cancelled');
  });

  it('makes duplicate source events idempotent per recipient and workspace', async () => {
    state.insertResults = [1, 0];
    const tx = db as unknown as Parameters<typeof enqueueNotification>[0];
    await expect(enqueueNotification(tx, noteEvent)).resolves.toMatchObject({ inserted: true });
    await expect(enqueueNotification(tx, noteEvent)).resolves.toMatchObject({ inserted: false });
    const insert = state.executions.find(item => item.sql.includes('INSERT INTO rebuild_notifications'))!;
    expect(insert.sql).toContain('ON CONFLICT');
    await expect((await import('node:fs/promises')).readFile(new URL('../../prisma/migrations/20261018150000_rebuild_notifications/migration.sql', import.meta.url), 'utf8')).resolves.toContain('rebuild_notifications_event_recipient_uq');
  });

  it('does not enqueue when whole-post visibility or the note workspace binding fails', async () => {
    state.visiblePost = false;
    const tx = db as unknown as Parameters<typeof enqueueNotification>[0];
    await expect(enqueueNotification(tx, noteEvent)).resolves.toMatchObject({ inserted: false });
    expect(state.executions.some(item => item.sql.includes('INSERT INTO rebuild_notifications'))).toBe(false);
    expect(db.post.findFirst).toHaveBeenCalled();
  });

  it('propagates failed durable writes so the caller transaction can roll back its source event', async () => {
    state.failInsert = true;
    const tx = db as unknown as Parameters<typeof enqueueNotification>[0];
    await expect(enqueueNotification(tx, noteEvent)).rejects.toThrow();
  });
});

describe('notification email delivery state machine', () => {
  it('limits scoped retention to its workspace and the current configured batch bound', async () => {
    state.emailState = 'sent';
    await deliverNotifications(now, actor.workspaceId);
    const purge = state.executions.find(query => query.sql.includes('DELETE FROM rebuild_notifications'))!;
    expect(purge.sql).toContain('"workspaceId" =');
    expect(purge.values).toContain(actor.workspaceId);
    expect(purge.values).toContain(state.config['notifications.deliveryBatchSize']);
    expect(purge.sql).toContain("IN ('sent', 'failed', 'cancelled')");
  });

  it('requires an unexpired committed claim before any SMTP attempt', async () => {
    db.$queryRaw.mockImplementationOnce(async () => [{ id: 'row-a', workspaceId: actor.workspaceId }]);
    const original = db.$queryRaw.getMockImplementation()!;
    db.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join('?').includes('FROM rebuild_notifications n JOIN users')) {
        expect(strings.join('?')).toContain('"claimUntil" > clock_timestamp()');
        return [];
      }
      return original(strings, ...values);
    });
    await deliverNotifications(now, actor.workspaceId);
    expect(state.sends).toBe(0);
  });

  it('does not resend an SMTP-uncertain outcome', async () => {
    state.sendStatus = 'uncertain';
    const stats = await deliverNotifications(now, actor.workspaceId);
    expect(stats).toMatchObject({ examined: 1, uncertain: 1 });
    const next = await deliverNotifications(new Date(now.getTime() + 60000), actor.workspaceId);
    expect(next.examined).toBe(0);
    expect(state.sends).toBe(1);
  });

  it('leaves a failed post-SMTP write in sending until it becomes held as uncertain', async () => {
    state.failFinish = true;
    await expect(deliverNotifications(now, actor.workspaceId)).resolves.toMatchObject({ uncertain: 1 });
    expect(state.sends).toBe(1);
    state.failFinish = false;
    await expect(deliverNotifications(new Date(now.getTime() + 121000), actor.workspaceId)).resolves.toMatchObject({ uncertain: 1, examined: 0 });
    expect(state.sends).toBe(1);
  });
});

describe('additional durable alert contracts', () => {
  it.each([
    ['publish_failure', 'onPublishFailure'], ['connection_expired', 'onPublishFailure'],
    ['token_expiring', 'onTokenExpiry'], ['approval_request', 'onApprovalRequest'],
    ['approval_decision', 'onApprovalDecision'], ['inbox_digest', 'onNewInbox'],
    ['queue_empty', 'onQueueEmpty'], ['draft_updated', 'onDraftUpdated'],
    ['moderation_alert', 'onModerationAlert'], ['negative_spike', 'onModerationAlert'],
  ] as const)('honors %s email opt-out independently', async (kind, preference) => {
    const { recipientAllowsNotification } = await import('../src/modules/settings/notifications/server');
    db.$queryRaw.mockResolvedValue([{ preferences: { [preference]: false }, muted: false }]);
    await expect(recipientAllowsNotification(db as never, { ...actor, kind, targetId: 'target-a' })).resolves.toBe(false);
    db.$queryRaw.mockResolvedValue([{ preferences: { [preference]: true }, muted: false }]);
    await expect(recipientAllowsNotification(db as never, { ...actor, kind, targetId: 'target-a' })).resolves.toBe(true);
  });
  it('requires durable context and supplies French copy for every new event', async () => {
    const { notificationEnqueueSchema } = await import('../src/modules/settings/notifications/contracts');
    const { localizedNotificationCopy } = await import('../src/modules/settings/notifications/server');
    const { NOTIFICATIONS_DEFAULTS } = await import('../src/modules/settings/notifications/config');
    for (const kind of ['publish_failure', 'connection_expired', 'token_expiring', 'approval_request', 'approval_decision', 'inbox_digest', 'queue_empty', 'draft_updated', 'moderation_alert', 'negative_spike'] as const) {
      expect(notificationEnqueueSchema.safeParse({ ...actor, eventId: 'event', kind }).success).toBe(false);
      expect(notificationEnqueueSchema.safeParse({ ...actor, eventId: 'event', kind, postId: 'post', targetId: 'target', accountId: 'account' }).success).toBe(true);
      expect(localizedNotificationCopy(NOTIFICATIONS_DEFAULTS.eventCopy[kind], 'fr').title).toBe(NOTIFICATIONS_DEFAULTS.eventCopy[kind].frTitle);
    }
  });
  it('keeps decisions and draft changes author-only in current visibility queries', async () => {
    const { notificationRecipientEligible } = await import('../src/modules/settings/notifications/server');
    for (const kind of ['approval_decision', 'draft_updated'] as const) {
      await notificationRecipientEligible(db as never, { ...actor, eventId: 'event', kind, postId: 'post-a' });
      expect(db.post.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownAuthor: actor.userId, workspaceId: actor.workspaceId }) }));
    }
  });
});
