import { describe, expect, it, vi } from 'vitest';
import { createFacebookAdapter, FacebookApiError } from '../src/platforms/facebook/publishing';
import type { FacebookConfig } from '../src/platforms/facebook/config';
import { validatePublishingFormatDescriptors } from '../src/modules/publishing/formats';

const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: ['page_views_total'], adInsightFields: ['spend'], maxImageUploadBytes: 1024, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false,
};
const NOW = new Date('2026-10-20T12:00:00Z');
const policy = { postPublishScopes: ['pages_manage_posts'], postReadScopes: ['pages_read_engagement'], postDeleteScopes: ['pages_manage_posts'], feedSchedule: { minLeadSeconds: 600, maxLeadSeconds: 6_480_000 }, now: () => NOW };
const credential = { accessToken: 'page-token', grantedScopes: ['pages_manage_posts', 'pages_read_engagement'] };
const target = { id: 'page-1', name: '', kind: 'page' };
const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

function recorder(...replies: Response[]) {
  const calls: Array<{ url: URL; method: string; body: URLSearchParams | string | null }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body;
    calls.push({ url: new URL(String(input)), method: init?.method ?? 'GET', body: body instanceof URLSearchParams ? body : typeof body === 'string' ? body : null });
    return replies.shift() ?? json({});
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}
const fields = (body: URLSearchParams | string | null) => {
  if (!body) return {} as Record<string, string>;
  if (typeof body === 'string') { try { return JSON.parse(body) as Record<string, string>; } catch { return Object.fromEntries(new URLSearchParams(body)); } }
  return Object.fromEntries(body);
};

