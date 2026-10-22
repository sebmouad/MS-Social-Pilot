import { describe, it, expect, vi } from 'vitest';
import { createClient } from './client';
import { POLICY_DEFAULTS, policySchema } from './config';
import { manifest } from './manifest';
describe('staged provider boundary', () => {
  it('advertises no customer operations', () => { expect(Object.values(manifest.capabilities).every(value => value === 'unsupported')).toBe(true); });
  it('rejects insecure or credential-bearing endpoints', () => {
    for (const baseUrl of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/?token=x']) expect(policySchema.safeParse({ ...POLICY_DEFAULTS, baseUrl }).success).toBe(false);
  });
  it('refuses malformed credentials before network access', async () => {
    const send = vi.fn(); const client = createClient(POLICY_DEFAULTS, send);
    await expect(client.connect('bad', 'bad')).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
  });
  it('sanitizes transport errors without retries', async () => {
    const send = vi.fn().mockRejectedValue(new Error('secret token'));
    const client = createClient(POLICY_DEFAULTS, send, 'fr');
    await expect(client.connect('123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '@channel')).rejects.toThrow(POLICY_DEFAULTS.unavailable.fr);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

it('requires bot channel posting permission', async () => {
  const send = vi.fn();
  for (const result of [{ id: 1, is_bot: true }, { id: -10012345, type: 'channel', title: 'Example' }, { status: 'administrator', can_post_messages: false }]) send.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result })));
  await expect(createClient(POLICY_DEFAULTS, send).connect('123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '@channel')).rejects.toThrow();
  expect(send).toHaveBeenCalledTimes(3);
});
it('checks Bot API success even on HTTP 200', async () => {
  const send = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, description: 'private provider detail' })));
  await expect(createClient(POLICY_DEFAULTS, send).publish('123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '-10012345', 'Hello')).rejects.toThrow(POLICY_DEFAULTS.unavailable.en);
  expect(send).toHaveBeenCalledTimes(1);
});
it('publishes text and preserves the returned channel identity', async () => {
  const send = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { message_id: 5, chat: { id: -10012345, type: 'channel' } } })));
  expect(await createClient(POLICY_DEFAULTS, send).publish('123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', '-10012345', 'Hello')).toEqual({ remoteId: '-10012345:5', state: 'published', url: null });
});
