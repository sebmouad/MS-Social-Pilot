import { afterEach, describe, expect, it, vi } from 'vitest';

import { telegram } from '@/lib/networks/telegram';

const context = {
  credentials: { accessToken: '123456789:token', refreshToken: null, expiresAt: null, meta: {} },
  saveCredentials: async () => {},
};

function answer(result: unknown) {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

describe('telegram connector', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends text with the link and returns the public message url', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(answer({ message_id: 7, chat: { id: -1001, username: 'clienta' } }));
    const result = await telegram.publish(
      { providerId: '@clienta', name: 'Client A' },
      { text: 'Product launch', link: 'https://example.com', media: [], idempotencyKey: 'k' },
      context,
    );
    expect(String(fetch.mock.calls[0]![0])).toContain('/bot123456789:token/sendMessage');
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toEqual({ chat_id: '@clienta', text: 'Product launch\n\nhttps://example.com' });
    expect(result).toEqual({ remotePostId: '-1001:7', remoteUrl: 'https://t.me/clienta/7' });
  });

  it('sends several pictures as one album captioned on the first', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(answer([{ message_id: 9, chat: { id: -1002345 } }]));
    const read = async () => Buffer.from('');
    const result = await telegram.publish(
      { providerId: '-1002345', name: 'Private' },
      { text: 'Hi', link: null, media: [{ kind: 'image', url: 'https://a/1.jpg', read }, { kind: 'image', url: 'https://a/2.jpg', read }], idempotencyKey: 'k' },
      context,
    );
    const body = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    expect(body.media).toEqual([{ type: 'photo', media: 'https://a/1.jpg', caption: 'Hi' }, { type: 'photo', media: 'https://a/2.jpg' }]);
    expect(result.remoteUrl).toBe('https://t.me/c/2345/9');
  });

  it('reports a refusal as a failure the scheduler will not retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: false, description: 'chat not found' }), { status: 400 }));
    await expect(telegram.publish({ providerId: '@x', name: 'x' }, { text: 't', link: null, media: [], idempotencyKey: 'k' }, context)).rejects.toMatchObject({ kind: 'rejected' });
  });
});
