import { configValueOrDefault } from '@/server/config/config-or-default';
import { authorizeReport } from '@/modules/analytics/reports/server/access';
import { authorizeInbox } from '@/modules/inbox/server/access';
import { hasPlatformCapability } from '@/server/entitlements';
import { ADDITIONAL_NOTIFICATION_PREFERENCES } from './catalog';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/client';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { canUseFeature, loadEntitlements } from '@/server/entitlements';
import { canAccessFeature } from '@/server/permissions';
import { loadPermissions } from '@/server/permissions/loader';
import { withWorkspaceOperation } from '@/server/data-control/guard';
import { selectedPublishingTargetIds } from '@/modules/publishing/server/read-scope';
import { authorizePublishing } from '@/modules/publishing/server/access';
import { publishingPostVisibilityWhere } from '@/modules/publishing/server/read-scope';
import { NOTIFICATIONS_CONFIG, NOTIFICATIONS_DEFAULTS, type NotificationBounds, type NotificationEventCopy } from './config';
import { notificationConfirmation, notificationEnqueueSchema, notificationIdActionSchema, notificationPageSchema, notificationPreferenceUpdateSchema, type NotificationActor, type NotificationEnqueueInput, type NotificationMute, type NotificationPage, type NotificationPreferenceView, type NotificationRow } from './contracts';

export type { NotificationActor, NotificationEvent, NotificationEnqueueInput, NotificationMute, NotificationPage, NotificationPreferenceView, NotificationRow } from './contracts';
export { notificationConfirmation } from './contracts';
export const UPDATE_NOTIFICATION_PREFERENCES_CONFIRMATION = notificationConfirmation.updatePreferences();

type Authority = { role: string; entitlements: NonNullable<Awaited<ReturnType<typeof loadEntitlements>>>; permissions: NonNullable<Awaited<ReturnType<typeof loadPermissions>>> };
type Tx = Prisma.TransactionClient;
type NotificationDbRow = Omit<NotificationRow, 'title' | 'body' | 'available'> & Pick<NotificationEnqueueInput, 'eventId' | 'workspaceId' | 'userId'>;
const invalid = (message = 'Check the notification details and confirm the exact action.') => new OperationError('invalid_request', message);
const unavailable = () => new OperationError('unavailable', 'Notifications are temporarily unavailable. Try again later.');
const missing = () => new OperationError('not_found', 'This notification is unavailable in the current workspace.');
const protect = async <T>(operation: Promise<T>): Promise<T> => { try { return await operation; } catch (error) { if (error instanceof OperationError) throw error; throw new OperationError('upstream_failure', 'The notification change could not be confirmed. Refresh and check the current state.'); } };
const exact = (actual: string, expected: string) => { if (actual !== expected) throw invalid('Type the exact confirmation shown to continue.'); };

