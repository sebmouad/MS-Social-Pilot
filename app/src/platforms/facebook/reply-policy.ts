import type { ReplyRule } from '@/modules/inbox/server/threads';
import { formatInboxTime } from '@/modules/inbox/server/threads';
import type { InboxReplyPolicyRequest } from '@/modules/inbox/server/policy';
import { messengerReplyWindow, type MessengerReplyWindow } from './reply-window';

/**
 * Plain-language statement of whether and until when a reply can be sent.
 * Messages follow the platform's reply window; comment replies have no window.
 */
export function replyRule(input: ({ kind: 'message'; window: MessengerReplyWindow; windowHours: number; timeZone: string } | { kind: 'comment' }) & { locale?: 'en' | 'fr' }): ReplyRule {
  const fr = input.locale === 'fr';
  if (input.kind === 'comment') return { allowed: true, headline: fr ? 'Votre réponse apparaît publiquement sous ce commentaire.' : 'Your reply appears publicly under this comment.' };
  const { window, windowHours, timeZone } = input;
  const hours = windowHours === 1 ? (fr ? 'heure' : 'hour') : (fr ? 'heures' : 'hours');
  if (window.state === 'open') return { allowed: true,
    headline: fr ? `Vous pouvez répondre jusqu’au ${formatInboxTime(window.until, timeZone, true, 'fr')}.` : `Replies are possible until ${formatInboxTime(window.until, timeZone, true)}.`,
    detail: fr ? `La plateforme autorise les réponses pendant ${windowHours} ${hours} après le dernier message de la personne.` : `The platform allows replies for ${windowHours} ${hours} after the person’s last message.` };
  if (window.state === 'closed') return { allowed: false,
    headline: fr ? `La fenêtre de réponse s’est fermée le ${formatInboxTime(new Date(window.lastInboundAt.getTime() + windowHours * 3_600_000), timeZone, true, 'fr')}.` : `The reply window closed ${formatInboxTime(new Date(window.lastInboundAt.getTime() + windowHours * 3_600_000), timeZone, true)}.`,
    detail: fr ? 'Vous pourrez répondre de nouveau quand la personne vous écrira.' : 'You can reply again after the person writes to you.' };
  return { allowed: false, headline: fr ? 'La personne ne vous a pas encore écrit.' : 'There is no message from the person to reply to yet.', detail: fr ? 'Vous pourrez répondre quand elle vous aura écrit.' : 'Replies become possible after they write to you.' };
}

/** Provider policy is mapped to safe UI metadata without leaking credentials. */
export function facebookReplyRule(input: InboxReplyPolicyRequest, windowHours: number, now = new Date()): ReplyRule {
  return input.kind === 'comment' ? replyRule({ kind: 'comment', locale: input.locale }) : replyRule({ locale: input.locale,
    kind: 'message', window: messengerReplyWindow({ messages: input.lastInbound ? [input.lastInbound] : [], pageId: input.channelRemoteId, windowHours, now }), windowHours, timeZone: input.timeZone,
  });
}
