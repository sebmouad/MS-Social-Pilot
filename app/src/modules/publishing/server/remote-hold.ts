
import { PublishingOperationError, defaultPublishingErrorText, type PublishingErrorText } from '@/modules/publishing/error-catalog';
import { loadPublishingErrorText } from '@/modules/publishing/server/error-copy';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { OperationError } from '@/lib/operation-error';
import { platformFor } from '@/server/platforms/registry';
import { runtimeConfig } from '@/server/config/store';
import { validateSelectedPublishingFormat } from '@/modules/publishing/formats';
import { readPublishingCredential } from '@/modules/publishing/server/credentials';
import { remoteHoldDecision } from '@/modules/publishing/remote-scheduling';
import type { PublishingActor } from './types';

/**
 * Destinations whose platform is holding the post (`scheduled_remote`). Moving or cancelling them acts on the platform first,
 * through the destination's own module, and only then on local records. Nothing here names a provider.
 */
const targetSelect = { id: true, name: true, type: true, providerId: true, canPublish: true, enabled: true, accessToken: true,
  socialAccount: { select: { provider: true, invalidatedAt: true, tokenExpiresAt: true, scopes: true } } } as const;

export async function heldDestinations(workspaceId: string, postId: string) {
  return prisma.postTarget.findMany({
    where: { postId, status: 'scheduled_remote', remotePostId: { not: null }, post: { workspaceId } },
    select: { id: true, targetId: true, formatId: true, remotePostId: true, post: { select: { format: true } }, target: { select: targetSelect } },
  });
}
type Held = Awaited<ReturnType<typeof heldDestinations>>[number];

const unavailable = (what: string, errorText: PublishingErrorText = defaultPublishingErrorText) => new PublishingOperationError('conflict', 'value0CheckThePlatformRefreshThePostStatusThen', {value0: what}, errorText);

async function adapterFor(item: Held) {
  const errorText = await loadPublishingErrorText();
  const provider = item.target.socialAccount?.provider;
  const adapter = provider ? await platformFor(provider, 'publishing') : null;
  if (!adapter) throw unavailable('This destination is no longer available.', errorText);
  return adapter;
}

/** Move every platform-held destination to a new time the platform accepts; local records change only after all succeed. */
export async function rescheduleHeldDestinations(actor: PublishingActor, signal: AbortSignal, postId: string, scheduledAt: Date) {
  const errorText = await loadPublishingErrorText();
  const rows = await heldDestinations(actor.workspaceId, postId);
  const margin = Number(await runtimeConfig('publishing.remoteScheduling.leadMarginSeconds'));
  let moved = 0;
  for (const item of rows) {
    signal.throwIfAborted();
    const adapter = await adapterFor(item);
    const descriptor = validateSelectedPublishingFormat(adapter.publishingFormats, item.formatId ?? item.post.format, { media: [] });
    if (!remoteHoldDecision(descriptor, scheduledAt, new Date(), margin).hold || !adapter.rescheduleRemote) {
      throw new OperationError('invalid_request', moved
        ? `${item.target.name} cannot hold that time. ${moved} destination(s) already moved; choose another time or cancel the schedule.`
        : `${item.target.name} cannot hold that time. Choose a time within the platform's allowed range, or cancel the schedule and use application scheduling.`);
    }
    const credential = readPublishingCredential(item.target, adapter, 'publishing');
    if (!credential) throw unavailable(`${item.target.name} needs to be reconnected.`, errorText);
    try {
      await adapter.rescheduleRemote({ credential, target: { id: item.target.providerId, name: '', kind: item.target.type }, remoteId: item.remotePostId!, formatId: item.formatId ?? item.post.format, scheduledAt, signal });
    } catch {
      throw unavailable(`The platform did not confirm the new time for ${item.target.name}${moved ? `; ${moved} destination(s) already moved` : ''}.`, errorText);
    }
    await prisma.$executeRaw`UPDATE post_targets SET "nativeScheduledFor" = ${scheduledAt} WHERE id = ${item.id} AND "postId" = ${postId} AND status::text = 'scheduled_remote'`;
    moved++;
  }
  return { moved };
}

/**
 * Remove the platform-held copy of each destination, but only while the platform still reports it as scheduled; a post that has
 * gone live is never deleted by a cancel. Released destinations get fresh rows so their next publication starts a new journal entry.
 */
export async function cancelHeldDestinations(actor: PublishingActor, signal: AbortSignal, postId: string) {
  const errorText = await loadPublishingErrorText();
  const rows = await heldDestinations(actor.workspaceId, postId);
  let released = 0;
  for (const item of rows) {
    signal.throwIfAborted();
    const adapter = await adapterFor(item);
    const formatId = item.formatId ?? item.post.format;
    const reader = readPublishingCredential(item.target, adapter, 'remoteStatus');
    const deleter = readPublishingCredential(item.target, adapter, 'remoteDelete');
    if (!adapter.getRemoteStatus || !adapter.deleteRemote || !reader || !deleter) throw unavailable(`${item.target.name} needs to be reconnected.`, errorText);
    const targetRef = { id: item.target.providerId, name: '', kind: item.target.type };
    const status = await adapter.getRemoteStatus({ credential: reader, target: targetRef, remoteId: item.remotePostId!, formatId, signal }).catch(() => null);
    if (!status || status.state !== 'scheduled') {
      throw unavailable(status?.state === 'published' ? `${item.target.name} has already published this post, so the schedule cannot be cancelled.` : `The platform did not confirm that it is still holding the post for ${item.target.name}.`, errorText);
    }
    try { await adapter.deleteRemote({ credential: deleter, remoteId: item.remotePostId!, formatId, signal }); }
    catch { throw unavailable(`The platform did not confirm the removal for ${item.target.name}${released ? `; ${released} destination(s) already released` : ''}.`, errorText); }
    await prisma.$transaction(async tx => {
      await tx.postTarget.deleteMany({ where: { id: item.id, postId, status: 'scheduled_remote', post: { workspaceId: actor.workspaceId } } });
      await tx.postTarget.create({ data: { id: randomUUID(), postId, targetId: item.targetId, formatId: item.formatId, status: 'pending' } });
    });
    released++;
  }
  return { released };
}