async function bounds(): Promise<NotificationBounds> {
  try {
    const [values, workspaceTimeout, defaultsRaw] = await Promise.all([Promise.all(NOTIFICATIONS_CONFIG.map(item => runtimeConfig(item.key))), runtimeConfig('data.workspaceOperationTimeoutMs'), runtimeConfig('notifications.preferenceDefaults')]);
    const result: Record<string, number> = {};
    NOTIFICATIONS_CONFIG.forEach((item, index) => {
      if (item.key === 'notifications.eventCopy' || item.key === 'notifications.deliverySchedule' || item.key === 'notifications.preferenceDefaults') return;
      const checked = item.schema.safeParse(values[index]);
      if (!checked.success || typeof checked.data !== 'number') throw unavailable();
      result[item.key.slice('notifications.'.length)] = checked.data;
    });
    if (typeof workspaceTimeout !== 'number' || result.transactionTimeoutMs! + result.transactionMaxWaitMs! >= workspaceTimeout) throw unavailable();
    const defaultsSchema = NOTIFICATIONS_CONFIG.find(item => item.key === 'notifications.preferenceDefaults')!.schema;
    const defaults = defaultsSchema.safeParse(defaultsRaw);
    if (!defaults.success) throw unavailable();
    return { ...result, preferenceDefaults: defaults.data } as NotificationBounds;
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}

export async function notificationEventCopy(): Promise<NotificationEventCopy> {
  try {
    const raw = await configValueOrDefault('notifications.eventCopy');
    const definition = NOTIFICATIONS_CONFIG.find(item => item.key === 'notifications.eventCopy')!;
    const checked = definition.schema.safeParse(raw);
    if (!checked.success) throw unavailable();
    return checked.data as NotificationEventCopy;
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}

/** Validated Root-owned limits, schedule and safe event copy for host wiring. */
export async function loadNotificationPolicy() {
  try {
    const [limits, schedule, eventCopy, mailConnectionTimeout, mailSocketTimeout, workspaceTimeout] = await Promise.all([
      bounds(), runtimeConfig('notifications.deliverySchedule'), notificationEventCopy(), runtimeConfig('mail.connectionTimeoutMs'), runtimeConfig('mail.socketTimeoutMs'), runtimeConfig('data.workspaceOperationTimeoutMs'),
    ]);
    const definition = NOTIFICATIONS_CONFIG.find(item => item.key === 'notifications.deliverySchedule')!;
    const checked = definition.schema.safeParse(schedule);
    if (!checked.success || typeof mailConnectionTimeout !== 'number' || typeof mailSocketTimeout !== 'number' || typeof workspaceTimeout !== 'number' ||
        limits.deliveryOperationTimeoutMs < mailConnectionTimeout + mailSocketTimeout + 1000 ||
        limits.deliveryOperationTimeoutMs + limits.deliveryOperationMaxWaitMs >= workspaceTimeout ||
        limits.claimLeaseSeconds * 1000 <= limits.deliveryOperationTimeoutMs + limits.deliveryOperationMaxWaitMs) throw unavailable();
    return { ...limits, deliverySchedule: checked.data as string, eventCopy };
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}

async function authorize(actor: NotificationActor, write: boolean): Promise<Authority> {
  if (!actor || typeof actor.userId !== 'string' || typeof actor.workspaceId !== 'string' || !actor.userId || !actor.workspaceId) throw new OperationError('unauthorized', 'Sign in with an active workspace account.');
  try {
    const [user, membership, entitlements, permissions] = await Promise.all([
      prisma.user.findUnique({ where: { id: actor.userId }, select: { disabledAt: true } }),
      prisma.membership.findUnique({ where: { userId_workspaceId: { userId: actor.userId, workspaceId: actor.workspaceId } }, select: { role: true } }),
      loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }),
      loadPermissions(actor.userId, actor.workspaceId),
    ]);
    if (!user || user.disabledAt || !membership) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
    if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions || !canUseFeature(entitlements, 'settings/notifications') || !canAccessFeature(permissions, 'settings/notifications', write ? 'write' : 'read')) throw new OperationError('forbidden', 'Notifications are unavailable in this workspace.');
    return { role: membership.role, entitlements, permissions };
  } catch (error) { if (error instanceof OperationError) throw error; throw unavailable(); }
}

async function lockActor(tx: Tx, actor: NotificationActor, write: boolean) {
  const rows = await tx.$queryRaw<Array<{ role: string; disabledAt: Date | null }>>`SELECT m.role::text AS role, u."disabledAt" FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."userId" = ${actor.userId} AND m."workspaceId" = ${actor.workspaceId} FOR UPDATE OF m, u`;
  const row = rows[0];
  if (!row || row.disabledAt) throw new OperationError('unauthorized', 'Your active workspace access changed. Sign in again to continue.');
  const [entitlements, permissions] = await Promise.all([loadEntitlements(actor.userId, actor.workspaceId, { allowInstallationInspection: false }), loadPermissions(actor.userId, actor.workspaceId)]);
  if (!entitlements || entitlements.workspaceId !== actor.workspaceId || !permissions || !canUseFeature(entitlements, 'settings/notifications') || !canAccessFeature(permissions, 'settings/notifications', write ? 'write' : 'read')) throw new OperationError('forbidden', 'Notifications are unavailable in this workspace.');
  return row.role;
}

