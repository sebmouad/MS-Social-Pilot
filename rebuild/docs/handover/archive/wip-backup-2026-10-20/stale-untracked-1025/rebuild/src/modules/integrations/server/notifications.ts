import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { NOTIFICATION_DEFAULTS, NOTIFICATION_FLAGS, NOTIFICATION_SCHEMA, confirmations, type IntegrationsActor, type NotificationFlag, type MUTE_EVENTS } from '../contracts';
import { audit, authorize, bad, exact, parse, protect, reachableTargets, runtime, transact } from './core';

export type NotificationMute = { targetId: string; targetName: string; event: (typeof MUTE_EVENTS)[number] };
export type NotificationView = {
  preferences: Record<NotificationFlag, boolean>; configured: boolean;
  mutes: NotificationMute[]; channels: Array<{ id: string; name: string }>; maxMutes: number;
};

/** One person's alert choices in the current workspace. No stored row means the documented defaults. */
export async function readNotifications(actor: IntegrationsActor): Promise<NotificationView> {
  const auth = await authorize(actor, 'account', false);
  const rt = await runtime();
  return protect((async () => {
    const [rows, channels] = await Promise.all([
      prisma.$queryRaw<Array<Record<NotificationFlag, boolean>>>`SELECT "onPublishFailure", "onTokenExpiry", "onApprovalRequest", "onApprovalDecision", "onNewInbox", "onQueueEmpty", "onDraftUpdated", "onModerationAlert", "onNoteMention" FROM notification_settings WHERE "userId" = ${actor.userId} AND "workspaceId" = ${actor.workspaceId}`,
      reachableTargets(auth),
    ]);
    const ids = channels.map(channel => channel.id);
    const mutes = ids.length ? await prisma.$queryRaw<Array<{ targetId: string; targetName: string; event: NotificationMute['event'] }>>`SELECT m."targetId", t.name AS "targetName", m.event FROM notification_mutes m JOIN targets t ON t.id = m."targetId" WHERE m."userId" = ${actor.userId} AND t."workspaceId" = ${actor.workspaceId} AND m."targetId" = ANY(${ids}::text[]) ORDER BY t.name ASC, m.event ASC` : [];
    const row = rows[0];
    const preferences = Object.fromEntries(NOTIFICATION_FLAGS.map(flag => [flag, typeof row?.[flag] === 'boolean' ? row[flag] : NOTIFICATION_DEFAULTS[flag]])) as Record<NotificationFlag, boolean>;
    return { preferences, configured: Boolean(row), mutes, channels, maxMutes: rt.limits.notificationMaxMutes };
  })());
}

