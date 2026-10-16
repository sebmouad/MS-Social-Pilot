import type { TargetType } from '../../../generated/client';
import { platformModule } from '@/platforms';
import { inboxPlatformIds, platformFor } from '@/server/platforms/registry';

export async function inboxProviders(): Promise<string[]> { return inboxPlatformIds(); }
export async function inboxChannelKinds(providers?: readonly string[]): Promise<TargetType[]> {
  return [...new Set((providers ?? await inboxPlatformIds()).flatMap(id => platformModule(id)?.channelKinds.map(item => item.kind as TargetType) ?? []))];
}
export type InboxCapabilities = { reply: boolean; hide: boolean; remove: boolean };
export async function inboxCapabilities(provider: string): Promise<InboxCapabilities> {
  const adapter = await platformFor(provider, 'inbox');
  return { reply: Boolean(adapter?.replyToInbox), hide: Boolean(adapter?.hideInboxItem), remove: Boolean(adapter?.deleteInboxItem) };
}

/** UI and MCP read the same selected, authorized and module-supported channels. */
export async function inboxTargetWhere(workspaceId: string, allowedTargetIds?: readonly string[]) {
  const providers = await inboxProviders();
  return {
    workspaceId, enabled: true, type: { in: await inboxChannelKinds(providers) },
    socialAccount: { is: { workspaceId, invalidatedAt: null, provider: { in: providers } } },
    ...(allowedTargetIds === undefined ? {} : { id: { in: [...allowedTargetIds] } }),
  };
}