async function reachableChannels(actor: NotificationActor, authority: Authority, maximum: number, db: Tx | typeof prisma = prisma) {
  const ids = await selectedPublishingTargetIds(actor.workspaceId, authority.entitlements, authority.permissions.pageScope.all ? undefined : authority.permissions.pageScope.ids);
  if (!ids.length) return [];
  const rows = await db.$queryRaw<Array<{ id: string; name: string }>>`SELECT t.id, t.name FROM targets t WHERE t."workspaceId" = ${actor.workspaceId} AND t.enabled = true AND t.id = ANY(${ids}::text[]) ORDER BY t.name ASC, t.id ASC LIMIT ${maximum + 1}`;
  if (rows.length > maximum) throw unavailable();
  return rows;
}

function parseInput<S extends import('zod').ZodTypeAny>(schema: S, input: unknown): import('zod').output<S> {
  const checked = schema.safeParse(input);
  if (!checked.success) throw invalid();
  return checked.data;
}

/** Personal choices in this workspace only, using the existing legacy switches. */
export async function readNotificationPreferences(actor: NotificationActor): Promise<NotificationPreferenceView> {
  const authority = await authorize(actor, false);
  const limit = await bounds();
  const [allowedChannels, settings] = await Promise.all([
    reachableChannels(actor, authority, limit.maxPreferenceChannels),
    protect(prisma.$queryRaw<Array<{ onNoteMention: boolean | null; onQueueEmpty: boolean | null }>>`SELECT "onNoteMention", "onQueueEmpty" FROM notification_settings WHERE "userId" = ${actor.userId} AND "workspaceId" = ${actor.workspaceId} LIMIT 1`),
  ]);
  const people = await protect(prisma.$queryRaw<Array<{ locale: string }>>`SELECT locale::text AS locale FROM users WHERE id = ${actor.userId} LIMIT 1`);
  const person = people[0];
  const extra = await protect(prisma.$queryRaw<Array<Record<string, boolean>>>`SELECT "onPublishFailure", "onTokenExpiry", "onApprovalRequest", "onApprovalDecision", "onNewInbox", "onDraftUpdated", "onModerationAlert", "onMetricAlert", "onReportDelivered", "onTriageAssigned" FROM notification_settings WHERE "userId" = ${actor.userId} AND "workspaceId" = ${actor.workspaceId} LIMIT 1`);
  const extraPreferences = Object.fromEntries(ADDITIONAL_NOTIFICATION_PREFERENCES.map(key => [key, extra[0]?.[key] ?? (key !== 'onNewInbox')]));
  const targetIds = allowedChannels.map(channel => channel.id);
  const mutes = targetIds.length ? await protect(prisma.$queryRaw<NotificationMute[]>`SELECT m."targetId", 'queueEmpty'::text AS event FROM notification_mutes m JOIN targets t ON t.id = m."targetId" WHERE m."userId" = ${actor.userId} AND t."workspaceId" = ${actor.workspaceId} AND m.event = 'queueEmpty' AND m."targetId" = ANY(${targetIds}::text[]) ORDER BY m."targetId"`) : [];
  return { ...(person && 'locale' in person ? { locale: person.locale === 'fr' ? 'fr' as const : 'en' as const } : {}), preferences: { ...(extra.length ? extraPreferences : {}), onNoteMention: settings[0]?.onNoteMention ?? limit.preferenceDefaults.onNoteMention, onQueueEmpty: settings[0]?.onQueueEmpty ?? limit.preferenceDefaults.onQueueEmpty }, configured: settings.length > 0, mutes, channels: allowedChannels, maxMutes: limit.maxMutes };
}

