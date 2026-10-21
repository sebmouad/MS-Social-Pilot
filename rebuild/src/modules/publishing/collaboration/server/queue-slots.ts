
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { randomUUID } from 'node:crypto';
import { OperationError } from '@/lib/operation-error';
import { prisma } from '@/server/data';
import { authorizePublishing } from '../../server/access';
import type { PublishingActor } from '../../server/types';
import { collaborationPorts } from '../ports';
import { replaceSlotsConfirmation, SLOTS_READ, SLOTS_REPLACE, slotKey } from '../schemas';
import { audit, bad, bounds, exact, lockActor, parse, protect, QUEUE, requireWorkspaceAdmin, transact, usableTargets } from './core';

const notOffered = (errorText: PublishingErrorText = defaultPublishingErrorText) => new PublishingOperationError('unavailable', 'collaboration_40', {}, errorText);
export type QueueSlotRecord = { id: string; targetId: string | null; dayOfWeek: number; hour: number; minute: number };

/** Shared times plus the own times of channels the caller can use; `targetId` narrows to one channel. */
export async function readQueueSlots(actor: PublishingActor, input: unknown = {}) {
  const errorText = await loadPublishingErrorText();
  const query = parse(SLOTS_READ, input, undefined, errorText);
  if (!collaborationPorts().queue) throw notOffered(errorText);
  const auth = await authorizePublishing(actor, QUEUE, 'read');
  const targets = await protect(usableTargets(auth));
  if (query.targetId && !targets.some(t => t.id === query.targetId)) throw new PublishingOperationError('not_found', 'collaboration_10', {}, errorText);
  const ids = query.targetId ? [query.targetId] : targets.map(t => t.id);
  const slots = await protect(prisma.$queryRaw<QueueSlotRecord[]>`SELECT id, "targetId", "dayOfWeek", hour, minute FROM queue_slots WHERE "workspaceId" = ${actor.workspaceId} AND ("targetId" IS NULL OR "targetId" = ANY(${ids}::text[])) ORDER BY "dayOfWeek" ASC, hour ASC, minute ASC, id ASC`);
  const canEdit = auth.permissions.features[QUEUE]?.write === true && (auth.role === 'owner' || auth.role === 'admin');
  return { slots, targets, canEditShared: canEdit && auth.permissions.pageScope.all, canEditChannels: canEdit };
}

/**
 * Replaces one timetable (shared, or one channel's own) in a single atomic step. Admin-only because the times decide when every
 * queued post goes out; the shared timetable additionally needs access to all channels. Duplicate times collapse.
 */
export async function replaceQueueSlots(actor: PublishingActor, input: unknown) {
  const errorText = await loadPublishingErrorText();
  const data = parse(SLOTS_REPLACE, input, undefined, errorText); exact(data.confirmation, replaceSlotsConfirmation(data.targetId), errorText);
  if (!collaborationPorts().queue) throw notOffered(errorText);
  const limit = await bounds();
  const unique = [...new Map(data.slots.map(s => [slotKey(s), s])).values()];
  if (unique.length > limit.queueSlotLimit) throw bad(errorText('collaboration_41', {value0: limit.queueSlotLimit}), errorText);
  const check = (auth: Awaited<ReturnType<typeof authorizePublishing>>) => {
    if (auth.role !== 'owner' && auth.role !== 'admin') throw new PublishingOperationError('forbidden', 'collaboration_42', {}, errorText);
    if (data.targetId === null) requireWorkspaceAdmin(auth, errorText('actionSharedQueue'), errorText);
  };
  check(await authorizePublishing(actor, QUEUE, 'write'));
  return protect(transact(actor.workspaceId, limit, async tx => {
    const auth = await lockActor(tx, actor, QUEUE, true); check(auth);
    if (data.targetId !== null) {
      const targets = await usableTargets(auth);
      if (!targets.some(t => t.id === data.targetId)) throw new PublishingOperationError('not_found', 'collaboration_10', {}, errorText);
    }
    const previous = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM queue_slots WHERE "workspaceId" = ${actor.workspaceId} AND "targetId" IS NOT DISTINCT FROM ${data.targetId}`;
    await tx.$executeRaw`DELETE FROM queue_slots WHERE "workspaceId" = ${actor.workspaceId} AND "targetId" IS NOT DISTINCT FROM ${data.targetId}`;
    for (const slot of unique) await tx.$executeRaw`INSERT INTO queue_slots (id, "workspaceId", "targetId", "dayOfWeek", hour, minute, "createdAt") VALUES (${`qs_${randomUUID()}`}, ${actor.workspaceId}, ${data.targetId}, ${slot.dayOfWeek}, ${slot.hour}, ${slot.minute}, NOW())`;
    await audit(tx, actor, 'publishing.queue_times_replaced', { targetId: data.targetId, before: Number(previous[0]?.count ?? 0), after: unique.length });
    await lockActor(tx, actor, QUEUE, true);
    return { targetId: data.targetId, count: unique.length, replaced: Number(previous[0]?.count ?? 0) };
  }));
}
