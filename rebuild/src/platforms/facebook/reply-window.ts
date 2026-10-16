export type StoredInboxMessage = { fromId: string | null; createdTime: Date };
export type MessengerReplyWindow =
  | { state: 'open'; until: Date; lastInboundAt: Date }
  | { state: 'closed'; lastInboundAt: Date }
  | { state: 'no_recipient' };

/** Derive Messenger eligibility only from the newest stored visitor message. */
export function messengerReplyWindow(options: {
  messages: StoredInboxMessage[];
  pageId: string;
  windowHours: number;
  now?: Date;
}): MessengerReplyWindow {
  const lastInbound = options.messages
    .filter(message => message.fromId !== null && message.fromId !== options.pageId)
    .reduce<StoredInboxMessage | null>((latest, message) => !latest || message.createdTime > latest.createdTime ? message : latest, null);
  if (!lastInbound) return { state: 'no_recipient' };

  const until = new Date(lastInbound.createdTime.getTime() + options.windowHours * 60 * 60 * 1000);
  if ((options.now ?? new Date()).getTime() > until.getTime()) return { state: 'closed', lastInboundAt: lastInbound.createdTime };
  return { state: 'open', until, lastInboundAt: lastInbound.createdTime };
}