/** Partial update of the flags and (when sent) a full replacement of the mutes the caller can reach. Atomic with its audit record. */
export async function updateNotifications(actor: IntegrationsActor, input: unknown) {
  const data = parse(NOTIFICATION_SCHEMA, input); exact(data.confirmation, confirmations.updateNotifications());
  const rt = await runtime();
  const auth = await authorize(actor, 'account', true);
  const mutes = data.mutes ? [...new Map(data.mutes.map(mute => [`${mute.targetId}\u0000${mute.event}`, mute])).values()] : undefined;
  if (mutes && mutes.length > rt.limits.notificationMaxMutes) throw bad('You have reached the limit of muted channels.');
  const changed: string[] = [];
  await protect(transact(actor, 'account', rt.limits, async tx => {
    await authorize(actor, 'account', true);
    const flags = Object.fromEntries(NOTIFICATION_FLAGS.map(flag => [flag, data[flag] ?? null])) as Record<NotificationFlag, boolean | null>;
    const d = NOTIFICATION_DEFAULTS;
    await tx.$executeRaw`INSERT INTO notification_settings (id, "userId", "workspaceId", "onPublishFailure", "onTokenExpiry", "onApprovalRequest", "onApprovalDecision", "onNewInbox", "onQueueEmpty", "onDraftUpdated", "onModerationAlert", "onNoteMention")
      VALUES (${randomUUID()}, ${actor.userId}, ${actor.workspaceId}, COALESCE(${flags.onPublishFailure}::boolean, ${d.onPublishFailure}), COALESCE(${flags.onTokenExpiry}::boolean, ${d.onTokenExpiry}), COALESCE(${flags.onApprovalRequest}::boolean, ${d.onApprovalRequest}), COALESCE(${flags.onApprovalDecision}::boolean, ${d.onApprovalDecision}), COALESCE(${flags.onNewInbox}::boolean, ${d.onNewInbox}), COALESCE(${flags.onQueueEmpty}::boolean, ${d.onQueueEmpty}), COALESCE(${flags.onDraftUpdated}::boolean, ${d.onDraftUpdated}), COALESCE(${flags.onModerationAlert}::boolean, ${d.onModerationAlert}), COALESCE(${flags.onNoteMention}::boolean, ${d.onNoteMention}))
      ON CONFLICT ("userId", "workspaceId") DO UPDATE SET "onPublishFailure" = COALESCE(${flags.onPublishFailure}::boolean, notification_settings."onPublishFailure"), "onTokenExpiry" = COALESCE(${flags.onTokenExpiry}::boolean, notification_settings."onTokenExpiry"), "onApprovalRequest" = COALESCE(${flags.onApprovalRequest}::boolean, notification_settings."onApprovalRequest"), "onApprovalDecision" = COALESCE(${flags.onApprovalDecision}::boolean, notification_settings."onApprovalDecision"), "onNewInbox" = COALESCE(${flags.onNewInbox}::boolean, notification_settings."onNewInbox"), "onQueueEmpty" = COALESCE(${flags.onQueueEmpty}::boolean, notification_settings."onQueueEmpty"), "onDraftUpdated" = COALESCE(${flags.onDraftUpdated}::boolean, notification_settings."onDraftUpdated"), "onModerationAlert" = COALESCE(${flags.onModerationAlert}::boolean, notification_settings."onModerationAlert"), "onNoteMention" = COALESCE(${flags.onNoteMention}::boolean, notification_settings."onNoteMention")`;
    for (const flag of NOTIFICATION_FLAGS) if (data[flag] !== undefined) changed.push(flag);
    if (mutes) {
      // Only channels the caller can reach right now may be muted; reads and writes stay inside this workspace.
      const reachable = await reachableTargets(auth, tx);
      const allowed = new Set(reachable.map(channel => channel.id));
      if (mutes.some(mute => !allowed.has(mute.targetId))) throw bad('Choose channels you can access.');
      const ids = reachable.map(channel => channel.id);
      if (ids.length) await tx.$executeRaw`DELETE FROM notification_mutes WHERE "userId" = ${actor.userId} AND "targetId" = ANY(${ids}::text[])`;
      for (const mute of mutes) await tx.$executeRaw`INSERT INTO notification_mutes (id, "userId", "targetId", event) VALUES (${randomUUID()}, ${actor.userId}, ${mute.targetId}, ${mute.event}) ON CONFLICT ("userId", "targetId", event) DO NOTHING`;
    }
    await audit(tx, actor, 'notifications.preferences_updated', { flags: changed, mutes: mutes?.length ?? null });
  }, 'notifications'));
  return readNotifications(actor);
}

/** Column names come only from the closed flag list, never from input. */
function flagColumn(flag: NotificationFlag) {
  if (!(NOTIFICATION_FLAGS as readonly string[]).includes(flag)) throw bad();
  return Prisma.raw(`"${flag}"`);
}

/** For delivery code (not a customer entry point): whether this person should hear about the event, honouring the switch and any channel mute. */
export async function shouldNotify(userId: string, workspaceId: string, flag: NotificationFlag, mute?: { targetId: string; event: (typeof MUTE_EVENTS)[number] }): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ enabled: boolean | null; muted: boolean }>>`SELECT (SELECT ns.${flagColumn(flag)} FROM notification_settings ns WHERE ns."userId" = ${userId} AND ns."workspaceId" = ${workspaceId}) AS enabled,
    EXISTS (SELECT 1 FROM notification_mutes m JOIN targets t ON t.id = m."targetId" WHERE m."userId" = ${userId} AND m."targetId" = ${mute?.targetId ?? ''} AND m.event = ${mute?.event ?? ''} AND t."workspaceId" = ${workspaceId}) AS muted`;
  const row = rows[0];
  if (row?.muted) return false;
  return typeof row?.enabled === 'boolean' ? row.enabled : NOTIFICATION_DEFAULTS[flag];
}
