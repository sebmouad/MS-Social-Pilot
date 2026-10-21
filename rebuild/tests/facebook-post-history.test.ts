import { describe, it, expect, vi } from 'vitest';
import { createFacebookPostHistory } from '../src/platforms/facebook/post-history';
import { FACEBOOK_HISTORY_CONFIG, FACEBOOK_DATA_DETAIL_CONFIG, type FacebookConfig } from '../src/platforms/facebook/config';
const config: FacebookConfig = { graphBaseUrl: 'https://graph.example.test', oauthBaseUrl: 'https://example.test', graphVersion: 'v25.0', requestTimeoutMs: 1000, maxPages: 3, pageSize: 2, pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 10, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false };
const now = new Date('2026-10-20T00:00:00Z');
const policy = { lookbackDays: 365, pageBudget: 1, edge: 'published_posts' as const, fields: ['message'], metrics: ['post_clicks'], reactionTypes: ['LIKE'] };
const response = (data: unknown) => new Response(JSON.stringify(data));
describe('v26 insight authority', () => {
 const metrics = ['post_media_view', 'post_total_media_view_unique', 'post_reactions_by_type_total', 'post_clicks', 'post_clicks_by_type'];
 function fixture(value: unknown, summary = 0) {
  return vi.fn(async (input: RequestInfo | URL) => {
   const url = new URL(String(input));
   if (url.pathname.endsWith('/published_posts')) return response({ data: [{ id: 'p', created_time: '2026-10-01', reactions: { summary: { total_count: summary } } }] });
   if (url.pathname.endsWith('/reactions')) return response({ data: [] });
   const metric = url.searchParams.get('metric');
   return response({ data: [{ name: metric, total_value: { value: metric === 'post_reactions_by_type_total' ? value : metric === 'post_clicks_by_type' ? { 'link clicks': 2 } : 3 } }], paging: { next: 'unused-window' } });
  });
 }
 it('prefers insights over conflicting summary and edge counts without adding sources', async () => {
  const result = await createFacebookPostHistory({ ...config, graphVersion: 'v26.0' }, { ...policy, metrics }, fixture({ like: 1, love: 0 })).collect('token', 'page', now);
  expect(result.posts[0].insights).toMatchObject({ post_media_view: 3, post_total_media_view_unique: 3, clicks: 3, post_clicks_by_type: { 'link clicks': 2 }, reactions: 1, reactions_like: 1,
   reactionProvenance: { source: 'insights', metric: 'post_reactions_by_type_total', insightTotal: 1, summaryTotal: 0, edgeTotal: 0, conflict: true, observedAt: now.toISOString() } });
 });
 it('preserves an authoritative insight zero against a positive summary', async () => {
  const result = await createFacebookPostHistory(config, { ...policy, metrics }, fixture({ like: 0 }, 4)).collect('token', 'page', now);
  expect(result.posts[0].insights).toMatchObject({ reactions: 0, reactionProvenance: { source: 'insights', conflict: true } });
 });
 it('retains authoritative reaction types even when a reaction edge fails', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
   const url = new URL(String(input));
   if (url.pathname.endsWith('/published_posts')) return response({ data: [{ id: 'p', created_time: '2026-10-01' }] });
   if (url.pathname.endsWith('/reactions')) return response({ error: { code: 100 } });
   return response({ data: [{ name: 'post_reactions_by_type_total', values: [{ value: { like: '1', care: 2 } }] }] });
  });
  const result = await createFacebookPostHistory(config, { ...policy, metrics: ['post_reactions_by_type_total'] }, fetcher).collect('token', 'page', now);
  expect(result.posts[0].insights).toMatchObject({ reactions: 3, reactions_like: 1, reactions_care: 2, collectionFailures: ['reactions_LIKE'], reactionProvenance: { source: 'insights', edgeTotal: null, edgesComplete: false } });
 });
 it('records an unknown total when every reaction source is missing', async () => {
  const fetcher = vi.fn(async () => response({ data: [{ id: 'p', created_time: '2026-10-01' }] }));
  const result = await createFacebookPostHistory(config, { ...policy, metrics: [], reactionTypes: [] }, fetcher).collect('token', 'page', now);
  expect(result.posts[0].insights.reactions).toBeUndefined();
  expect(result.posts[0].insights.reactionProvenance).toMatchObject({ source: 'unknown', insightTotal: null, summaryTotal: null, edgeTotal: null, conflict: false });
 });
 it.each([{}, { like: null }, { like: -1 }, { like: true }])('does not fabricate an insight total from invalid categories %j', async value => {
  const result = await createFacebookPostHistory(config, { ...policy, metrics, reactionTypes: [] }, fixture(value, 4)).collect('token', 'page', now);
  expect(result.posts[0].insights).toMatchObject({ reactions: 4, reactionProvenance: { source: 'summary', insightTotal: null, edgeTotal: null } });
 });
 it('requests configured video metrics only for positively identified video posts', async () => {
  const requested: string[] = [];
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
   const url = new URL(String(input));
   if (url.pathname.endsWith('/published_posts')) return response({ data: [
    { id: 'photo', created_time: '2026-10-01', status_type: 'added_photos' },
    { id: 'video', created_time: '2026-10-01', status_type: 'added_video' },
    { id: 'attached', created_time: '2026-10-01', attachments: { data: [{ media_type: 'video' }] } },
    { id: 'unknown', created_time: '2026-10-01' },
   ] });
   requested.push(url.pathname);
   return response({ data: [{ name: url.searchParams.get('metric'), values: [{ value: 8 }] }] });
  });
  const result = await createFacebookPostHistory(config, { ...policy, metrics: FACEBOOK_HISTORY_CONFIG[0].defaultValue.metrics.filter(metric => metric.startsWith('post_video_')), reactionTypes: [] }, fetcher).collect('token', 'page', now);
  expect(requested).toHaveLength(4);
  expect(requested.every(path => /\/(video|attached)\/insights$/.test(path))).toBe(true);
  expect(result.posts.map(post => post.insights.video_watch_time)).toEqual([undefined, 8, 8, undefined]);
  expect(result.posts.map(post => post.insights.video_views)).toEqual([undefined, 8, 8, undefined]);
 });
});
describe('Page history', () => {
 it('validates Root defaults', () => { for (const setting of [...FACEBOOK_HISTORY_CONFIG, ...FACEBOOK_DATA_DETAIL_CONFIG]) expect(setting.schema.safeParse(setting.defaultValue).success).toBe(true); });
 it('resumes a stable interval and normalizes paginated reaction counts and insights', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
   const url = new URL(String(input));
   if (url.pathname.endsWith('/published_posts')) return response({ data: [{ id: 'p1', created_time: '2026-10-01', message: 'Example' }], ...(url.searchParams.has('after') ? {} : { paging: { next: 'unused', cursors: { after: 'feed-cursor' } } }) });
   if (url.pathname.endsWith('/insights')) return response({ data: [{ name: 'post_clicks', values: [{ value: '7' }] }] });
   return response({ data: [{ id: url.searchParams.has('after') ? 'b' : 'a' }], ...(url.searchParams.has('after') ? {} : { paging: { next: 'unused', cursors: { after: 'reaction-cursor' } } }) });
  });
  const reader = createFacebookPostHistory(config, policy, fetcher);
  const first = await reader.collect('secret', 'page', now);
  expect(first.progress).toMatchObject({ after: 'feed-cursor', complete: false });
  expect(first.posts[0].insights).toMatchObject({ clicks: 7, reactions: 2, reactions_like: 2 });
  const second = await reader.collect('secret', 'page', new Date('2026-10-21'), first.progress);
  expect(second.progress).toMatchObject({ until: now.toISOString(), complete: true });
  expect(String(fetcher.mock.calls[4][0])).toContain('after=feed-cursor');
 });
 it('withholds incomplete reaction totals', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
   const url = new URL(String(input));
   return response(url.pathname.endsWith('/published_posts') ? { data: [{ id: 'p', created_time: '2026-10-01' }] } : { data: [{ id: 'r' }], paging: { next: 'unused', cursors: { after: 'repeated' } } });
  });
  const result = await createFacebookPostHistory(config, { ...policy, metrics: [] }, fetcher).collect('secret', 'page', now);
  expect(result.posts[0].insights.reactions).toBeUndefined(); expect(result.failures).toContain('reactions_LIKE');
 });
 it('redacts provider errors', async () => {
  await expect(createFacebookPostHistory(config, policy, async () => response({ error: { message: 'secret' } })).collect('secret', 'page', now)).rejects.toThrow('History collection rejected');
 });
});

