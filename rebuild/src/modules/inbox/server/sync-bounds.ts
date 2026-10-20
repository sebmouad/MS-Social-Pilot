import { runtimeConfig } from '@/server/config/store';

/** Platform-neutral discovery bounds a channel module applies to its conversation, message and comment-reply reads. */
export type InboxSyncBounds = { conversationPages: number; messagePages: number; replyExpansions: number };

export async function inboxSyncBounds(): Promise<InboxSyncBounds> {
  const [conversationPages, messagePages, replyExpansions] = await Promise.all([
    runtimeConfig('inbox.syncConversationPages'), runtimeConfig('inbox.syncMessagePages'), runtimeConfig('inbox.syncReplyExpansions'),
  ]);
  return { conversationPages: conversationPages as number, messagePages: messagePages as number, replyExpansions: replyExpansions as number };
}

/** True when a module read stopped early at a bound or could not expand a thread; the sync reports it instead of implying full coverage. */
export function discoveryIncomplete(...reads: ReadonlyArray<{ incomplete?: boolean } | null | undefined>): boolean {
  return reads.some(read => read?.incomplete === true);
}
