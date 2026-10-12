import { afterEach, describe, expect, it, vi } from 'vitest';

import { pickPrivacy, tiktok } from '@/lib/networks/tiktok';

const context = {
  credentials: { accessToken: 'token', refreshToken: 'refresh', expiresAt: new Date(Date.now() + 3_600_000), meta: {} },
  saveCredentials: async () => {},
};

describe('tiktok connector', () => {
  afterEach(() => vi.restoreAllMocks());

  it('posts as openly as the creator allows', () => {
    expect(pickPrivacy(['SELF_ONLY', 'PUBLIC_TO_EVERYONE'])).toBe('PUBLIC_TO_EVERYONE');
    expect(pickPrivacy(['SELF_ONLY'])).toBe('SELF_ONLY');
  });

  it('refuses a post without a video', async () => {
    await expect(tiktok.publish({ providerId: 'o', name: 'Client A' }, { text: 't', link: null, media: [], idempotencyKey: 'k' }, context)).rejects.toMatchObject({ kind: 'rejected' });
  });

  it('asks the privacy options, opens an upload and sends the video in one chunk', async () => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ data: { privacy_level_options: ['SELF_ONLY'] } }))
      .mockResolvedValueOnce(json({ data: { publish_id: 'p1', upload_url: 'https://upload.example/u' } }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    const result = await tiktok.publish(
      { providerId: 'o', name: 'Client A' },
      { text: 'Product launch', link: null, media: [{ kind: 'video', url: 'https://a/v.mp4', read: async () => Buffer.from('video') }], idempotencyKey: 'k' },
      context,
    );
    const init = JSON.parse(String(fetch.mock.calls[1]![1]!.body));
    expect(init.post_info).toEqual({ title: 'Product launch', privacy_level: 'SELF_ONLY' });
    expect(init.source_info).toMatchObject({ source: 'FILE_UPLOAD', video_size: 5, total_chunk_count: 1 });
    expect((fetch.mock.calls[2]![1]!.headers as Record<string, string>)['content-range']).toBe('bytes 0-4/5');
    expect(result.remotePostId).toBe('p1');
  });
});
