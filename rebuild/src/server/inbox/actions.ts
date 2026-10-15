import { prisma } from '@/server/data';
import { inboxPlatformIds } from '@/server/platforms/registry';
import { platformInbox } from '@/server/platforms/registry';

export type InboxActor = { userId: string; workspaceId: string };
export type InboxActionKind = 'message' | 'comment';

async function providerForTarget(targetId: string, workspaceId: string): Promise<string> {
  const target = await prisma.target.findFirst({ where: { id: targetId, workspaceId }, select: { socialAccount: { select: { provider: true } } } });
  const provider = target?.socialAccount?.provider;
  if (!provider) throw new Error('This channel is unavailable in the inbox.');
  return provider;
}

async function providerForItem(kind: InboxActionKind, id: string, workspaceId: string): Promise<string> {
  const row = kind === 'message'
    ? await prisma.conversation.findFirst({ where: { id, target: { workspaceId } }, select: { target: { select: { socialAccount: { select: { provider: true } } } } } })
    : await prisma.postComment.findFirst({ where: { id, postTarget: { post: { workspaceId }, target: { workspaceId } } }, select: { postTarget: { select: { target: { select: { socialAccount: { select: { provider: true } } } } } } } });
  const provider = kind === 'message' ? (row as { target: { socialAccount: { provider: string } | null } } | null)?.target.socialAccount?.provider : (row as { postTarget: { target: { socialAccount: { provider: string } | null } } } | null)?.postTarget.target.socialAccount?.provider;
  if (!provider) throw new Error(`This ${kind === 'message' ? 'conversation' : 'comment'} is unavailable in the current workspace.`);
  return provider;
}

async function host(provider: string) {
  const value = await platformInbox(provider);
  if (!value) throw new Error('This channel is unavailable in the inbox.');
  return value;
}

export async function canManageInbox(actor: InboxActor, targetId: string): Promise<boolean> {
  try { return await (await host(await providerForTarget(targetId, actor.workspaceId))).canManage(actor, targetId); } catch { return false; }
}

export async function syncInbox(actor: InboxActor, targetId?: string) {
  if (targetId) return (await host(await providerForTarget(targetId, actor.workspaceId))).sync(actor, targetId);
  const providers = await inboxPlatformIds();
  if (!providers.length) throw new Error('This channel is unavailable in the inbox.');
  const totals = { targetCount: 0, failedCount: 0, conversationCount: 0, messageCount: 0, commentCount: 0, syncedAt: new Date().toISOString() };
  const errors: unknown[] = [];
  for (const provider of providers) {
    try {
      const result = await (await host(provider)).sync(actor);
      totals.targetCount += result.targetCount; totals.failedCount += result.failedCount;
      totals.conversationCount += result.conversationCount; totals.messageCount += result.messageCount; totals.commentCount += result.commentCount;
      totals.syncedAt = result.syncedAt;
    } catch (error) { errors.push(error); }
  }
  if (!totals.targetCount && errors.length) throw errors[0];
  return totals;
}

export async function replyToInbox(actor: InboxActor, input: { kind: InboxActionKind; id: string; text: string }) {
  return (await host(await providerForItem(input.kind, input.id, actor.workspaceId))).reply(actor, input);
}
export async function setInboxResolved(actor: InboxActor, input: { kind: InboxActionKind; id: string; resolved: boolean }) {
  return (await host(await providerForItem(input.kind, input.id, actor.workspaceId))).resolve(actor, input);
}
export async function moderateInboxComment(actor: InboxActor, input: { id: string; hidden: boolean }) {
  return (await host(await providerForItem('comment', input.id, actor.workspaceId))).moderate(actor, input);
}
export async function deleteInboxComment(actor: InboxActor, input: { id: string }) {
  return (await host(await providerForItem('comment', input.id, actor.workspaceId))).deleteComment(actor, input);
}