/** Updates only the caller's event switches and reachable queue-empty mutes. */
export async function updateNotificationPreferences(actor: NotificationActor, input: unknown): Promise<NotificationPreferenceView> {
  const value = parseInput(notificationPreferenceUpdateSchema, input);
  exact(value.confirmation, notificationConfirmation.updatePreferences());
  const limit = await bounds();
  const mutes = value.mutes ? [...new Map(value.mutes.map(item => [item.targetId, item])).values()] : undefined;
  if (mutes && mutes.length > limit.maxMutes) throw invalid('Choose fewer channels to mute.');
  await authorize(actor, true);
  await protect(withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['notifications.preferences', actor.workspaceId, actor.userId])}, 0))::text`;
    await lockActor(tx, actor, true);
    const currentAuthority = await authorize(actor, true);
    const n = await tx.$executeRaw`INSERT INTO notification_settings (id, "userId", "workspaceId", "onNoteMention", "onQueueEmpty") VALUES (${`ns_${randomUUID()}`}, ${actor.userId}, ${actor.workspaceId}, COALESCE(${value.onNoteMention ?? null}::boolean, ${limit.preferenceDefaults.onNoteMention}), COALESCE(${value.onQueueEmpty ?? null}::boolean, ${limit.preferenceDefaults.onQueueEmpty})) ON CONFLICT ("userId", "workspaceId") DO UPDATE SET "onNoteMention" = COALESCE(${value.onNoteMention ?? null}::boolean, notification_settings."onNoteMention"), "onQueueEmpty" = COALESCE(${value.onQueueEmpty ?? null}::boolean, notification_settings."onQueueEmpty")`;
    if (n !== 1) throw unavailable();
    // Fixed column names only; all values remain bound and caller/workspace scoped.
    const additionalChanged = await tx.$executeRaw`UPDATE notification_settings SET "onPublishFailure" = COALESCE(${value.onPublishFailure ?? null}::boolean, "onPublishFailure"), "onTokenExpiry" = COALESCE(${value.onTokenExpiry ?? null}::boolean, "onTokenExpiry"), "onApprovalRequest" = COALESCE(${value.onApprovalRequest ?? null}::boolean, "onApprovalRequest"), "onApprovalDecision" = COALESCE(${value.onApprovalDecision ?? null}::boolean, "onApprovalDecision"), "onNewInbox" = COALESCE(${value.onNewInbox ?? null}::boolean, "onNewInbox"), "onDraftUpdated" = COALESCE(${value.onDraftUpdated ?? null}::boolean, "onDraftUpdated"), "onModerationAlert" = COALESCE(${value.onModerationAlert ?? null}::boolean, "onModerationAlert"), "onMetricAlert" = COALESCE(${value.onMetricAlert ?? null}::boolean, "onMetricAlert"), "onReportDelivered" = COALESCE(${value.onReportDelivered ?? null}::boolean, "onReportDelivered"), "onTriageAssigned" = COALESCE(${value.onTriageAssigned ?? null}::boolean, "onTriageAssigned"), "inboxDigestAt" = CASE WHEN ${value.onNewInbox ?? null}::boolean IS NOT NULL AND ${value.onNewInbox ?? null}::boolean IS DISTINCT FROM "onNewInbox" THEN NULL ELSE "inboxDigestAt" END WHERE "userId" = ${actor.userId} AND "workspaceId" = ${actor.workspaceId}`;
    if (additionalChanged !== 1) throw unavailable();

    if (mutes) {
      const channels = await reachableChannels(actor, currentAuthority, limit.maxPreferenceChannels, tx);
      const ids = channels.map(channel => channel.id);
      if (mutes.some(item => !ids.includes(item.targetId))) throw invalid('Choose channels you can access.');
      if (ids.length) await tx.$executeRaw`DELETE FROM notification_mutes WHERE "userId" = ${actor.userId} AND event = 'queueEmpty' AND "targetId" = ANY(${ids}::text[])`;
      for (const mute of mutes) await tx.$executeRaw`INSERT INTO notification_mutes (id, "userId", "targetId", event) VALUES (${`nm_${randomUUID()}`}, ${actor.userId}, ${mute.targetId}, 'queueEmpty') ON CONFLICT ("userId", "targetId", event) DO NOTHING`;
    }
    const changedFlags = [...ADDITIONAL_NOTIFICATION_PREFERENCES.filter(key => value[key] !== undefined), value.onNoteMention !== undefined ? 'onNoteMention' : null, value.onQueueEmpty !== undefined ? 'onQueueEmpty' : null].filter((flag): flag is string => Boolean(flag));
    await audit(tx, actor, 'notifications.preferences_updated', { flags: changedFlags, mutes: mutes?.length ?? null });
    await lockActor(tx, actor, true);
  }, { timeout: limit.transactionTimeoutMs, maxWait: limit.transactionMaxWaitMs })));
  return readNotificationPreferences(actor);
}

export async function listNotifications(actor: NotificationActor, input: { page?: number; unreadOnly?: boolean } = {}): Promise<NotificationPage> {
  const query = parseInput(notificationPageSchema, input);
  await authorize(actor, false);
  const limit = await bounds();
  const page = query.page ?? 1;
  const copy = await notificationEventCopy();
  const rows = await protect(prisma.$queryRaw<NotificationDbRow[]>`SELECT id, kind, "createdAt", "updatedAt", "readAt", "emailSentAt", "emailState", "postId", "noteId", "targetId", "labelId", "accountId", "eventId", "userId", "workspaceId" FROM rebuild_notifications WHERE "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId} AND (${query.unreadOnly ?? false} = false OR "readAt" IS NULL) ORDER BY "createdAt" DESC, id DESC LIMIT ${limit.pageSize + 1} OFFSET ${(page - 1) * limit.pageSize}`);
  const items: NotificationRow[] = [];
  for (const row of rows.slice(0, limit.pageSize)) {
    const context: NotificationEnqueueInput = {
      eventId: row.eventId, workspaceId: row.workspaceId, userId: row.userId, kind: row.kind,
      ...(row.accountId ? { accountId: row.accountId } : {}), ...(row.postId ? { postId: row.postId } : {}), ...(row.noteId ? { noteId: row.noteId } : {}),
      ...(row.targetId ? { targetId: row.targetId } : {}), ...(row.labelId ? { labelId: row.labelId } : {}),
    };
    const available = await notificationRecipientEligible(prisma as unknown as Tx, context);
    const locale = await txLocale(prisma as unknown as Tx, actor.userId);
    const eventText = localizedNotificationCopy(copy[row.kind], locale);
    // Project only the public inbox fields. Stable source event IDs encode
    // business identifiers (for example note_<noteId>) and must never escape.
    const publicRow = {
      id: row.id, kind: row.kind, createdAt: row.createdAt, updatedAt: row.updatedAt,
      readAt: row.readAt, emailSentAt: row.emailSentAt, emailState: row.emailState,
    };
    items.push(available
      ? { ...publicRow, ...eventText, available: true, postId: row.postId, noteId: row.noteId, targetId: row.targetId, labelId: row.labelId }
      : { ...publicRow, ...copy.unavailable, available: false, postId: null, noteId: null, targetId: null, labelId: null });
  }
  return { items, page, pageSize: limit.pageSize, hasMore: rows.length > limit.pageSize };
}

