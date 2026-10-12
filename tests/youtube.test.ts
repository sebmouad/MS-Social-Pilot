import { afterEach, describe, expect, it, vi } from 'vitest';

import { youtube, youtubeTitle } from '@/lib/networks/youtube';

const context = {
  credentials: { accessToken: 'token', refreshToken: 'refresh', expiresAt: new Date(Date.now() + 3_600_000), meta: {} },
  saveCredentials: async () => {},
};

describe('youtube connector', () => {
  afterEach(() => vi.restoreAllMocks());

  it('takes the title from the first line, without angle brackets', () => {
    expect(youtubeTitle('\nProduct <launch>\nMore text')).toBe('Product launch');
    expect(youtubeTitle('x'.repeat(150))).toHaveLength(100);
  });

  it('refuses a post without a video', async () => {
    await expect(youtube.publish({ providerId: 'UC1', name: 'Client A' }, { text: 't', link: null, media: [], idempotencyKey: 'k' }, context)).rejects.toMatchObject({ kind: 'rejected' });
  });

  it('opens a resumable upload, sends the bytes and returns the watch url', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { location: 'https://upload.example/session' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'abc123' }), { status: 200 }));
    const result = await youtube.publish(
      { providerId: 'UC1', name: 'Client A' },
      { text: 'Product launch\nDetails', link: null, media: [{ kind: 'video', url: 'https://a/v.mp4', mimeType: 'video/mp4', read: async () => Buffer.from('video') }], idempotencyKey: 'k' },
      context,
    );
    const metadata = JSON.parse(String(fetch.mock.calls[0]![1]!.body));
    expect(metadata.snippet).toMatchObject({ title: 'Product launch', channelId: 'UC1' });
    expect(fetch.mock.calls[1]![0]).toBe('https://upload.example/session');
    expect(result).toEqual({ remotePostId: 'abc123', remoteUrl: 'https://www.youtube.com/watch?v=abc123' });
  });
});
