import { describe, it, expect, vi } from 'vitest';
import { createFacebookPostHistory } from '../src/platforms/facebook/post-history';
import { FACEBOOK_HISTORY_CONFIG, FACEBOOK_DATA_DETAIL_CONFIG, type FacebookConfig } from '../src/platforms/facebook/config';
const config: FacebookConfig = { graphBaseUrl: 'https://graph.example.test', oauthBaseUrl: 'https://example.test', graphVersion: 'v25.0', requestTimeoutMs: 1000, maxPages: 3, pageSize: 2, pageInsightMetrics: [], adInsightFields: [], maxImageUploadBytes: 10, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false };
const now = new Date('2026-10-20T00:00:00Z');
const policy = { lookbackDays: 365, pageBudget: 1, edge: 'published_posts' as const, fields: ['message'], metrics: ['post_clicks'], reactionTypes: ['LIKE'] };
const response = (data: unknown) => new Response(JSON.stringify(data));
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