export async function markNotificationRead(actor: NotificationActor, input: unknown) {
  const value = parseInput(notificationIdActionSchema, input); exact(value.confirmation, notificationConfirmation.read(value.id));
  const limit = await bounds(); await authorize(actor, true);
  return protect(withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
    await lockActor(tx, actor, true);
    const result = await tx.$executeRaw`UPDATE rebuild_notifications SET "readAt" = COALESCE("readAt", NOW()), "updatedAt" = NOW() WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId}`;
    if (result !== 1) throw missing();
    await audit(tx, actor, 'notifications.read', { notificationId: value.id });
    await lockActor(tx, actor, true);
    return { id: value.id, read: true as const };
  }, { timeout: limit.transactionTimeoutMs, maxWait: limit.transactionMaxWaitMs })));
}

export async function deleteNotification(actor: NotificationActor, input: unknown) {
  const value = parseInput(notificationIdActionSchema, input); exact(value.confirmation, notificationConfirmation.delete(value.id));
  const limit = await bounds(); await authorize(actor, true);
  return protect(withWorkspaceOperation(actor.workspaceId, () => prisma.$transaction(async tx => {
    await lockActor(tx, actor, true);
    const result = await tx.$executeRaw`DELETE FROM rebuild_notifications WHERE id = ${value.id} AND "workspaceId" = ${actor.workspaceId} AND "userId" = ${actor.userId}`;
    if (result !== 1) throw missing();
    await audit(tx, actor, 'notifications.deleted', { notificationId: value.id });
    await lockActor(tx, actor, true);
    return { id: value.id, deleted: true as const };
  }, { timeout: limit.transactionTimeoutMs, maxWait: limit.transactionMaxWaitMs })));
}

