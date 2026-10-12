import { NETWORK_RULES } from '../network-rules';
import { netJson, textWithLink, type NetworkConnector, type NetworkMedia } from './types';

/**
 * Telegram channels, through a bot the channel's owner made with @BotFather
 * and added to the channel as an administrator allowed to post. The bot token
 * is the credential; each destination is one channel (its chat id).
 */

const API = 'https://api.telegram.org';
/** Telegram's caption limit; longer text goes as its own message. */
const CAPTION_LIMIT = 1024;

interface Answer<T> {
  ok: boolean;
  result: T;
  description?: string;
}

export async function telegramCall<T>(token: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data } = await netJson<Answer<T>>('Telegram', `${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return data.result;
}

interface Message {
  message_id: number;
  chat: { id: number; username?: string };
}

function messageUrl(message: Message): string {
  const id = String(message.chat.id).replace(/^-100/, '');
  return message.chat.username ? `https://t.me/${message.chat.username}/${message.message_id}` : `https://t.me/c/${id}/${message.message_id}`;
}

function mediaItem(item: NetworkMedia, caption?: string) {
  return { type: item.kind === 'video' ? 'video' : 'photo', media: item.url, ...(caption ? { caption } : {}) };
}

export const telegram: NetworkConnector = {
  key: 'telegram',
  label: 'Telegram',
  rules: NETWORK_RULES.telegram,
  async publish(target, post, { credentials }) {
    const token = credentials.accessToken;
    const chat_id = target.providerId;
    const text = textWithLink(post);
    const caption = text.length <= CAPTION_LIMIT ? text : undefined;
    let first: Message;
    if (post.media.length === 0) {
      first = await telegramCall<Message>(token, 'sendMessage', { chat_id, text });
    } else if (post.media.length === 1) {
      const item = post.media[0]!;
      const method = item.kind === 'video' ? 'sendVideo' : 'sendPhoto';
      first = await telegramCall<Message>(token, method, { chat_id, [item.kind === 'video' ? 'video' : 'photo']: item.url, ...(caption ? { caption } : {}) });
    } else {
      const sent = await telegramCall<Message[]>(token, 'sendMediaGroup', {
        chat_id,
        media: post.media.slice(0, 10).map((item, index) => mediaItem(item, index === 0 ? caption : undefined)),
      });
      first = sent[0]!;
    }
    if (post.media.length > 0 && !caption && text) await telegramCall<Message>(token, 'sendMessage', { chat_id, text });
    return { remotePostId: `${first.chat.id}:${first.message_id}`, remoteUrl: messageUrl(first) };
  },
};
