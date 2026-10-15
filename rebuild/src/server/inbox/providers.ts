import { platformModule } from '@/platforms';
import type { TargetType } from '../../../generated/client';
import { platformFor } from '@/server/platforms/registry';

/**
 * Providers whose inbox operations are wired in `./actions.ts`. A platform with
 * inbox support joins this list once its host operations exist; the screen reads
 * names, badges and capabilities from the platform registry.
 */
export const INBOX_PROVIDERS = ['facebook'] as const;

/** Channel kinds that carry an inbox, from the modules' own manifests. */
export function inboxChannelKinds(): TargetType[] {
  return [...new Set(INBOX_PROVIDERS.flatMap(id => platformModule(id)?.channelKinds.map(item => item.kind as TargetType) ?? []))];
}

export type InboxCapabilities = { reply: boolean; hide: boolean; remove: boolean };

/** What the platform adapter can do with an inbox item. Missing operations are simply not offered. */
export async function inboxCapabilities(provider: string): Promise<InboxCapabilities> {
  const adapter = await platformFor(provider, 'inbox');
  return { reply: Boolean(adapter?.replyToInbox), hide: Boolean(adapter?.hideInboxItem), remove: Boolean(adapter?.deleteInboxItem) };
}