async function audit(tx: Tx, actor: NotificationActor, action: string, detail: object) {
  const rows = await tx.$executeRaw`INSERT INTO activity_logs (id, "workspaceId", "actorId", action, detail, "createdAt") VALUES (${`notif_${randomUUID()}`}, ${actor.workspaceId}, ${actor.userId}, ${action}, ${JSON.stringify(detail)}::jsonb, NOW())`;
  if (rows !== 1) throw unavailable();
}

/** Insert within the caller's transaction; the unique workspace/event/recipient key makes retries idempotent. */
export async function enqueueNotification(tx: Tx, input: NotificationEnqueueInput): Promise<{ id: string; inserted: boolean }> {
  const value = parseInput(notificationEnqueueSchema, input);
  if (!await notificationRecipientEligible(tx, value)) return { id: '', inserted: false };
  // The legacy onNoteMention/onQueueEmpty switches control email. The durable
  // in-app item is still created; email starts cancelled when the member opted out.
  const emailAllowed = await recipientAllowsNotification(tx, value);
  const id = `nt_${randomUUID()}`;
  const inserted = await tx.$executeRaw`INSERT INTO rebuild_notifications (id, "eventId", "workspaceId", "userId", kind, "postId", "noteId", "targetId", "labelId", "accountId", "createdAt", "emailState", attempt, "nextAt") VALUES (${id}, ${value.eventId}, ${value.workspaceId}, ${value.userId}, ${value.kind}, ${value.postId ?? null}, ${value.noteId ?? null}, ${value.targetId ?? null}, ${value.labelId ?? null}, ${value.accountId ?? null}, NOW(), ${emailAllowed ? 'pending' : 'cancelled'}, 0, ${emailAllowed ? new Date() : null}) ON CONFLICT ("workspaceId", "eventId", "userId") DO NOTHING`;
  return { id: inserted === 1 ? id : '', inserted: inserted === 1 };
}

