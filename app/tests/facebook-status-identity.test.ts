import { describe, expect, it, vi } from 'vitest';
import { createFacebookAdapter, createFacebookEngine } from '../src/platforms/facebook/publishing';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 1024,
  allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false,
};
const credential = { accessToken: 'synthetic-page-token', grantedScopes: ['pages_read_engagement'] };
const target = { id: 'page-1', name: 'Example Page', kind: 'page' };
const futureSchedule = String(Math.floor(Date.now() / 1000) + 3600);
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
const feed = (values: Record<string, unknown> = {}) => ({ id: 'post-1', from: { id: 'page-1' }, is_published: true, created_time: '2026-10-19T10:00:00Z', ...values });
const adapter = (fetcher: typeof fetch, extra: Partial<FacebookConfig> = {}) => createFacebookAdapter({ ...config, ...extra }, fetcher, { postReadScopes: ['pages_read_engagement'] });

describe('Facebook status identity binding', () => {
  it('requests provider-owned feed fields and returns verified identity only for an exact post and Page', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('fields')).toBe('id,from,is_published,created_time,scheduled_publish_time');
      return response(feed());
    }) as unknown as typeof fetch;
    await expect(adapter(fetcher).getRemoteStatus!({ credential, remoteId: 'post-1', target, contentKind: 'text' }))
      .resolves.toEqual({ state: 'published', remoteId: 'post-1', targetId: 'page-1', publishedAt: new Date('2026-10-19T10:00:00Z') });
  });

  it('keeps mismatched IDs, Pages and malformed response identities unknown', async () => {
    for (const payload of [
      feed({ id: 'another-post' }),
      feed({ from: { id: 'another-page' } }),
      { id: 'post-1', is_published: true },
      feed({ is_published: 'true' }),
    ]) {
      const fetcher = vi.fn(async () => response(payload)) as unknown as typeof fetch;
      await expect(adapter(fetcher).getRemoteStatus!({ credential, remoteId: 'post-1', target, contentKind: 'image' }))
        .resolves.toEqual({ state: 'unknown', publishedAt: null });
    }
  });

  it('requires a valid future Unix schedule before reporting unpublished feed content as scheduled', async () => {
    const scheduled = adapter(vi.fn(async () => response(feed({ is_published: false, scheduled_publish_time: futureSchedule }))) as unknown as typeof fetch);
    await expect(scheduled.getRemoteStatus!({ credential, remoteId: 'post-1', target, contentKind: 'text' }))
      .resolves.toMatchObject({ state: 'scheduled', remoteId: 'post-1', targetId: 'page-1', publishedAt: new Date(Number(futureSchedule) * 1000) });
    for (const schedule of [undefined, 'not-a-time', String(Math.floor(Date.now() / 1000) - 60)]) {
      const fetcher = vi.fn(async () => response(feed({ is_published: false, ...(schedule === undefined ? {} : { scheduled_publish_time: schedule }) }))) as unknown as typeof fetch;
      await expect(adapter(fetcher).getRemoteStatus!({ credential, remoteId: 'post-1', target, contentKind: 'text' }))
        .resolves.toEqual({ state: 'unknown', publishedAt: null });
    }
  });

  it('rejects path-like remote identities before transport', async () => {
    const transport = vi.fn();
    for (const remoteId of ['.', '..', '../posts', 'id/edge', 'id?fields=token', 'id%2fedge']) {
      await expect(adapter(transport as unknown as typeof fetch).getRemoteStatus!({ credential, remoteId, target }))
        .resolves.toEqual({ state: 'unknown', publishedAt: null });
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it('requires a ready, explicitly published video and never treats processing or 100/33 as absence', async () => {
    const reader = (payload: unknown, status = 200) => adapter(vi.fn(async () => response(payload, status)) as unknown as typeof fetch);
    await expect(reader({ id: 'post-1', from: { id: 'page-1' }, status: { video_status: 'ready' }, published: true, created_time: '2026-10-19T10:00:00Z' })
      .getRemoteStatus!({ credential, remoteId: 'post-1', target, contentKind: 'video' }))
      .resolves.toMatchObject({ state: 'published', remoteId: 'post-1', targetId: 'page-1', publishedAt: null });
    await expect(reader({ id: 'post-1', from: { id: 'page-1' }, status: { video_status: 'processing' }, published: true })
      .getRemoteStatus!({ credential, remoteId: 'post-1', target, contentKind: 'video' }))
      .resolves.toEqual({ state: 'unknown', publishedAt: null });
    await expect(reader({ id: 'post-1', from: { id: 'page-1' }, status: { video_status: 'ready' }, published: false })
      .getRemoteStatus!({ credential, remoteId: 'post-1', target, contentKind: 'video' }))
      .resolves.toEqual({ state: 'unknown', publishedAt: null });
    await expect(reader({ error: { message: 'Unavailable', code: 100, error_subcode: 33 } }, 400)
      .getRemoteStatus!({ credential, remoteId: 'post-1', target, contentKind: 'video' }))
      .resolves.toEqual({ state: 'unknown', publishedAt: null });
  });

  it('refuses a non-Page target before reading and fingerprints provider status policy without exposing configuration', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const facebook = adapter(fetcher, { appSecret: 'synthetic-secret' });
    await expect(facebook.getRemoteStatus!({ credential, remoteId: 'post-1', target: { ...target, kind: 'group' }, contentKind: 'text' })).rejects.toThrow(/Page target/i);
    expect(fetcher).not.toHaveBeenCalled();
    expect(facebook.statusPolicyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(facebook.statusPolicyFingerprint).not.toContain('synthetic-secret');
    expect(adapter(fetcher, { graphVersion: 'v98.0' }).statusPolicyFingerprint).not.toBe(adapter(fetcher).statusPolicyFingerprint);
    expect(createFacebookAdapter(config, fetcher, { postReadScopes: ['pages_read_engagement', 'other-scope'] }).statusPolicyFingerprint)
      .not.toBe(adapter(fetcher).statusPolicyFingerprint);
    await expect(facebook.getRemoteStatus!({ credential, remoteId: 'post-1', target, formatId: 'unavailable-native-format' })).rejects.toThrow(/no status reader/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('engine refuses missing target context without dispatching a request', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const result = await createFacebookEngine(config, fetcher).getStatus('token', 'post-1', { targetId: '' });
    expect(result).toEqual({ state: 'unknown', publishedAt: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
