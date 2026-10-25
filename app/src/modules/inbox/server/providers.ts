import type { TargetType } from '../../../../generated/client';
import { platformModule } from '@/platforms';
import { inboxPlatformIds, platformFor, platformInbox } from '@/server/platforms/registry';

export async function inboxProviders(): Promise<string[]> { return inboxPlatformIds(); }
export async function inboxChannelKinds(providers?: readonly string[]): Promise<TargetType[]> {
  return [...new Set((providers ?? await inboxPlatformIds()).flatMap(id => platformModule(id)?.channelKinds.map(item => item.kind as TargetType) ?? []))];
}
/** reviews: the module reads public reviews; replyToReviews: it can also answer one. Both are absent unless the module declares them. */
export type InboxCapabilities = { reply: boolean; hide: boolean; remove: boolean; reviews: boolean; replyToReviews: boolean; privateReply: boolean };
export async function inboxCapabilities(provider: string): Promise<InboxCapabilities> {
  const [adapter, host] = await Promise.all([platformFor(provider, 'inbox'), platformInbox(provider)]);
  return { reply: Boolean(adapter?.replyToInbox), hide: Boolean(adapter?.hideInboxItem), remove: Boolean(adapter?.deleteInboxItem), reviews: Boolean(host?.reviews), replyToReviews: Boolean(host?.reviews?.reply), privateReply: Boolean(host?.privateReply) };
}

/** UI and MCP read the same selected, authorized and module-supported channels. */
export async function inboxTargetWhere(workspaceId: string, allowedTargetIds?: readonly string[], allowedProviders?: readonly string[]) {
  const installedProviders = await inboxProviders();
  const providers = allowedProviders === undefined ? installedProviders : installedProviders.filter(provider => allowedProviders.includes(provider));
  return {
    workspaceId, enabled: true, type: { in: await inboxChannelKinds(providers) },
    socialAccount: { is: { workspaceId, invalidatedAt: null, provider: { in: providers } } },
    ...(allowedTargetIds === undefined ? {} : { id: { in: [...allowedTargetIds] } }),
  };
}