/** Recheck personal preferences, current feature permissions, selected resources and private event scope. */
export async function notificationRecipientEligible(tx: Tx, input: NotificationEnqueueInput): Promise<boolean> {
  const value = parseInput(notificationEnqueueSchema, input);
  const recipient: NotificationActor = { userId: value.userId, workspaceId: value.workspaceId };
  try { await authorize(recipient, false); }
  catch (error) {
    if (error instanceof OperationError && (error.code === 'unauthorized' || error.code === 'forbidden' || error.code === 'not_found')) return false;
    throw error;
  }
  if (['connection_expired', 'token_expiring'].includes(value.kind)) {
    const authority = await authorize(recipient, false);
    if (!['owner', 'admin'].includes(authority.role) || !canUseFeature(authority.entitlements, 'settings/connections') || !canAccessFeature(authority.permissions, 'settings/connections', 'read')) return false;
    const accounts = await tx.$queryRaw<Array<{ provider: string }>>`SELECT provider FROM social_accounts WHERE id = ${value.accountId!} AND "workspaceId" = ${value.workspaceId}`;
    return accounts.length === 1 && hasPlatformCapability(authority.entitlements, accounts[0]!.provider);
  }
  if (['inbox_digest', 'moderation_alert', 'negative_spike', 'triage_assigned'].includes(value.kind)) {
    try { return (await authorizeInbox(recipient)).channelIds.includes(value.targetId!); }
    catch (error) { if (error instanceof OperationError && ['unauthorized', 'forbidden', 'not_found'].includes(error.code)) return false; throw error; }
  }
  if (['metric_alert', 'report_delivered'].includes(value.kind)) {
    try {
      const report = await authorizeReport(recipient, 'read');
      return report.scope === null || report.scope.includes(value.targetId!);
    }
    catch (error) { if (error instanceof OperationError && ['unauthorized', 'forbidden', 'not_found'].includes(error.code)) return false; throw error; }
  }
  if (['publish_failure', 'approval_request', 'approval_decision', 'draft_updated', 'queue_empty'].includes(value.kind)) {
    let access;
    try { access = await authorizePublishing(recipient, value.kind === 'queue_empty' ? 'publishing/queue' : value.kind === 'approval_request' ? 'publishing/approvals' : 'publishing/posts', 'read'); }
    catch (error) { if (error instanceof OperationError && ['unauthorized', 'forbidden', 'not_found'].includes(error.code)) return false; throw error; }
    const ids = await selectedPublishingTargetIds(value.workspaceId, access.entitlements, access.actor.allowedTargetIds);
    if (value.targetId && !ids.includes(value.targetId)) return false;
    if (value.kind === 'queue_empty') return ['owner', 'admin'].includes(access.role);
    if (value.kind === 'approval_request' && !['owner', 'admin', 'editor'].includes(access.role)) return false;
    const ownAuthor = access.actor.allowedTargetIds !== undefined || access.role === 'contributor' || ['approval_decision', 'draft_updated'].includes(value.kind) ? value.userId : undefined;
    return Boolean(await tx.post.findFirst({ where: { id: value.postId!, ...publishingPostVisibilityWhere(value.workspaceId, ids, ownAuthor) }, select: { id: true } }));
  }
  if (value.kind === 'note_mention') {
    let recipientAuth;
    try { recipientAuth = await authorizePublishing(recipient, 'publishing/collaboration', 'read'); }
    catch (error) { if (error instanceof OperationError && ['unauthorized', 'forbidden', 'not_found'].includes(error.code)) return false; throw error; }
    if (recipientAuth.role === 'client') return false;
    const visibleIds = await selectedPublishingTargetIds(value.workspaceId, recipientAuth.entitlements, recipientAuth.actor.allowedTargetIds);
    const ownAuthor = recipientAuth.actor.allowedTargetIds !== undefined || recipientAuth.role === 'contributor' ? recipient.userId : undefined;
    const post = await tx.post.findFirst({ where: { id: value.postId!, ...publishingPostVisibilityWhere(value.workspaceId, visibleIds, ownAuthor) }, select: { id: true } });
    if (!post) return false;
    const note = await tx.$queryRaw<Array<{ id: string }>>`SELECT n.id FROM post_notes n JOIN posts p ON p.id = n."postId" WHERE n.id = ${value.noteId!} AND n."postId" = ${value.postId!} AND p."workspaceId" = ${value.workspaceId} AND n."mentionIds" @> ARRAY[${value.userId}]::text[]`;
    return note.length === 1;
  }
  if (value.kind === 'inbox_note_mention') {
    let recipientAuth;
    try { recipientAuth = await authorizeInbox(recipient); }
    catch (error) { if (error instanceof OperationError && ['unauthorized', 'forbidden', 'not_found'].includes(error.code)) return false; throw error; }
    if (!recipientAuth.channelIds.includes(value.targetId!)) return false;
    const membership = await tx.$queryRaw<Array<{ role: string }>>`SELECT m.role::text AS role FROM memberships m JOIN users u ON u.id = m."userId" WHERE m."workspaceId" = ${value.workspaceId} AND m."userId" = ${value.userId} AND u."disabledAt" IS NULL`;
    if (!membership[0] || membership[0].role === 'client') return false;
    const note = await tx.$queryRaw<Array<{ id: string }>>`SELECT n.id FROM inbox_notes n WHERE n.id = ${value.noteId!} AND n."workspaceId" = ${value.workspaceId} AND n."mentionIds" @> ARRAY[${value.userId}]::text[]`;
    return note.length === 1;
  }
  let queueAuth;
  try { queueAuth = await authorizePublishing(recipient, 'publishing/queue', 'read'); }
  catch (error) { if (error instanceof OperationError && ['unauthorized', 'forbidden', 'not_found'].includes(error.code)) return false; throw error; }
  if (queueAuth.role !== 'owner' && queueAuth.role !== 'admin') return false;
  const ids = await selectedPublishingTargetIds(value.workspaceId, queueAuth.entitlements, queueAuth.actor.allowedTargetIds);
  if (!ids.includes(value.targetId!)) return false;
  const rule = await tx.$queryRaw<Array<{ id: string }>>`SELECT r.id FROM content_mix_rules r
    JOIN labels l ON l.id = r."labelId" AND l."workspaceId" = r."workspaceId"
    LEFT JOIN page_group_targets pgt ON pgt."groupId" = r."groupId" AND pgt."targetId" = ${value.targetId!}
    JOIN targets t ON t.id = ${value.targetId!} AND t."workspaceId" = r."workspaceId"
    WHERE r."workspaceId" = ${value.workspaceId} AND (r."targetId" = ${value.targetId!} OR (r."targetId" IS NULL AND r."groupId" IS NOT NULL AND pgt."groupId" IS NOT NULL))
      AND (${value.labelId ?? null}::text IS NULL OR r."labelId" = ${value.labelId ?? null}) AND r."dryNotifiedAt" IS NOT NULL AND t.enabled = true LIMIT 1`;
  return rule.length === 1;
}

