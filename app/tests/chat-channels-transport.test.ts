import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverChat, validChatSecret } from '@/modules/notifications/chat-channels/server/transport';
import { CHAT_POLICY, CHAT_COPY, chatCopySchema, chatPolicySchema } from '@/modules/notifications/chat-channels/config';

const slack = { url: 'https://hooks.slack.com/services/T00000000/B00000000/abcdefghijklmnopqrstuv' };
const telegram = { botToken: `12345678:${'a'.repeat(35)}`, chatId: '-1001234567890' };
afterEach(() => vi.unstubAllGlobals());
describe('chat service transport and Root policy', () => {
  it.each(['http://hooks.slack.com/services/abcdefghijklmnopqrstuv', 'https://127.0.0.1/services/abcdefghijklmnopqrstuv', 'https://hooks.slack.com.evil.test/services/abcdefghijklmnopqrstuv', 'https://user:password@hooks.slack.com/services/abcdefghijklmnopqrstuv', slack.url + '?secret=x', slack.url + '#x'])('rejects unsafe destinations: %s', url => {
    expect(validChatSecret('slack', { url }, CHAT_POLICY)).toBe(false);
  });
  it('accepts the documented legacy secret formats', () => {
    expect(validChatSecret('slack', slack, CHAT_POLICY)).toBe(true);
    expect(validChatSecret('telegram', telegram, CHAT_POLICY)).toBe(true);
    expect(validChatSecret('unknown', telegram, CHAT_POLICY)).toBe(false);
    expect(validChatSecret('telegram', { ...telegram, chatId: 'http://internal' }, CHAT_POLICY)).toBe(false);
  });
  it('uses configured timeout, blocks redirects and sends once', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('ok')); vi.stubGlobal('fetch', fetch);
    const signal = vi.spyOn(AbortSignal, 'timeout');
    expect(await deliverChat('slack', slack, 'hello', { ...CHAT_POLICY, timeoutMs: 987 })).toBe('accepted');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', body: JSON.stringify({ text: 'hello' }) });
    expect(signal).toHaveBeenCalledWith(987); signal.mockRestore();
  });
  it('requires Telegram semantic acceptance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, description: 'private-token' }))));
    expect(await deliverChat('telegram', telegram, 'hello', CHAT_POLICY)).toBe('rejected');
  });
  it.each([new Response('server error', { status: 500 }), new Response('not a receipt')])('holds unconfirmed HTTP responses without retries', async response => {
    const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', fetch);
    expect(await deliverChat('slack', slack, 'hello', CHAT_POLICY)).toBe('uncertain'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not leak credential-bearing network errors', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error(slack.url)); vi.stubGlobal('fetch', fetch);
    expect(await deliverChat('slack', slack, 'hello', CHAT_POLICY)).toBe('uncertain');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('validates Root timing and approved origins', () => {
    expect(chatPolicySchema.safeParse(CHAT_POLICY).success).toBe(true);
    expect(chatPolicySchema.safeParse({ ...CHAT_POLICY, transactionTimeoutMs: CHAT_POLICY.timeoutMs }).success).toBe(false);
    expect(chatPolicySchema.safeParse({ ...CHAT_POLICY, telegramOrigin: 'https://internal' }).success).toBe(false);
    expect(chatCopySchema.safeParse(CHAT_COPY).success).toBe(true);
    expect(chatCopySchema.safeParse({ ...CHAT_COPY, fr: { title: '' } }).success).toBe(false);
  });
});

it('upgrades saved chat policy and localized catalogs while preserving Root overrides', () => {
  const {deliveryBatchSize:_batch,deliveryLeaseSeconds:_lease,ownerLimit:_owners,...oldPolicy}=CHAT_POLICY;
  expect(chatPolicySchema.parse(oldPolicy)).toMatchObject({deliveryBatchSize:25,deliveryLeaseSeconds:300,ownerLimit:50});
  const oldCopy=JSON.parse(JSON.stringify(CHAT_COPY));
  for(const locale of ['en','fr']) {
    oldCopy[locale].title='Customized '+locale;
    for(const key of ['inboxAlert','inboxAlertMessage','operatorIncident','operatorIncidentMessage']) delete oldCopy[locale][key];
  }
  const upgraded=chatCopySchema.parse(oldCopy);
  expect(upgraded.fr.title).toBe('Customized fr'); expect(upgraded.en.title).toBe('Customized en');
  expect(upgraded.fr.inboxAlert).toBe(CHAT_COPY.fr.inboxAlert); expect(upgraded.en.operatorIncidentMessage).toBe(CHAT_COPY.en.operatorIncidentMessage);
});
