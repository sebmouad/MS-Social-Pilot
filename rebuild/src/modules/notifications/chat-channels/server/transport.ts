import type { z } from 'zod';
import type { chatPolicySchema } from '../config';

type Policy = z.infer<typeof chatPolicySchema>;
export type ChatSecret = { url: string } | { botToken: string; chatId: string };

// Service protocol invariants, confined to this transport: incoming-webhook path,
// bot credential/chat syntax and Telegram's sendMessage method. Root controls
// approved origins, timing and product limits without allowing arbitrary SSRF.
const slackPath = /^\/services\/[A-Za-z0-9/_-]{20,200}$/;
const botToken = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;
const chatId = /^(-?\d{3,20}|@[A-Za-z0-9_]{4,40})$/;
export function validChatSecret(kind: string, secret: ChatSecret, policy: Policy): boolean {
  if (!secret || typeof secret !== 'object') return false;
  if (kind === 'slack' && 'url' in secret) {
    try {
      const url = new URL(secret.url);
      return url.origin === policy.slackOrigin && !url.username && !url.password && !url.search && !url.hash && slackPath.test(url.pathname);
    } catch { return false; }
  }
  return kind === 'telegram' && 'botToken' in secret && botToken.test(secret.botToken) && chatId.test(secret.chatId);
}

/** No raw response/error escapes: both can contain webhook URLs or bot tokens. */
export async function deliverChat(kind: string, secret: ChatSecret, text: string, policy: Policy): Promise<'accepted' | 'rejected' | 'uncertain'> {
  if (!validChatSecret(kind, secret, policy)) return 'rejected';
  try {
    const telegram = 'botToken' in secret;
    const response = await fetch(telegram ? `${policy.telegramOrigin}/bot${secret.botToken}/sendMessage` : secret.url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(telegram ? { chat_id: secret.chatId, text, disable_web_page_preview: true } : { text }),
      redirect: 'error', signal: AbortSignal.timeout(policy.timeoutMs),
    });
    // A server failure can follow an accepted write. Never automatically retry.
    if (!response.ok) { await response.body?.cancel(); return response.status >= 500 ? 'uncertain' : 'rejected'; }
    if (telegram) {
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('ok' in body)) return 'uncertain';
      return body.ok === true ? 'accepted' : body.ok === false ? 'rejected' : 'uncertain';
    }
    const body = await response.text();
    return body.trim() === 'ok' ? 'accepted' : 'uncertain';
  } catch { return 'uncertain'; }
}
