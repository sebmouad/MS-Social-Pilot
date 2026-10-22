import { z } from 'zod';
import { PlatformApiError } from '../errors';
import { policySchema, type Policy } from './config';
import { transport } from './transport';
const tokenSchema = z.string().regex(/^\d{5,12}:[A-Za-z0-9_-]{30,50}$/);
const channelSchema = z.string().regex(/^(@[A-Za-z0-9_]{5,32}|-\d{5,20})$/);
/** Bot API method names and channel type are protocol invariants. */
export function createClient(input: Policy, send: typeof fetch = fetch, locale: 'en' | 'fr' = 'en') {
  const policy = policySchema.parse(input), request = transport(policy, send, locale);
  const fail = () => new PlatformApiError(policy.unavailable[locale], false);
  async function call(token: string, method: string, body: unknown) {
    if (!tokenSchema.safeParse(token).success) throw fail();
    const parsed = z.object({ ok: z.literal(true), result: z.unknown() }).safeParse(await request(`bot${token}/${method}`, body));
    if (!parsed.success) throw fail();
    return parsed.data.result;
  }
  return {
    async connect(token: string, channel: string) {
      if (!channelSchema.safeParse(channel).success) throw fail();
      const bot = z.object({ id: z.number().int(), is_bot: z.literal(true) }).safeParse(await call(token, 'getMe', {}));
      const chat = z.object({ id: z.number().int(), type: z.literal('channel'), title: z.string() }).safeParse(await call(token, 'getChat', { chat_id: channel }));
      if (!bot.success || !chat.success) throw fail();
      const member = z.object({ status: z.literal('administrator'), can_post_messages: z.literal(true) }).safeParse(await call(token, 'getChatMember', { chat_id: chat.data.id, user_id: bot.data.id }));
      if (!member.success) throw fail();
      return { id: String(chat.data.id), name: chat.data.title, kind: 'channel' };
    },
    async publish(token: string, channel: string, text: string) {
      if (!channelSchema.safeParse(channel).success || !text.trim() || text.length > policy.maxTextCharacters) throw fail();
      const message = z.object({ message_id: z.number().int().positive(), chat: z.object({ id: z.number().int(), type: z.literal('channel') }) }).safeParse(await call(token, 'sendMessage', { chat_id: channel, text }));
      if (!message.success || (!channel.startsWith('@') && String(message.data.chat.id) !== channel)) throw fail();
      return { remoteId: `${message.data.chat.id}:${message.data.message_id}`, state: 'published' as const, url: null };
    },
  };
}