/** Internal, validated preference read for event producers. */
export async function recipientAllowsNotification(tx: Tx, input: Pick<NotificationEnqueueInput, 'workspaceId' | 'userId' | 'kind' | 'targetId'>) {
  const limit = await bounds();
  const rows = await tx.$queryRaw<Array<{ preferences: Record<string, boolean> | null; muted: boolean }>>`SELECT to_jsonb(ns) AS preferences,
    EXISTS (SELECT 1 FROM notification_mutes m JOIN targets t ON t.id = m."targetId" WHERE m."userId" = ${input.userId} AND m."targetId" = ${input.targetId ?? ''} AND m.event = ${input.kind === 'publish_failure' ? 'publishFailure' : input.kind === 'inbox_digest' ? 'newInbox' : ['queue_empty', 'mix_dry'].includes(input.kind) ? 'queueEmpty' : ''} AND t."workspaceId" = ${input.workspaceId}) AS muted FROM (SELECT 1) seed LEFT JOIN notification_settings ns ON ns."userId" = ${input.userId} AND ns."workspaceId" = ${input.workspaceId}`;
  const row = rows[0];
  const key = notificationPreferenceKey(input.kind);
  const enabled = row?.preferences?.[key];
  const fallback = ['note_mention', 'inbox_note_mention'].includes(input.kind) ? limit.preferenceDefaults.onNoteMention : ['mix_dry', 'queue_empty'].includes(input.kind) ? limit.preferenceDefaults.onQueueEmpty : input.kind !== 'inbox_digest';
  return !row?.muted && (typeof enabled === 'boolean' ? enabled : fallback);
}

/** Atomic mention-port helper: recipients are independently checked and deduplicated by stable event ID. */
export const notificationPreferenceDefaults = NOTIFICATIONS_DEFAULTS;

export function notificationPreferenceKey(kind: import('./contracts').NotificationEvent): string {
  return ({ note_mention: 'onNoteMention', inbox_note_mention: 'onNoteMention', mix_dry: 'onQueueEmpty', queue_empty: 'onQueueEmpty', publish_failure: 'onPublishFailure', connection_expired: 'onPublishFailure', token_expiring: 'onTokenExpiry', approval_request: 'onApprovalRequest', approval_decision: 'onApprovalDecision', draft_updated: 'onDraftUpdated', inbox_digest: 'onNewInbox', moderation_alert: 'onModerationAlert', negative_spike: 'onModerationAlert', metric_alert: 'onMetricAlert', report_delivered: 'onReportDelivered', triage_assigned: 'onTriageAssigned' })[kind];
}
export async function txLocale(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<Array<{ locale: string }>>`SELECT locale::text AS locale FROM users WHERE id = ${userId}`;
  return rows[0]?.locale === 'fr' ? 'fr' : 'en';
}
export function localizedNotificationCopy(copy: { title: string; body: string; frTitle?: string; frBody?: string }, locale: string) {
  return { title: locale === 'fr' ? copy.frTitle ?? copy.title : copy.title, body: locale === 'fr' ? copy.frBody ?? copy.body : copy.body };
}
