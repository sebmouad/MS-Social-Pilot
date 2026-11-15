import { inboxServiceText } from './service-copy';
import { platformInbox } from '@/server/platforms/registry';
import type { ReplyRule } from './threads';

export interface InboxReplyPolicyRequest {
  kind: 'message' | 'comment';
  channelRemoteId: string;
  lastInbound: { fromId: string | null; createdTime: Date } | null;
  timeZone: string;
  /** Page language for the wording (2026-11-15); English when absent. */
  locale?: 'en' | 'fr';
}

/** Presentation metadata only. Mutations must recheck current authorization and policy. */
export async function inboxReplyPolicy(provider: string | null, input: InboxReplyPolicyRequest): Promise<ReplyRule> {
  const host = provider ? await platformInbox(provider) : null;
  return host ? host.replyPolicy(input) : { allowed: false, headline: await inboxServiceText('replyUnavailable') };
}
