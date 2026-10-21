import { describe, expect, it, vi } from 'vitest';
import { createInstagramAdapter, createInstagramCollector } from '../src/platforms/instagram/adapter';
import { INSTAGRAM_CONFIG, INSTAGRAM_POLICY_DEFAULTS, instagramPolicySchema } from '../src/platforms/instagram/config';
import { createInstagramGraph, InstagramError } from '../src/platforms/instagram/transport';
import { createSelectedInstagramDiscovery } from '../src/platforms/instagram/discovery';
import { normalizeInstagramAudience, normalizeInstagramInsights, type InstagramInsight } from '../src/platforms/instagram/insights';
import type { PublishRequest } from '../src/platforms/types';

const policy = { ...INSTAGRAM_POLICY_DEFAULTS, appSecretProofEnabled: false, pollAttempts: 2 };
const credential = { accessToken: 'fixture-token', grantedScopes: [...new Set([...policy.readScopes, ...policy.publishScopes, ...policy.commentScopes, ...policy.insightScopes])] };
const target = { id: 'ig-one', name: 'Example studio', kind: 'professional' };
const request: PublishRequest = { credential, target, text: 'Example caption', media: [{ kind: 'image', url: 'https://media.example.test/photo.jpg' }] };
function fixture(responses: Array<unknown | Error>) {
  const calls: Array<{ path: string; method: string; fields: URLSearchParams; headers: Headers }> = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, method: init?.method ?? 'GET', fields: init?.body instanceof URLSearchParams ? init.body : url.searchParams, headers: new Headers(init?.headers) });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (response === undefined) throw new Error('Unexpected fixture request');
    return new Response(JSON.stringify(response), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const finished = { status_code: 'FINISHED' };

describe('Instagram platform fixtures', () => {
  it('declares Root-owned typed policy and keeps the module disabled', () => {
    expect(instagramPolicySchema.parse(INSTAGRAM_POLICY_DEFAULTS)).toEqual(INSTAGRAM_POLICY_DEFAULTS);
    expect(INSTAGRAM_CONFIG.find(setting => setting.key === 'platforms.instagram.enabled')?.defaultValue).toBe(false);
    expect(INSTAGRAM_CONFIG.every(setting => setting.owner.id === 'instagram')).toBe(true);
    expect(() => instagramPolicySchema.parse({ ...policy, graphBaseUrl: 'https://user:secret@example.test' })).toThrow();
    expect(() => instagramPolicySchema.parse({ ...policy, carouselMax: 11 })).toThrow();
  });
  it('publishes an image and obtains the real permalink', async () => {
    const f = fixture([{ id: 'container' }, finished, { id: 'published' }, { permalink: 'https://www.instagram.com/p/real-code/' }]);
    const result = await createInstagramAdapter(policy, { fetch: f.fetcher }).publish!(request);
    expect(result).toEqual({ remoteId: 'published', state: 'published', url: 'https://www.instagram.com/p/real-code/' });
    expect(f.calls.map(call => call.path)).toEqual(['/v26.0/ig-one/media', '/v26.0/container', '/v26.0/ig-one/media_publish', '/v26.0/published']);
    expect(f.calls[0]!.fields.get('image_url')).toBe(request.media![0]!.url);
    expect(f.calls[0]!.headers.get('authorization')).toBe('Bearer fixture-token');
  });
  it('publishes mixed carousel children only after each is ready', async () => {
    const f = fixture([{ id: 'image-child' }, finished, { id: 'video-child' }, finished, { id: 'parent' }, finished, { id: 'post' }, {}]);
    await createInstagramAdapter(policy, { fetch: f.fetcher }).publish!({ ...request, formatId: 'carousel', media: [...request.media!, { kind: 'video', url: 'https://media.example.test/clip.mp4' }] });
    expect(f.calls[0]!.fields.get('is_carousel_item')).toBe('true');
    expect(f.calls[2]!.fields.get('media_type')).toBe('VIDEO');
    expect(f.calls[4]!.fields.get('children')).toBe('image-child,video-child');
    expect(f.calls[6]!.fields.get('creation_id')).toBe('parent');
  });
  it('uses REELS for a single video and waits through processing', async () => {
    const f = fixture([{ id: 'reel' }, { status_code: 'IN_PROGRESS' }, finished, { id: 'post' }, new Error('optional read failed')]);
    const wait = vi.fn(async () => {});
    const result = await createInstagramAdapter(policy, { fetch: f.fetcher, wait }).publish!({ ...request, formatId: 'reel', media: [{ kind: 'video', url: 'https://media.example.test/clip.mp4' }] });
    expect(f.calls[0]!.fields.get('media_type')).toBe('REELS');
    expect(wait).toHaveBeenCalledWith(policy.pollIntervalMs, undefined);
    expect(result).toMatchObject({ state: 'published', remoteId: 'post', url: null });
  });
  it.each(['ERROR', 'EXPIRED'])('never publishes a container in %s state', async status_code => {
    const f = fixture([{ id: 'container' }, { status_code }]);
    await expect(createInstagramAdapter(policy, { fetch: f.fetcher }).publish!(request)).rejects.toMatchObject({ outcome: 'rejected' });
    expect(f.calls).toHaveLength(2);
  });
  it('holds exhausted polls and never repeats a published-container submission', async () => {
    for (const statuses of [[{ status_code: 'IN_PROGRESS' }, { status_code: 'IN_PROGRESS' }], [{ status_code: 'PUBLISHED' }]]) {
      const f = fixture([{ id: 'container' }, ...statuses]);
      const adapter = createInstagramAdapter(policy, { fetch: f.fetcher, wait: async () => {} });
      await expect(adapter.publish!(request)).rejects.toMatchObject({ outcome: 'uncertain' });
      expect(f.calls.some(call => call.path.endsWith('media_publish'))).toBe(false);
    }
  });
  it('never retries a lost media_publish response', async () => {
    const f = fixture([{ id: 'container' }, finished, new Error('connection lost fixture-token')]);
    const adapter = createInstagramAdapter(policy, { fetch: f.fetcher });
    const error = await adapter.publish!(request).catch(error => error);
    expect(error.message).not.toContain('fixture-token');
    expect(adapter.classifyPublishingFailure!(error)).toBe('uncertain');
    expect(f.calls.filter(call => call.path.endsWith('media_publish'))).toHaveLength(1);
  });
  it('refuses invalid media, formats, schedules and overlong Unicode captions before I/O', async () => {
    const f = fixture([]); const adapter = createInstagramAdapter(policy, { fetch: f.fetcher });
    const changes: Array<Partial<PublishRequest>> = [{ media: [] }, { formatId: 'story' }, { link: 'https://example.test' }, { scheduledAt: new Date() }, { text: '🙂'.repeat(policy.captionLength + 1) }, { media: [{ kind: 'image', url: 'http://example.test/photo.jpg' }] }, { media: [{ kind: 'image', url: 'https://example.test/photo.jpg', altText: 'Unsupported' }] }, { formatId: 'reel' }];
    for (const change of changes) await expect(adapter.publish!({ ...request, ...change })).rejects.toMatchObject({ outcome: 'rejected' });
    expect(f.calls).toHaveLength(0);
  });
  it('fails closed for missing scopes, including first comments', async () => {
    const f = fixture([]); const adapter = createInstagramAdapter(policy, { fetch: f.fetcher });
    expect(adapter.canUseCredential!({ accessToken: 'token' }, 'publishing')).toBe(false);
    await expect(adapter.publish!({ ...request, credential: { accessToken: 'token' } })).rejects.toMatchObject({ outcome: 'rejected' });
    await expect(adapter.publishFirstComment!({ credential: { ...credential, grantedScopes: policy.publishScopes }, remotePostId: 'post', text: 'First' })).rejects.toMatchObject({ outcome: 'rejected' });
    expect(f.calls).toHaveLength(0);
  });
  it('requires a matching owner and final media shape for published status', async () => {
    const data = { id: 'post', owner: { id: 'ig-one' }, timestamp: '2026-10-20T12:00:00Z', media_type: 'IMAGE' };
    const f = fixture([data, { ...data, owner: { id: 'other' } }, { ...data, timestamp: 'invalid' }]);
    const adapter = createInstagramAdapter(policy, { fetch: f.fetcher });
    expect(await adapter.getRemoteStatus!({ credential, target, remoteId: 'post' })).toMatchObject({ state: 'published', targetId: target.id });
    expect(await adapter.getRemoteStatus!({ credential, target, remoteId: 'post' })).toEqual({ state: 'unknown' });
    expect(await adapter.getRemoteStatus!({ credential, target, remoteId: 'post' })).toEqual({ state: 'unknown' });
  });
  it('declares installed connection and analytics while refusing unsupported deletion and ads', () => {
    const adapter = createInstagramAdapter(policy);
    expect(adapter.deleteRemote).toBeUndefined();
    expect(adapter.capabilities).toMatchObject({ remoteDelete: 'unsupported', connection: 'supported', discovery: 'supported', analytics: 'supported', ads: 'unsupported' });
    expect(adapter.publishingFormats!.every(format => !format.remoteDelete && !format.scheduling.native)).toBe(true);
  });
  it('discovers only provided selected Pages and deduplicates linked accounts', async () => {
    const f = fixture([{ instagram_business_account: { id: 'ig-one', username: 'studio' } }, { instagram_business_account: { id: 'ig-one' } }, {}]);
    const result = await createSelectedInstagramDiscovery(policy, { fetch: f.fetcher })([{ id: 'selected-one', name: 'One', accessToken: 'page-token' }, { id: 'selected-two', name: 'Two', accessToken: 'page-token' }, { id: 'selected-three', name: 'Three', accessToken: 'page-token' }]);
    expect(result).toEqual([{ igUserId: 'ig-one', username: 'studio', pageId: 'selected-one', pageAccessToken: 'page-token' }]);
    expect(f.calls.every(call => !call.path.includes('me/accounts'))).toBe(true);
  });
  it('uses signed requests and refuses missing signing secret before dispatch', async () => {
    const f = fixture([{ id: 'post' }]);
    await expect(createInstagramGraph(INSTAGRAM_POLICY_DEFAULTS, { fetch: f.fetcher }).request('post', 'token')).rejects.toMatchObject({ outcome: 'rejected' });
    await createInstagramGraph(INSTAGRAM_POLICY_DEFAULTS, { fetch: f.fetcher, appSecret: 'fixture-secret' }).request('post', 'token');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.fields.get('appsecret_proof')).toMatch(/^[a-f0-9]{64}$/);
  });
  it('paginates using cursors without following untrusted next URLs and discloses truncation', async () => {
    const f = fixture([{ data: [{ id: 'a' }], paging: { next: 'https://evil.example/steal', cursors: { after: 'next' } } }, { data: [{ id: 'b' }] }]);
    const result = await createInstagramGraph(policy, { fetch: f.fetcher }).list('post/comments', 'token');
    expect(result).toEqual({ items: [{ id: 'a' }, { id: 'b' }], truncated: false });
    expect(f.calls[1]!.fields.get('after')).toBe('next');
    const clipped = fixture([{ data: [], paging: { next: 'https://evil.example' } }]);
    expect((await createInstagramGraph(policy, { fetch: clipped.fetcher }).list('post/comments', 'token')).truncated).toBe(true);
  });
  it('returns root comments and replies with stable parent identities', async () => {
    const f = fixture([{ owner: { id: target.id } }, { data: [{ id: 'comment', text: 'Question', timestamp: '2026-10-20T12:00:00Z', from: { id: 'visitor', username: 'Guest' } }] }, { data: [{ id: 'reply', text: 'Answer', timestamp: '2026-10-20T13:00:00Z' }] }]);
    const rows = await createInstagramAdapter(policy, { fetch: f.fetcher }).listComments!({ credential, targetId: target.id, remotePostId: 'post' });
    expect(rows).toMatchObject([{ id: 'comment', parentId: null, authorName: 'Guest' }, { id: 'reply', parentId: 'comment' }]);
  });
  it('refuses comments for media owned by another account', async () => {
    const f = fixture([{ owner: { id: 'other' } }]);
    await expect(createInstagramAdapter(policy, { fetch: f.fetcher }).listComments!({ credential, targetId: target.id, remotePostId: 'post' })).rejects.toMatchObject({ outcome: 'rejected' });
    expect(f.calls).toHaveLength(1);
  });
  it('writes first comments, replies, hide and delete using their distinct protocol edges', async () => {
    const f = fixture([{ id: 'first' }, { id: 'reply' }, { success: true }, { success: true }]); const adapter = createInstagramAdapter(policy, { fetch: f.fetcher });
    await adapter.publishFirstComment!({ credential, remotePostId: 'post', text: 'First' });
    await adapter.replyToInbox!({ credential, targetId: target.id, remoteId: 'comment', text: 'Reply' });
    await adapter.hideInboxItem!({ credential, targetId: target.id, remoteId: 'comment', hidden: true });
    await adapter.deleteInboxItem!({ credential, targetId: target.id, remoteId: 'comment' });
    expect(f.calls.map(call => [call.path, call.method])).toEqual([['/v26.0/post/comments', 'POST'], ['/v26.0/comment/replies', 'POST'], ['/v26.0/comment', 'POST'], ['/v26.0/comment', 'DELETE']]);
    expect(f.calls[2]!.fields.get('hide')).toBe('true');
  });
  it('retains partial account insights and arbitrary provider fields', async () => {
    const raw = { name: 'views', period: 'day', total_value: { value: 12 }, future_field: { retained: true } };
    const f = fixture([{ data: [raw] }, new Error('unsupported reach')]);
    const collected = await createInstagramCollector(policy, { fetch: f.fetcher }).account({ credential, targetId: target.id, since: new Date('2026-10-01'), until: new Date('2026-10-21') });
    expect(collected.failedMetrics).toEqual(['reach']);
    expect(collected.rows[0]).toMatchObject({ metric: 'views', value: 12, rangeTotal: true, raw });
    expect(f.calls[0]!.fields.get('metric_type')).toBe('total_value');
    expect(f.calls[1]!.fields.get('metric_type')).toBe('time_series');
  });
  it('collects post insights independently and retains unsupported metrics as failures', async () => {
    const f = fixture(policy.postMetrics.map(name => ({ data: [{ name, period: 'lifetime', values: [{ value: 4 }] }] })));
    const result = await createInstagramCollector(policy, { fetch: f.fetcher }).post(credential, 'post', new Date('2026-10-21'));
    expect(result.rows).toHaveLength(policy.postMetrics.length); expect(result.failedMetrics).toEqual([]);
    expect(f.calls.every(call => call.path === '/v26.0/post/insights')).toBe(true);
  });
  it('normalizes flow, non-additive reach/range, zero and breakdown snapshots with French copy', () => {
    const row = (metric: string, value: unknown, rangeTotal = false): InstagramInsight => ({ metric, value, rangeTotal, period: 'day', asOf: new Date('2026-10-21'), raw: {} });
    const metrics = normalizeInstagramInsights([row('views', 0), row('reach', 9), row('views', 12, true), row('demographics', { age: { '18-24': 7 } })], target, policy, 'fr', new Date('2026-10-21'));
    expect(metrics[0]).toMatchObject({ kind: 'flow', rollup: 'sum', label: 'Vues', observations: [{ value: 0 }] });
    expect(metrics[1]).toMatchObject({ kind: 'stock', rollup: 'latest-per-channel' });
    expect(metrics[2]).toMatchObject({ kind: 'stock', rollup: 'latest-per-channel' });
    expect(metrics[3]).toMatchObject({ kind: 'breakdown', observations: [], breakdownHistory: [{ rows: [{ label: 'age/18-24', value: 7 }] }] });
    expect(metrics.every(metric => metric.coveredResourceIds?.[0] === target.id)).toBe(true);
  });
  it('uses French safe error copy without provider response details', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: 190, message: 'private fixture-token' } }), { status: 400 })) as unknown as typeof fetch;
    const error = await createInstagramGraph(policy, { fetch: fetcher, locale: 'fr' }).request('post', 'fixture-token').catch(error => error);
    expect(error).toBeInstanceOf(InstagramError); expect(error.outcome).toBe('rejected');
    expect(error.message).toBe(policy.copy.unavailable.fr); expect(error.message).not.toContain('fixture-token');
  });
  it('retains Graph demographic dimension names and never turns missing values into zero', () => {
    const asOf = new Date('2026-10-21');
    const rows: InstagramInsight[] = [{ metric: 'follower_demographics', period: 'lifetime', asOf, rangeTotal: true, raw: {}, value: [{ dimension_keys: ['age', 'gender'], results: [{ dimension_values: ['18-24', 'F'], value: 12 }] }] }, { metric: 'missing', period: 'day', asOf, rangeTotal: false, raw: {}, value: null }];
    const metrics = normalizeInstagramInsights(rows, target, policy, 'en', asOf);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.breakdownHistory![0]!.rows).toEqual([{ label: 'age: 18-24 · gender: F', value: 12 }]);
    expect(metrics[0]!.observations).toEqual([]);
  });
  it('reads current audience counts without inventing unavailable followers', async () => {
    const f = fixture([{ id: target.id, followers_count: 0 }, { id: target.id }]);
    const collector = createInstagramCollector(policy, { fetch: f.fetcher });
    const profile = await collector.profile(credential, target.id);
    expect(profile.followersCount).toBe(0);
    expect(normalizeInstagramAudience(profile, target, policy, 'fr')).toMatchObject([{ value: 0, metricLabel: 'Abonnés' }]);
    expect(normalizeInstagramAudience({ ...profile, followersCount: null }, target, policy, 'en')).toEqual([]);
    expect((await collector.profile(credential, target.id)).followersCount).toBeNull();
  });
  it('does not return an apparently complete Inbox after a pagination bound', async () => {
    const f = fixture([{ owner: { id: target.id } }, { data: [], paging: { next: 'https://graph.example/next', cursors: { after: 'more' } } }]);
    await expect(createInstagramAdapter({ ...policy, maxPages: 1 }, { fetch: f.fetcher }).listComments!({ credential, targetId: target.id, remotePostId: 'post' })).rejects.toMatchObject({ outcome: 'uncertain' });
  });
  it('never publishes when container creation or final receipt has no identity', async () => {
    for (const responses of [[{}], [{ id: 'container' }, finished, {}]]) {
      const f = fixture(responses);
      await expect(createInstagramAdapter(policy, { fetch: f.fetcher }).publish!(request)).rejects.toMatchObject({ outcome: 'uncertain' });
      expect(f.calls.filter(call => call.path.endsWith('media_publish')).length).toBeLessThanOrEqual(1);
    }
  });
  it('does not dispatch an already cancelled request', async () => {
    const f = fixture([]); const controller = new AbortController(); controller.abort();
    await expect(createInstagramAdapter(policy, { fetch: f.fetcher }).publish!({ ...request, signal: controller.signal })).rejects.toMatchObject({ outcome: 'rejected' });
    expect(f.calls).toHaveLength(0);
  });

});
