import { Locale } from '@prisma/client';
import { z } from 'zod';

import { prisma } from './prisma';
import { decryptSecret, encryptSecret } from './crypto';
import { env } from './env';
import { translate } from './email/templates';

/**
 * Alerts in the team's chat: a Slack channel or a Telegram group, beside the
 * emails. Same events, same rule — sending never breaks what triggered it.
 *
 * Destinations are pinned to the two services' own hosts, so a channel can
 * never be pointed at an address inside this server's network.
 */

export const CHAT_KINDS = ['slack', 'telegram'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

export const CHAT_EVENTS = ['publishFailure', 'connectionExpired', 'approvalRequest', 'approvalDecision', 'reviewDecision'] as const;
export type ChatEvent = (typeof CHAT_EVENTS)[number];

const SLACK_HOOK = /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,200}$/;
const TELEGRAM_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;
const TELEGRAM_CHAT = /^(-?\d{3,20}|@[A-Za-z0-9_]{4,40})$/;

export const chatChannelSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('slack'),
    name: z.string().trim().min(1).max(60),
    url: z.string().trim().regex(SLACK_HOOK, 'Paste a Slack incoming webhook URL (https://hooks.slack.com/services/…).'),
    events: z.array(z.enum(CHAT_EVENTS)).min(1),
  }),
  z.object({
    kind: z.literal('telegram'),
    name: z.string().trim().min(1).max(60),
    botToken: z.string().trim().regex(TELEGRAM_TOKEN, 'Paste the bot token BotFather gave you.'),
    chatId: z.string().trim().regex(TELEGRAM_CHAT, 'A chat id such as -1001234567890, or @channelname.'),
    events: z.array(z.enum(CHAT_EVENTS)).min(1),
  }),
]);

export async function createChatChannel(workspaceId: string, input: z.infer<typeof chatChannelSchema>) {
  const secret = input.kind === 'slack' ? { url: input.url } : { botToken: input.botToken, chatId: input.chatId };
  return prisma.chatChannel.create({
    data: { workspaceId, kind: input.kind, name: input.name, events: input.events, secret: encryptSecret(JSON.stringify(secret)) },
    select: { id: true },
  });
}

/** Deliver one message to one channel. Throws on failure, for the caller to record. */
async function deliver(kind: string, secret: string, text: string): Promise<void> {
  const config = JSON.parse(decryptSecret(secret)) as { url?: string; botToken?: string; chatId?: string };
  const signal = AbortSignal.timeout(8000);
  if (kind === 'slack') {
    if (!config.url || !SLACK_HOOK.test(config.url)) throw new Error('The Slack webhook is not valid any more.');
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`Slack answered ${response.status}.`);
    return;
  }
  if (!config.botToken || !TELEGRAM_TOKEN.test(config.botToken)) throw new Error('The Telegram bot token is not valid any more.');
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: config.chatId, text, disable_web_page_preview: true }),
    signal,
    redirect: 'error',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { description?: string };
    throw new Error(body.description ? `Telegram: ${body.description}` : `Telegram answered ${response.status}.`);
  }
}

/** Tell every channel in the workspace that listens for `event`. Never throws. */
export async function sendChat(options: {
  workspaceId: string;
  event: ChatEvent;
  /** Key under `email.chat`, and its parameters. */
  key: string;
  params: Record<string, string | number>;
  /** Where in the app to look, appended as a link. */
  path?: string;
}): Promise<number> {
  try {
    const [workspace, channels] = await Promise.all([
      prisma.workspace.findUnique({ where: { id: options.workspaceId }, select: { name: true, defaultLocale: true } }),
      prisma.chatChannel.findMany({ where: { workspaceId: options.workspaceId, enabled: true, events: { has: options.event } } }),
    ]);
    if (!workspace || channels.length === 0) return 0;
    const text = chatText(workspace.defaultLocale, options.key, { workspace: workspace.name, ...options.params }, options.path);
    let sent = 0;
    for (const channel of channels) {
      try {
        await deliver(channel.kind, channel.secret, text);
        sent += 1;
        await prisma.chatChannel.update({ where: { id: channel.id }, data: { lastSentAt: new Date(), lastError: null } });
      } catch (error) {
        await prisma.chatChannel
          .update({ where: { id: channel.id }, data: { lastError: error instanceof Error ? error.message.slice(0, 300) : 'Failed.' } })
          .catch(() => undefined);
      }
    }
    return sent;
  } catch (error) {
    console.error('[chat] could not send', error);
    return 0;
  }
}

/** The message as the chat shows it: one line or two, and a link into the app. */
export function chatText(locale: Locale, key: string, params: Record<string, string | number>, path?: string): string {
  const line = translate(locale, `email.chat.${key}`, params);
  return path ? `${line}\n${env.appUrl.replace(/\/$/, '')}${path}` : line;
}

/** A test message, sent when a channel is added so a wrong id shows at once. */
export async function testChatChannel(id: string, workspaceId: string): Promise<string | null> {
  const channel = await prisma.chatChannel.findFirst({ where: { id, workspaceId }, include: { workspace: { select: { name: true, defaultLocale: true } } } });
  if (!channel) return 'Not found.';
  try {
    await deliver(channel.kind, channel.secret, chatText(channel.workspace.defaultLocale, 'test', { workspace: channel.workspace.name }));
    await prisma.chatChannel.update({ where: { id }, data: { lastSentAt: new Date(), lastError: null } });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'Failed.';
    await prisma.chatChannel.update({ where: { id }, data: { lastError: message } });
    return message;
  }
}
