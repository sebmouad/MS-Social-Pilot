import { inboxServiceText } from './service-copy';
import { prisma } from '@/server/data';
import { inboxPlatformIds } from '@/server/platforms/registry';
import { platformInbox } from '@/server/platforms/registry';
import { OperationError } from '@/lib/operation-error';
import { canManageInboxWorkflow, setInboxWorkflowResolved } from '@/modules/inbox/server/workflow';
import { deleteInboxCommentDurably } from '@/modules/inbox/server/deletion';
import { authorizeInbox } from '@/modules/inbox/server/access';
import type { InboxReadConstraints } from '@/modules/inbox/server/types';

export type InboxActor = { userId: string; workspaceId: string; allowedChannelIds?: readonly string[] };
export type InboxActionKind = 'message' | 'comment';
/** Reviews are resolvable and, where the module supports it, repliable; they cannot be hidden or deleted here. */
export type InboxItemKind = InboxActionKind | 'review';

async function providerForTarget(targetId: string, workspaceId: string): Promise<string> {
  const target = await prisma.target.findFirst({ where: { id: targetId, workspaceId }, select: { socialAccount: { select: { provider: true } } } });
  const provider = target?.socialAccount?.provider;
  if (!provider) throw new OperationError('unavailable', await inboxServiceText('service5'));
  return provider;
}

async function providerForItem(kind: InboxItemKind, id: string, workspaceId: string): Promise<{ provider: string; targetId: string }> {
  if (kind === 'review') {
    const rows = await prisma.$queryRaw<Array<{ targetId: string }>>`SELECT r."targetId" FROM page_reviews r JOIN targets t ON t.id = r."targetId" WHERE r.id = ${id} AND t."workspaceId" = ${workspaceId}`;
    if (!rows[0]) throw new OperationError('not_found', await inboxServiceText('service6'));
    return { provider: await providerForTarget(rows[0].targetId, workspaceId), targetId: rows[0].targetId };
  }
  const row = kind === 'message'
    ? await prisma.conversation.findFirst({ where: { id, target: { workspaceId } }, select: { target: { select: { id: true, socialAccount: { select: { provider: true } } } } } })
    : await prisma.postComment.findFirst({ where: { id, postTarget: { post: { workspaceId }, target: { workspaceId } } }, select: { postTarget: { select: { target: { select: { id: true, socialAccount: { select: { provider: true } } } } } } } });
  const target = kind === 'message'
    ? (row as { target: { id: string; socialAccount: { provider: string } | null } } | null)?.target
    : (row as { postTarget: { target: { id: string; socialAccount: { provider: string } | null } } } | null)?.postTarget.target;
  if (!target?.socialAccount?.provider) throw new OperationError('not_found', await inboxServiceText('kindUnavailable', { kind: kind === 'message' ? 'conversation' : 'comment' }));
  return { provider: target.socialAccount.provider, targetId: target.id };
}

/** The requested channel is intersected with every credential ceiling (actor and explicit); neither overwrites the other. */
async function requireVisibleChannel(actor: InboxActor, targetId: string, mode: 'read' | 'write' = 'read', constraints: InboxReadConstraints = {}) {
  const ceilings = [actor.allowedChannelIds, constraints.allowedChannelIds];
  const allowedChannelIds = ceilings.reduce<readonly string[]>((ids, ceiling) => ceiling === undefined ? ids : ids.filter(id => ceiling.includes(id)), [targetId]);
  const access = await authorizeInbox(actor, { allowedChannelIds }, mode);
  if (!access.channelIds.includes(targetId)) throw new OperationError('not_found', await inboxServiceText('service7'));
}

async function host(provider: string) {
  const value = await platformInbox(provider);
  if (!value) throw new OperationError('unavailable', await inboxServiceText('service5'));
  return value;
}

export async function canManageInbox(actor: InboxActor, targetId: string): Promise<boolean> {
  try {
    await requireVisibleChannel(actor, targetId, 'write');
    return await (await host(await providerForTarget(targetId, actor.workspaceId))).canManage(actor, targetId);
  } catch { return false; }
}

