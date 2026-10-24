import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFacebookEngine } from '../src/platforms/facebook/publishing';
import { mapFacebookReview, ratingsReadVersion } from '../src/platforms/facebook/reviews';
import { storeFacebookReviews } from '../src/platforms/facebook/reviews-store';
import type { FacebookConfig } from '../src/platforms/facebook/config';

const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://www.facebook.test', graphVersion: 'v99.0', requestTimeoutMs: 2_000,
  maxPages: 4, pageSize: 25, pageInsightMetrics: ['page_views_total'], adInsightFields: ['spend'], maxImageUploadBytes: 1024, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: false,
};
const response = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
const entry = (story: string, extra: Record<string, unknown> = {}) => ({ created_time: '2026-03-01T10:00:00+0000', open_graph_story: { id: story }, reviewer: { id: 'u1', name: 'Sam' }, ...extra });

afterEach(() => vi.useRealTimers());

describe('Facebook review mapping', () => {
  it('maps stars, recommendations and text to the neutral review shape', () => {
    expect(mapFacebookReview(entry('s1', { rating: 4, review_text: 'Great' }))).toEqual({ id: 's1', createdAt: new Date('2026-03-01T10:00:00Z'), authorName: 'Sam', rating: 4, recommendation: null, text: 'Great' });
    expect(mapFacebookReview(entry('s2', { recommendation_type: 'negative' }))).toMatchObject({ rating: null, recommendation: 'negative', text: null });
  });
  it('keeps missing data missing and skips entries without a stable identity', () => {
    expect(mapFacebookReview(entry('s3', { rating: 0 }))?.rating).toBeNull();
    expect(mapFacebookReview(entry('s4', { rating: 9, recommendation_type: 'maybe' }))).toMatchObject({ rating: null, recommendation: null });
    expect(mapFacebookReview({ created_time: '2026-03-01T10:00:00+0000' })).toBeNull();
    expect(mapFacebookReview(entry('s5', { created_time: 'not a date' }))).toBeNull();
    expect(mapFacebookReview(null)).toBeNull();
  });
});

describe('Facebook ratings version', () => {
  it('reads on the pinned older version until Meta retires it, then not at all', () => {
    expect(ratingsReadVersion('v25.0', new Date('2026-10-20T00:00:00Z'))).toBe('v21.0');
    expect(ratingsReadVersion('v21.0', new Date('2030-01-01T00:00:00Z'))).toBe('v21.0');
    expect(ratingsReadVersion('v25.0', new Date('2027-02-01T00:00:00Z'))).toBeNull();
  });
});

describe('Facebook engine listReviews (mocked Graph)', () => {
  it('reads the ratings edge on the pinned version, follows pagination and maps entries', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input)); calls.push(url.toString());
      if (url.searchParams.get('after')) return response({ data: [entry('s2', { recommendation_type: 'positive' })] });
      return response({ data: [entry('s1', { rating: 5, review_text: 'Lovely' }), { created_time: '2026-03-01T10:00:00+0000' }], paging: { next: 'https://graph.facebook.test/v21.0/page-1/ratings?after=abc' } });
    }) as unknown as typeof fetch;
    const reviews = await createFacebookEngine(config, fetcher).listReviews('token', 'page-1');
    expect(reviews.map(review => review.id)).toEqual(['s1', 's2']);
    const first = new URL(calls[0]!);
    expect(first.pathname).toBe('/v21.0/page-1/ratings');
    expect(first.searchParams.get('fields')).toContain('open_graph_story{id}');
    expect(first.searchParams.get('access_token')).toBe('token');
    expect(calls).toHaveLength(2);
  });
  it('makes no request once no Graph version can serve ratings', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2027-02-01T00:00:00Z'));
    const fetcher = vi.fn() as unknown as typeof fetch;
    expect(await createFacebookEngine(config, fetcher).listReviews('token', 'page-1')).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('is exposed through the adapter as the neutral optional capability', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    const { createFacebookAdapter } = await import('../src/platforms/facebook/publishing');
    const adapter = createFacebookAdapter(config, vi.fn(async () => response({ data: [entry('s1', { rating: 3 })] })) as unknown as typeof fetch);
    expect(await adapter.listReviews!({ credential: { accessToken: 'token' }, targetId: 'page-1' })).toHaveLength(1);
  });
});

describe('Facebook review storage', () => {
  it('upserts each review once, never touching local resolution state', async () => {
    const executeRaw = vi.fn(async () => 1);
    const reviews = [mapFacebookReview(entry('s1', { rating: 5 }))!, mapFacebookReview(entry('s1', { rating: 4 }))!, mapFacebookReview(entry('s2'))!];
    const stored = await storeFacebookReviews({ $executeRaw: executeRaw } as never, 'target-1', reviews, new Date('2026-10-20T00:00:00Z'));
    expect(stored).toBe(2);
    expect(executeRaw).toHaveBeenCalledTimes(2);
    const sql = (executeRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('?');
    expect(sql).toContain('ON CONFLICT ("targetId", "remoteId") DO UPDATE');
    expect(sql).not.toContain('resolvedAt');
  });
});
