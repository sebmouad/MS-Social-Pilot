import type { MessengerReplyWindow } from './reply-window';

/** Pure helpers for inbox presentation: who spoke last, what needs a reply, and the reply rule. */

export type ThreadMessage = { fromId: string | null; sentById: string | null };

/** A message written by the channel itself: sent from this app, or authored by the channel's own account. */
export function isFromChannel(message: ThreadMessage, channelAccountId: string): boolean {
  return message.sentById !== null || (message.fromId !== null && message.fromId === channelAccountId);
}

/** A conversation needs a reply when it is open and the newest message came from the other side. */
export function conversationNeedsReply(newest: ThreadMessage | undefined, channelAccountId: string, resolved: boolean): boolean {
  return !resolved && newest !== undefined && !isFromChannel(newest, channelAccountId);
}

/** A comment needs a reply when it is open, visible, and nobody on the channel side has replied under it. */
export function commentNeedsReply(replies: ThreadMessage[], channelAccountId: string, state: { resolved: boolean; hidden: boolean }): boolean {
  return !state.resolved && !state.hidden && !replies.some(reply => isFromChannel(reply, channelAccountId));
}

export type ReplyRule = { allowed: boolean; headline: string; detail?: string };

export function formatInboxTime(date: Date, timeZone: string, withZone = false): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(withZone ? { timeZoneName: 'short' as const } : {}) }).format(date);
}

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