export async function syncInbox(actor: InboxActor, targetId?: string) {
  const access = await authorizeInbox(actor, actor.allowedChannelIds === undefined ? {} : { allowedChannelIds: actor.allowedChannelIds });
  if (targetId) {
    if (!access.channelIds.includes(targetId)) throw new OperationError('not_found', await inboxServiceText('service8'));
    const providerHost = await host(await providerForTarget(targetId, actor.workspaceId));
    const result = await providerHost.sync(actor, targetId);
    if (!providerHost.reviews) return result;
    return { ...result, reviewCount: await providerHost.reviews.sync(actor, targetId).then(reviewed => reviewed.reviewCount, () => 0) };
  }
  const eligibleTargets = access.channelIds.length ? await prisma.target.findMany({ where: { workspaceId: actor.workspaceId, id: { in: access.channelIds } }, select: { id: true, socialAccount: { select: { provider: true } } } }) : [];
  const eligibleProviders = new Set(eligibleTargets.map(target => target.socialAccount?.provider).filter((provider): provider is string => Boolean(provider)));
  const providers = (await inboxPlatformIds()).filter(provider => eligibleProviders.has(provider));
  if (!providers.length) throw new OperationError('unavailable', await inboxServiceText('service5'));
  const totals = { targetCount: 0, failedCount: 0, conversationCount: 0, messageCount: 0, commentCount: 0, syncedAt: new Date().toISOString() } as { targetCount: number; failedCount: number; conversationCount: number; messageCount: number; commentCount: number; reviewCount?: number; syncedAt: string };
  const errors: unknown[] = [];
  for (const provider of providers) {
    try {
      const providerHost = await host(provider);
      const result = await providerHost.sync(actor);
      // Reviews are optional: a failure reading them must not undo the conversations and comments just synced.
      if (providerHost.reviews) totals.reviewCount = (totals.reviewCount ?? 0) + await providerHost.reviews.sync(actor).then(reviewed => reviewed.reviewCount, () => 0);
      totals.targetCount += result.targetCount; totals.failedCount += result.failedCount;
      totals.conversationCount += result.conversationCount; totals.messageCount += result.messageCount; totals.commentCount += result.commentCount;
      totals.syncedAt = result.syncedAt;
    } catch (error) { errors.push(error); }
  }
  if (!totals.targetCount && errors.length) throw errors[0];
  return totals;
}

export async function replyToInbox(actor: InboxActor, input: { kind: InboxItemKind; id: string; text: string }, constraints: InboxReadConstraints = {}) {
  const item = await providerForItem(input.kind, input.id, actor.workspaceId);
  await requireVisibleChannel(actor, item.targetId, 'write', constraints);
  if (input.kind === 'review') {
    const reply = (await host(item.provider)).reviews?.reply;
    if (!reply) throw new OperationError('unavailable', await inboxServiceText('service9'));
    return reply(actor, { id: input.id, text: input.text });
  }
  return (await host(item.provider)).reply(actor, { ...input, kind: input.kind });
}
export async function setInboxResolved(actor: InboxActor, input: { kind: InboxItemKind; id: string; resolved: boolean; action?: 'resolve' }, constraints: InboxReadConstraints = {}) {
  return setInboxWorkflowResolved(actor, { kind: input.kind, id: input.id, resolved: input.resolved }, constraints);
}
export { canManageInboxWorkflow };
export async function moderateInboxComment(actor: InboxActor, input: { id: string; hidden: boolean }, constraints: InboxReadConstraints = {}) {
  const item = await providerForItem('comment', input.id, actor.workspaceId);
  await requireVisibleChannel(actor, item.targetId, 'write', constraints);
  return (await host(item.provider)).moderate(actor, input);
}
export async function deleteInboxComment(actor: InboxActor, input: { id: string; confirmation: string }, constraints: InboxReadConstraints = {}) {
  return deleteInboxCommentDurably(actor, input, constraints);
}
