import { describe, expect, it, vi } from 'vitest';
import { createFacebookAdapter, createFacebookEngine, FacebookApiError } from '../src/platforms/facebook/publishing';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: ['page_views_total'], adInsightFields: ['spend', 'impressions'],
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

  it('publishes link posts then a first comment with the same Page token', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
      ? response({ id: new URLSearchParams(String(init.body)).has('message') && String(init.body).includes('first') ? 'comment-1' : 'p1_2' })
      : response({})) as unknown as typeof fetch;
    const engine = createFacebookEngine(config, fetcher);
    const result = await engine.publish({ targetId: 'p1', accessToken: 'page-token', text: 'Hello', link: 'https://example.test', firstComment: 'first' });
    expect(result.remoteId).toBe('p1_2');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String((fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[1][0])).toContain('/p1_2/comments');
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
