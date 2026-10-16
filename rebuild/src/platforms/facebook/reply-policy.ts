import type { ReplyRule } from '@/server/inbox/threads';
import { formatInboxTime } from '@/server/inbox/threads';
import type { InboxReplyPolicyRequest } from '@/server/inbox/policy';
import { messengerReplyWindow, type MessengerReplyWindow } from './reply-window';

/**
 * Plain-language statement of whether and until when a reply can be sent.
 * Messages follow the platform's reply window; comment replies have no window.
 */
export function replyRule(input: { kind: 'message'; window: MessengerReplyWindow; windowHours: number; timeZone: string } | { kind: 'comment' }): ReplyRule {
  if (input.kind === 'comment') return { allowed: true, headline: 'Your reply appears publicly under this comment.' };
  const { window, windowHours, timeZone } = input;
  if (window.state === 'open') return { allowed: true, headline: `Replies are possible until ${formatInboxTime(window.until, timeZone, true)}.`, detail: `The platform allows replies for ${windowHours} ${windowHours === 1 ? 'hour' : 'hours'} after the person’s last message.` };
  if (window.state === 'closed') return { allowed: false, headline: `The reply window closed ${formatInboxTime(new Date(window.lastInboundAt.getTime() + windowHours * 3_600_000), timeZone, true)}.`, detail: 'You can reply again after the person writes to you.' };
  return { allowed: false, headline: 'There is no message from the person to reply to yet.', detail: 'Replies become possible after they write to you.' };
}

/** Provider policy is mapped to safe UI metadata without leaking credentials. */
export function facebookReplyRule(input: InboxReplyPolicyRequest, windowHours: number, now = new Date()): ReplyRule {
  return input.kind === 'comment' ? replyRule({ kind: 'comment' }) : replyRule({
    kind: 'message', window: messengerReplyWindow({ messages: input.lastInbound ? [input.lastInbound] : [], pageId: input.channelRemoteId, windowHours, now }), windowHours, timeZone: input.timeZone,
  });
}