describe('round 3 history evidence', () => {
 it('uses replacement defaults and permits Root overrides', () => {
  const defaults = FACEBOOK_HISTORY_CONFIG[0].defaultValue;
  expect(defaults.metrics).toEqual(['post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_clicks_by_type', 'post_reactions_by_type_total', 'post_video_views', 'post_video_view_time']);
  expect(FACEBOOK_HISTORY_CONFIG[0].schema.safeParse({ ...defaults, metrics: ['custom_metric'] }).success).toBe(true);
 });
 it('uses unix seconds and retains metric successes around a refusal', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
   const url = new URL(String(input));
   if (url.pathname.endsWith('/published_posts')) {
    expect(url.searchParams.get('since')).toMatch(/^\d+$/);
    expect(url.searchParams.get('until')).toBe(String(Math.floor(now.getTime() / 1000)));
    return response({ data: [{ id: 'p', created_time: '2026-10-01' }] });
   }
   const metric = url.searchParams.get('metric');
   if (metric === 'refused') return response({ error: { code: 100 } });
   return response({ data: [{ name: metric, values: [{ value: metric === 'post_media_view' ? 9 : { link_clicks: 3 } }] }] });
  });
  const result = await createFacebookPostHistory(config, { ...policy, metrics: ['post_media_view', 'refused', 'post_clicks_by_type'], reactionTypes: [] }, fetcher).collect('secret', 'page', now);
  expect(result.failures).toEqual(['refused']);
  expect(result.posts[0].insights).toMatchObject({ post_media_view: 9, post_clicks_by_type: { link_clicks: 3 }, collectionFailures: ['refused'] });
  expect(fetcher).toHaveBeenCalledTimes(4);
 });
 it('excludes visitor and unknown-author feed posts', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
   const url = new URL(String(input));
   expect(url.pathname).toMatch(/\/feed$/);
   expect(url.searchParams.get('fields')?.split(',')).toContain('from');
   return response({ data: [
    { id: 'owned', created_time: '2026-10-01', from: { id: 'page' } },
    { id: 'visitor', created_time: '2026-10-01', from: { id: 'other' } },
    { id: 'unknown', created_time: '2026-10-01' },
   ] });
  });
  const result = await createFacebookPostHistory(config, { ...policy, edge: 'feed', metrics: [], reactionTypes: [] }, fetcher).collect('secret', 'page', now);
  expect(result.posts.map(post => post.remoteId)).toEqual(['owned']);
  expect(result.progress.complete).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
});
