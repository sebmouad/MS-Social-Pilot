import { describe, expect, it, vi } from 'vitest';
import { createFacebookAdapter, createFacebookEngine, FacebookApiError } from '../src/platforms/facebook/publishing';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: ['page_views_total'], adInsightFields: ['spend', 'impressions'], maxImageUploadBytes: 1024, allowedImageMimeTypes: ['image/jpeg', 'image/png'], appSecretProofEnabled: false,
};
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
const mockFetch = (...replies: Response[]) => vi.fn(async () => replies.shift() ?? response({ data: [] })) as unknown as typeof fetch;

describe('Facebook Graph adapter', () => {
  it('builds the OAuth URL from its separately injected host without a Graph version', () => {
    const adapter = createFacebookAdapter(config, mockFetch());
    const url = new URL(adapter.getAuthorizationUrl!({ appId: 'app-1', redirectUri: 'https://app.test/callback', state: 'opaque-state', scopes: ['pages_show_list', 'pages_manage_posts'] }));
    expect(url.origin).toBe('https://www.facebook.test');
    expect(url.pathname).toBe('/dialog/oauth');
    expect(url.searchParams.get('state')).toBe('opaque-state');
    expect(url.searchParams.get('scope')).toBe('pages_show_list,pages_manage_posts');
  });

  it('uses injected version and discovers Pages and ad accounts with bounded pagination', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/v99.0/');
      if (url.includes('me/accounts')) return response({ data: [{ id: 'p1', name: 'Brand', category: 'Product', access_token: 'page-token' }] });
      return response({ data: [{ id: 'act_12', name: 'Ads', currency: 'MAD', account_status: 1 }] });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    expect(await engine.discoverPages('user-token')).toEqual([{ id: 'p1', name: 'Brand', category: 'Product', accessToken: 'page-token' }]);
    expect((await engine.discoverAdAccounts('user-token'))[0].id).toBe('act_12');
  });

  it('gets the current Facebook user identity and optional profile picture', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/v99.0/me');
      expect(url.searchParams.get('fields')).toBe('id,name,picture.type(large)');
      expect(url.searchParams.get('access_token')).toBe('user-token');
      return response({ id: 'u7', name: 'Jordan', picture: { data: { url: 'https://cdn.test/profile.jpg' } } });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    expect(await engine.getCurrentUser('user-token')).toEqual({ id: 'u7', name: 'Jordan', pictureUrl: 'https://cdn.test/profile.jpg' });
  });

  it('persists only permissions Meta reports as granted and follows the permissions edge', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/v99.0/me/permissions');
      expect(url.searchParams.get('fields')).toBe('permission,status');
      expect(url.searchParams.get('access_token')).toBe('user-token');
      return response({ data: [
        { permission: 'pages_read_engagement', status: 'granted' },
        { permission: 'pages_manage_posts', status: 'declined' },
        { permission: 'pages_read_engagement', status: 'granted' },
      ] });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    expect(await engine.getGrantedPermissions('user-token')).toEqual(['pages_read_engagement']);
  });

  it('exchanges a short-lived user token for a long-lived token and validates expiry', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/v99.0/oauth/access_token');
      expect(url.searchParams.get('grant_type')).toBe('fb_exchange_token');
      expect(url.searchParams.get('client_id')).toBe('app-id');
      expect(url.searchParams.get('client_secret')).toBe('app-secret');
      expect(url.searchParams.get('fb_exchange_token')).toBe('short-token');
      return response({ access_token: 'long-token', expires_in: 5_184_000 });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    const before = Date.now();
    const token = await engine.exchangeForLongLivedToken({ accessToken: 'short-token', appId: 'app-id', appSecret: 'app-secret' });
    expect(token.accessToken).toBe('long-token');
    expect(token.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 5_184_000_000 - 100);
    expect(token.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5_184_000_000 + 100);
  });

  it('publishes only the post and returns its id before any comment dispatch', async () => {
    const fetcher = vi.fn(async () => response({ id: 'p1_2' })) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    const result = await engine.publish({ targetId: 'p1', accessToken: 'page-token', text: 'Hello', link: 'https://example.test' });
    expect(result.remoteId).toBe('p1_2');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('/p1/feed');
  });

  it('uses a photo response post_id as the durable post identity', async () => {
    const engine = createFacebookEngine(config, mockFetch(response({ id: 'photo-1', post_id: 'p1_42' })));
    await expect(engine.publish({ targetId: 'p1', accessToken: 'page-token', text: 'photo', media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }] }))
      .resolves.toMatchObject({ remoteId: 'p1_42' });
  });

  it('sends image descriptions through the photo upload wire field', async () => {
    const singleCalls: RequestInit[] = [];
    const single = createFacebookEngine(config, vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      singleCalls.push(init ?? {});
      return response({ id: 'photo-1', post_id: 'p1_2' });
    }) as unknown as typeof fetch);
    await single.publish({ targetId: 'p1', accessToken: 'page-token', text: 'Single image', media: [{ kind: 'image', url: 'https://cdn.test/one.jpg', altText: 'A cover' }] });
    expect((singleCalls[0]?.body as URLSearchParams).get('alt_text_custom')).toBe('A cover');

    const albumCalls: RequestInit[] = [];
    const album = createFacebookEngine(config, vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      albumCalls.push(init ?? {});
      return response({ id: `result-${albumCalls.length}` });
    }) as unknown as typeof fetch);
    await album.publish({ targetId: 'p1', accessToken: 'page-token', text: 'Album', media: [
      { kind: 'image', url: 'https://cdn.test/one.jpg', altText: 'First' },
      { kind: 'image', url: 'https://cdn.test/two.jpg', altText: 'Second' },
    ] });
    expect((albumCalls[0]?.body as URLSearchParams).get('alt_text_custom')).toBe('First');
    expect((albumCalls[1]?.body as URLSearchParams).get('alt_text_custom')).toBe('Second');
  });

  it('rejects malformed explicit photo post_id instead of falling back to photo id', async () => {
    const engine = createFacebookEngine(config, mockFetch(response({ id: 'photo-1', post_id: 42 })));
    await expect(engine.publish({ targetId: 'p1', accessToken: 'page-token', text: 'photo', media: [{ kind: 'image', url: 'https://cdn.test/a.jpg' }] }))
      .rejects.toThrow(/post id/i);
  });

  it('uploads image URLs before creating an attached multi-photo post', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: String(init?.body ?? '') });
      return response({ id: calls.length === 3 ? 'post-3' : `photo-${calls.length}` });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    await engine.publish({ targetId: 'p1', accessToken: 'page-token', text: 'album', media: [
      { kind: 'image', url: 'https://cdn.test/a.jpg', altText: 'A' }, { kind: 'image', url: 'https://cdn.test/b.jpg' },
    ] });
    expect(calls.map(c => c.url)).toEqual(expect.arrayContaining([expect.stringContaining('/p1/photos'), expect.stringContaining('/p1/feed')]));
    expect(calls[0].body).toContain('published=false');
    expect(calls[2].body).toContain('attached_media%5B0%5D');
  });

  it('uploads local Page images as bounded multipart bytes and uses returned ids for album posts', async () => {
    const calls: Array<{ url: string; body: BodyInit | null | undefined }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body });
      return response({ id: calls.length === 3 ? 'post-local' : `photo-${calls.length}` });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    const jpeg = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]), mimeType: 'image/jpeg', fileName: 'launch.jpg' };
    await engine.publish({ targetId: 'p1', accessToken: 'page-token', text: 'local album', media: [
      { kind: 'image', url: 'https://unused.test/a.jpg', localFile: jpeg },
      { kind: 'image', url: 'https://unused.test/b.jpg', localFile: { ...jpeg, fileName: 'second.jpg' } },
    ] });
    const firstForm = calls[0].body as FormData;
    expect(firstForm).toBeInstanceOf(FormData);
    expect(firstForm.get('access_token')).toBe('page-token');
    expect(firstForm.get('published')).toBe('false');
    expect(firstForm.get('temporary')).toBe('true');
    expect(firstForm.get('source')).toBeInstanceOf(File);
    expect((calls[2].body as URLSearchParams).get('attached_media[0]')).toBe(JSON.stringify({ media_fbid: 'photo-1' }));
  });

  it.each([
    ['mixed image and video', [{ kind: 'image' as const, url: 'https://cdn.test/a.jpg' }, { kind: 'video' as const, url: 'https://cdn.test/a.mp4' }]],
    ['link with image', [{ kind: 'image' as const, url: 'https://cdn.test/a.jpg' }]],
  ])('rejects Facebook media combination %s before transport', async (label, media) => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    await expect(engine.publish({ targetId: 'p1', accessToken: 'page-token', text: 'post',
      ...(label === 'link with image' ? { link: 'https://example.test' } : {}), media })).rejects.toThrow(/cannot combine|not both/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'audio', url: 'https://cdn.test/a.mp3' }],
    [{ kind: 'video', url: 'media:123e4567-e89b-42d3-a456-426614174000', localFile: { bytes: new Uint8Array([1]), mimeType: 'video/mp4', fileName: 'clip.mp4' } }],
  ])('rejects an unsupported Facebook media item before transport', async media => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    await expect(engine.publish({ targetId: 'p1', accessToken: 'page-token', text: 'post', media: media as never })).rejects.toThrow(/media/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects oversized or content-mismatched local files before any provider request', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    await expect(engine.publish({ targetId: 'p1', accessToken: 'page-token', text: 'too big', media: [
      { kind: 'image', url: 'https://unused.test/a.jpg', localFile: { bytes: new Uint8Array(1025), mimeType: 'image/jpeg', fileName: 'a.jpg' } },
    ] })).rejects.toThrow(/size limit/);
    await expect(engine.publish({ targetId: 'p1', accessToken: 'page-token', text: 'wrong type', media: [
      { kind: 'image', url: 'https://unused.test/a.jpg', localFile: { bytes: new Uint8Array([0, 1, 2]), mimeType: 'image/jpeg', fileName: 'a.jpg' } },
    ] })).rejects.toThrow(/does not match/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads remote status and sends auth on delete', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'DELETE'
      ? response({ success: true }) : response({ is_published: false, created_time: '2026-01-01T00:00:00Z' })) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    expect((await engine.getStatus('token', 'p1_2')).state).toBe('scheduled');
    await engine.deletePost('token', 'p1_2');
    expect(String((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0])).toContain('access_token=token');
  });

  it('does not claim remote deletion when Graph returns success false', async () => {
    const engine = createFacebookEngine(config, mockFetch(response({ success: false })));
    await expect(engine.deletePost('token', 'p1_2')).rejects.toThrow('did not confirm post deletion');
  });

  it('does not claim comment deletion when Graph returns success false', async () => {
    const engine = createFacebookEngine(config, mockFetch(response({ success: false })));
    await expect(engine.deleteComment('token', 'comment-1')).rejects.toThrow('did not confirm comment deletion');
  });

  it.each([response({}), new Response('{', { status: 200 })])('rejects comment deletion without a valid success confirmation', async providerResponse => {
    const engine = createFacebookEngine(config, mockFetch(providerResponse));
    await expect(engine.deleteComment('token', 'comment-1')).rejects.toThrow('did not confirm comment deletion');
  });

  it('accepts comment deletion only when Graph returns success true', async () => {
    const engine = createFacebookEngine(config, mockFetch(response({ success: true })));
    await expect(engine.deleteComment('token', 'comment-1')).resolves.toBeUndefined();
  });

  it('creates campaigns in a paused state with the selected objective and returns the provider id', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/v99.0/act_12/campaigns');
      expect(init?.method).toBe('POST');
      const body = new URLSearchParams(String(init?.body));
      expect(body.get('status')).toBe('PAUSED');
      expect(body.get('objective')).toBe('OUTCOME_TRAFFIC');
      expect(body.get('special_ad_categories')).toBe('[]');
      return response({ id: 'campaign-7' });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    await expect(engine.createCampaign({ credential: { accessToken: 'token' }, accountId: 'act_12', name: 'Spring launch', objective: 'OUTCOME_TRAFFIC' })).resolves.toEqual({ remoteId: 'campaign-7' });
  });

  it('reads live configured and effective status and verifies the selected account', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/v99.0/campaign-7');
      expect(url.searchParams.get('fields')).toBe('id,name,account_id,configured_status,effective_status');
      return response({ id: 'campaign-7', name: 'Spring launch', account_id: '99', configured_status: 'PAUSED', effective_status: 'CAMPAIGN_PAUSED' });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    await expect(engine.readAdObject({ credential: { accessToken: 'token' }, accountId: 'act_99', objectId: 'campaign-7', objectType: 'campaign' })).resolves.toEqual({
      id: 'campaign-7', name: 'Spring launch', accountId: '99', configuredStatus: 'PAUSED', effectiveStatus: 'CAMPAIGN_PAUSED',
    });
    await expect(engine.readAdObject({ credential: { accessToken: 'token' }, accountId: 'act_98', objectId: 'campaign-7', objectType: 'campaign' })).rejects.toThrow(/outside the selected account/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid campaign names before making a provider request', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    await expect(engine.createCampaign({ credential: { accessToken: 'token' }, accountId: 'act_12', name: '  ', objective: 'OUTCOME_TRAFFIC' })).rejects.toThrow(/Campaign name/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reads analytics, inbox, and ad insights through configured fields', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/act_1/insights')) return response({ data: [{ spend: '4.2' }] });
      if (url.includes('/insights')) return response({ data: [{ name: 'page_views_total', values: [{ value: 7 }] }] });
      if (url.includes('/conversations')) return response({ data: [{ id: 'c1', snippet: 'Hi', updated_time: '2026-01-02T00:00:00Z', unread_count: 2, message_count: 4, messages: { data: [{ id: 'm1', message: 'Hello', created_time: '2026-01-02T00:00:00Z', from: { id: 'person-1', name: 'Visitor' } }] } }] });
      if (url.includes('/comments')) return response({ data: [{ id: 'comment-1', message: 'Question', from: { id: 'person-1', name: 'Visitor' }, created_time: '2026-01-02T00:00:00Z', parent: { id: 'parent-1' }, like_count: 2, comment_count: 1, is_hidden: false }] });
      return response({ data: [] });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    expect(await engine.getPageAnalytics('token', 'p1')).toEqual({ page_views_total: 7 });
    expect((await engine.listInbox('token', 'p1'))[0]).toMatchObject({ unreadCount: 2, messageCount: 4, messages: [{ text: 'Hello', fromName: 'Visitor', fromId: 'person-1' }] });
    expect(await engine.listComments('token', 'post-1')).toEqual([{ id: 'comment-1', message: 'Question', fromName: 'Visitor', fromId: 'person-1', createdAt: new Date('2026-01-02T00:00:00Z'), parentId: 'parent-1', likeCount: 2, replyCount: 1, isHidden: false }]);
    const calls = (fetcher as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(String(calls.find(call => String(call[0]).includes('/comments'))?.[0])).toContain('parent%7Bid%7D');
    expect(await engine.getAdInsights('token', 'act_1', new Date('2026-01-01Z'), new Date('2026-01-02Z'))).toEqual([{ spend: '4.2' }]);
  });

  it('exposes message and comment details through the neutral inbox contract', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/conversations')) return response({ data: [{ id: 'conversation-1', updated_time: '2026-01-02T00:00:00Z', messages: { data: [{ id: 'message-1', message: 'Hello', created_time: '2026-01-02T00:00:00Z', from: { id: 'visitor-1', name: 'Visitor' } }] } }] });
      if (url.includes('/comments')) return response({ data: [{ id: 'comment-1', message: 'Question', created_time: '2026-01-02T01:00:00Z', from: { id: 'visitor-2', name: 'Second visitor' }, parent: { id: 'parent-1' } }] });
      return response({ data: [] });
    }) as unknown as typeof fetch;
    const adapter = createFacebookAdapter(config, fetcher);
    const request = { credential: { accessToken: 'token' }, targetId: 'page-1' };
    expect(await adapter.listInbox!(request)).toEqual([{ id: 'message-1', text: 'Hello', createdAt: new Date('2026-01-02T00:00:00Z'), targetId: 'page-1', conversationId: 'conversation-1', authorId: 'visitor-1', authorName: 'Visitor', kind: 'message' }]);
    expect(await adapter.listComments!({ ...request, remotePostId: 'post-1' })).toEqual([{ id: 'comment-1', text: 'Question', createdAt: new Date('2026-01-02T01:00:00Z'), targetId: 'page-1', parentId: 'parent-1', authorId: 'visitor-2', authorName: 'Second visitor', kind: 'comment' }]);
  });

  it('retains every dated Page insight value and its provider period or breakdown', async () => {
    const fetcher = mockFetch(response({ data: [
      { name: 'page_media_view', period: 'day', values: [
        { end_time: '2026-01-02T00:00:00+0000', value: 4 },
        { end_time: '2026-01-03T00:00:00+0000', value: 7 },
      ] },
      { name: 'page_views_by_country', period: 'week', values: [
        { end_time: '2026-01-03T00:00:00+0000', value: { MA: 12, FR: 2 } },
      ] },
    ] }));
    const engine = createFacebookEngine(config, fetcher);
    expect(await engine.getPageInsightObservations('token', 'p1')).toEqual([
      { metric: 'page_media_view', period: 'day', endTime: new Date('2026-01-02T00:00:00Z'), value: 4, numeric: 4 },
      { metric: 'page_media_view', period: 'day', endTime: new Date('2026-01-03T00:00:00Z'), value: 7, numeric: 7 },
      { metric: 'page_views_by_country', period: 'week', endTime: new Date('2026-01-03T00:00:00Z'), value: { MA: 12, FR: 2 }, numeric: null },
    ]);
  });

  it('isolates unsupported Page insight metrics and reports the metric failure', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const metric = url.searchParams.get('metric');
      if (metric === 'unsupported_metric') return response({ error: { message: 'Unsupported metric', code: 100 } }, 400);
      return response({ data: [{ name: metric, period: 'day', values: [{ end_time: '2026-01-03T00:00:00Z', value: 9 }] }] });
    }) as unknown as typeof fetch;
    const engine = createFacebookEngine({ ...config, pageInsightMetrics: ['unsupported_metric', 'page_views_total'] }, fetcher);
    const observations = await engine.getPageInsightObservations('token', 'p1');
    expect(observations).toEqual([{ metric: 'page_views_total', period: 'day', endTime: new Date('2026-01-03T00:00:00Z'), value: 9, numeric: 9 }]);
    expect(observations.failedMetrics).toEqual([{ metric: 'unsupported_metric', message: 'Unsupported metric' }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('follows bounded Page Insights pagination for historical observations', async () => {
    const next = 'https://graph.facebook.test/v99.0/p1/insights?after=older&access_token=token';
    const fetcher = mockFetch(
      response({ data: [{ name: 'page_views_total', period: 'day', values: [{ end_time: '2026-01-03T00:00:00Z', value: 7 }] }], paging: { next } }),
      response({ data: [{ name: 'page_views_total', period: 'day', values: [{ end_time: '2026-01-02T00:00:00Z', value: 4 }] }] }),
    );
    const engine = createFacebookEngine(config, fetcher);
    const observations = await engine.getPageInsightObservations('token', 'p1');
    expect(observations.map(point => point.numeric)).toEqual([7, 4]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(vi.mocked(fetcher).mock.calls[1][0])).toBe(next);
    const latestFetcher = mockFetch(
      response({ data: [{ name: 'page_views_total', values: [{ end_time: '2026-01-03T00:00:00Z', value: 7 }] }], paging: { next } }),
      response({ data: [{ name: 'page_views_total', values: [{ end_time: '2026-01-02T00:00:00Z', value: 4 }] }] }),
    );
    expect(await createFacebookEngine(config, latestFetcher).getPageAnalytics('token', 'p1')).toEqual({ page_views_total: 7 });
  });

  it('fails closed on Graph errors and declares adapter capabilities', async () => {
    const engine = createFacebookEngine(config, mockFetch(response({ error: { message: 'No permission', code: 200 } }, 400)));
    await expect(engine.deletePost('token', 'p1_2')).rejects.toMatchObject({ message: 'No permission', status: 400 });
    expect(await createFacebookAdapter(config, mockFetch()).capabilities).toEqual({
      connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported',
      remoteDelete: 'supported', inbox: 'supported', analytics: 'supported', ads: 'supported',
    });
    expect(new FacebookApiError('x', 0)).toBeInstanceOf(Error);
  });

  it('requires the caller to supply an ad insights date range', async () => {
    const adapter = createFacebookAdapter(config, mockFetch());
    await expect(adapter.listAds!({ credential: { accessToken: 'token' }, accountId: 'act_1' })).rejects.toThrow('explicit start and end date');
  });
});