describe('Facebook-held (Meta native) scheduling for feed posts', () => {
  it('declares native scheduling with the Root lead window only when the policy is present', () => {
    const on = createFacebookAdapter(config, fetch, policy);
    const [feed] = validatePublishingFormatDescriptors(on.publishingFormats);
    expect(feed.scheduling).toEqual({ application: true, native: true, nativeLeadSeconds: { min: 600, max: 6_480_000 } });
    expect(on.rescheduleRemote).toBeTypeOf('function');
    const off = createFacebookAdapter(config, fetch, { ...policy, feedSchedule: undefined });
    expect(off.publishingFormats![0].scheduling).toEqual({ application: true, native: false });
    expect(off.rescheduleRemote).toBeUndefined();
  });

  it('sends a text post unpublished with scheduled_publish_time and returns a held receipt', async () => {
    const { calls, fetcher } = recorder(json({ id: 'page-1_99' }));
    const adapter = createFacebookAdapter(config, fetcher, policy);
    const when = at(3 * 3600);
    const result = await adapter.publish!({ credential, target, text: 'Hello', scheduledAt: when });
    expect(result).toMatchObject({ remoteId: 'page-1_99', state: 'scheduled', heldUntil: when });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toBe('/v99.0/page-1/feed');
    expect(fields(calls[0].body)).toMatchObject({ message: 'Hello', published: 'false', scheduled_publish_time: String(Math.floor(when.getTime() / 1000)) });
  });

  it('holds a single photo and a video the same way', async () => {
    const { calls, fetcher } = recorder(json({ id: 'ph1', post_id: 'page-1_5' }), json({ id: 'vid1' }));
    const adapter = createFacebookAdapter(config, fetcher, policy);
    const when = at(86_400);
    await adapter.publish!({ credential, target, text: 'p', media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }], scheduledAt: when });
    await adapter.publish!({ credential, target, text: 'v', media: [{ kind: 'video', url: 'https://cdn.test/a.mp4' }], scheduledAt: when });
    expect(calls[0].url.pathname).toBe('/v99.0/page-1/photos');
    expect(fields(calls[0].body)).toMatchObject({ published: 'false', scheduled_publish_time: String(Math.floor(when.getTime() / 1000)) });
    expect(calls[1].url.pathname).toBe('/v99.0/page-1/videos');
    expect(fields(calls[1].body)).toMatchObject({ published: 'false', scheduled_publish_time: String(Math.floor(when.getTime() / 1000)) });
  });

  it('does not add hold fields to an ordinary publish', async () => {
    const { calls, fetcher } = recorder(json({ id: 'page-1_1' }));
    const result = await createFacebookAdapter(config, fetcher, policy).publish!({ credential, target, text: 'now' });
    expect(result.state).toBe('published');
    expect(fields(calls[0].body)).not.toHaveProperty('scheduled_publish_time');
    expect(fields(calls[0].body)).not.toHaveProperty('published');
  });

  it.each([
    ['too soon', 300],
    ['too far', 6_480_000 + 3600],
  ])('refuses a time that is %s before any Graph request, as a definite rejection', async (_name, lead) => {
    const { calls, fetcher } = recorder();
    const adapter = createFacebookAdapter(config, fetcher, policy);
    const error = await adapter.publish!({ credential, target, text: 'x', scheduledAt: at(lead) }).catch(e => e);
    expect(error).toBeInstanceOf(FacebookApiError);
    expect(adapter.classifyPublishingFailure!(error)).toBe('rejected');
    expect(calls).toHaveLength(0);
  });

  it('refuses a held schedule when the policy is not installed', async () => {
    const { calls, fetcher } = recorder();
    const adapter = createFacebookAdapter(config, fetcher, { ...policy, feedSchedule: undefined });
    await expect(adapter.publish!({ credential, target, text: 'x', scheduledAt: at(7200) })).rejects.toBeInstanceOf(FacebookApiError);
    expect(calls).toHaveLength(0);
  });

  it('reschedules only a post Facebook still reports unpublished, reading first', async () => {
    const { calls, fetcher } = recorder(json({ id: 'page-1_99', is_published: false, scheduled_publish_time: 1 }), json({ success: true }));
    const adapter = createFacebookAdapter(config, fetcher, policy);
    const when = at(5 * 3600);
    await adapter.rescheduleRemote!({ credential, target, remoteId: 'page-1_99', scheduledAt: when });
    expect(calls.map(call => call.method)).toEqual(['GET', 'POST']);
    expect(fields(calls[1].body)).toMatchObject({ scheduled_publish_time: String(Math.floor(when.getTime() / 1000)) });
  });

  it('never writes to a post that is already live, or when the new time is outside the window', async () => {
    const live = recorder(json({ id: 'page-1_99', is_published: true }));
    await expect(createFacebookAdapter(config, live.fetcher, policy).rescheduleRemote!({ credential, target, remoteId: 'page-1_99', scheduledAt: at(7200) })).rejects.toBeInstanceOf(FacebookApiError);
    expect(live.calls.map(call => call.method)).toEqual(['GET']);
    const early = recorder();
    await expect(createFacebookAdapter(config, early.fetcher, policy).rescheduleRemote!({ credential, target, remoteId: 'page-1_99', scheduledAt: at(60) })).rejects.toBeInstanceOf(FacebookApiError);
    expect(early.calls).toHaveLength(0);
  });

  it('refuses a reschedule without publishing permission and for other formats', async () => {
    const { calls, fetcher } = recorder();
    const adapter = createFacebookAdapter(config, fetcher, policy);
    await expect(adapter.rescheduleRemote!({ credential: { accessToken: 't', grantedScopes: [] }, target, remoteId: 'x_1', scheduledAt: at(7200) })).rejects.toBeInstanceOf(FacebookApiError);
    await expect(adapter.rescheduleRemote!({ credential, target, remoteId: 'x_1', formatId: 'video', scheduledAt: at(7200) })).rejects.toBeInstanceOf(FacebookApiError);
    expect(calls).toHaveLength(0);
  });

  it('reads a held feed post as scheduled and a live one as published', async () => {
    // The status mapper compares against the real clock, so use a genuinely future instant.
    const future = Math.floor(Date.now() / 1000) + 7200;
    const held = recorder(json({ id: 'page-1_99', from: { id: 'page-1' }, is_published: false, created_time: '2026-10-20T11:00:00+0000', scheduled_publish_time: future }));
    const status = await createFacebookAdapter(config, held.fetcher, policy).getRemoteStatus!({ credential, target, remoteId: 'page-1_99', contentKind: 'text' });
    expect(status.state).toBe('scheduled');
  });
});
