import { describe, expect, it, vi } from 'vitest';
import { createFacebookDataCollector } from '../src/platforms/facebook/data-collection';
import { facebookInsightCategories } from '../src/platforms/facebook/data-normalization';
import { FACEBOOK_DATA_CONFIG, type FacebookConfig } from '../src/platforms/facebook/config';
const config: FacebookConfig = {
  graphBaseUrl: 'https://graph.facebook.test', oauthBaseUrl: 'https://facebook.test', graphVersion: 'v25.0', requestTimeoutMs: 2000,
  maxPages: 2, pageSize: 25, pageInsightMetrics: ['page_media_view'], adInsightFields: ['impressions', 'spend'],
  maxImageUploadBytes: 1024, allowedImageMimeTypes: ['image/jpeg'], appSecretProofEnabled: true, appSecret: 'synthetic-secret',
};
const since = new Date('2026-10-01T00:00:00Z'); const until = new Date('2026-10-02T00:00:00Z');
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const point = (name: string, value: unknown) => ({ name, period: 'day', values: [{ end_time: until.toISOString(), value }] });
const collector = (fetcher: typeof fetch, periods: Array<'day' | 'lifetime'> = ['day']) => createFacebookDataCollector(config, { periods, content: [] }, fetcher);
describe('Facebook data coverage collection', () => {
  it('validates all new Root defaults', () => {
    for (const setting of FACEBOOK_DATA_CONFIG) expect(setting.schema.safeParse(setting.defaultValue).success).toBe(true);
  });
  it('requests periods separately, signs reads, preserves zero and nested values', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('appsecret_proof')).toMatch(/^[0-9a-f]{64}$/);
      expect(url.searchParams.get('since')).toBe(String(since.getTime() / 1000));
      return response({ data: [point('page_media_view', url.searchParams.get('period') === 'day' ? 0 : { organic: { feed: '12' } })] });
    });
    const result = await collector(fetcher, ['day', 'lifetime']).getPageInsightObservations('token', 'page', since, until);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(result.map(item => item.numeric)).toEqual([0, null]);
    expect(facebookInsightCategories(result[1]!.value)).toEqual([{ label: 'organic · feed', value: 12 }]);
  });
  it('retains total_value and dimensions without claiming an additive daily value', async () => {
    const fetcher = vi.fn(async () => response({ data: [{ name: 'page_media_view', total_value: { value: 9, breakdowns: [{ dimension_keys: ['type'], results: [{ dimension_values: ['organic'], value: 9 }] }] } }] }));
    const result = await collector(fetcher).getPageInsightObservations('token', 'page', since, until);
    expect(result[0]).toMatchObject({ numeric: 9, period: `total_over_range:${since.toISOString()}`, endTime: until });
    expect(result[1]!.value).toEqual({ '[["type"],["organic"]]': 9 });
  });
  it('does not invent a timestamp for totals without a requested end', async () => {
    const fetcher = vi.fn(async () => response({ data: [{ name: 'page_media_view', total_value: { value: 9 } }] }));
    expect(await collector(fetcher).getPageInsightObservations('token', 'page')).toEqual([]);
  });
  it('discovers content and retains each remote identity', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      return response({ data: url.pathname.endsWith('/videos') ? [{ id: 'video-1' }, { id: 'video-2' }] : [point(String(url.searchParams.get('metric')), '4')] });
    });
    const result = await createFacebookDataCollector({ ...config, pageInsightMetrics: [] }, { periods: ['day'], content: [{ edge: 'videos', insightEdge: 'video_insights', metrics: ['verified_metric'], periods: ['lifetime'] }] }, fetcher).getPageInsightObservations('token', 'page', since, until);
    expect(result.map(row => row.metric)).toEqual(['content:videos:video-1:verified_metric', 'content:videos:video-2:verified_metric']);
  });
  it('isolates metric failures and strips provider error strings', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => new URL(String(input)).searchParams.get('period') === 'day' ? response({ data: [point('page_media_view', 2)] }) : response({ error: { message: 'private token' } }, 400));
    const result = await collector(fetcher, ['day', 'lifetime']).getPageInsightObservations('token', 'page', since, until);
    expect(result).toHaveLength(1); expect(result.failedMetrics).toHaveLength(1); expect(JSON.stringify(result.failedMetrics)).not.toContain('private');
  });
  it.each(['https://evil.test/v25.0/page/insights', 'https://graph.facebook.test/v25.0/other/insights'])('blocks unsafe paging %s', async next => {
    const fetcher = vi.fn(async () => response({ data: [point('page_media_view', 1)], paging: { next } }));
    await expect(collector(fetcher).getPageInsightObservations('token', 'page', since, until)).rejects.toThrow('No configured'); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('refuses truncated collections', async () => {
    let cursor = 0;
    const fetcher = vi.fn(async () => response({ data: [], paging: { next: `https://graph.facebook.test/v25.0/page/insights?after=${++cursor}` } }));
    await expect(collector(fetcher).getPageInsightObservations('token', 'page', since, until)).rejects.toThrow('No configured'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('propagates cancellation', async () => {
    const abort = new AbortController();
    const fetcher = vi.fn(async () => { abort.abort(); return response({ data: [] }); });
    await expect(createFacebookDataCollector(config, { periods: ['day'], content: [] }, fetcher, abort.signal).getPageInsightObservations('token', 'page', since, until)).rejects.toThrow();
  });
  it('keeps Ads breakdown rows separate from account totals', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input)); expect(url.searchParams.get('breakdowns')).toBe('age,gender'); expect(url.searchParams.get('fields')).toContain('date_start');
      return response({ data: [{ date_start: '2026-10-01', age: '25-34', gender: 'female', impressions: '7', spend: '2.5' }] });
    });
    const result = await collector(fetcher).collectAdBreakdowns('token', 'act_1', since, until, [['age', 'gender']], [{ date_start: '2026-10-01', impressions: '20' }]);
    expect(result[0]!.impressions).toBe('20'); expect(result[0]!.delivery_breakdowns).toHaveLength(1);
  });
  it('refuses incomplete Ads refresh on rejected combinations', async () => {
    const fetcher = vi.fn(async () => response({ error: {} }, 400));
    await expect(collector(fetcher).collectAdBreakdowns('token', 'act_1', since, until, [['age']], [])).rejects.toThrow('rejected');
  });
});

vi.mock('../src/server/data', () => ({ prisma: {} }));
import { normalizeFacebookAnalytics } from '../src/platforms/facebook/analytics';

describe('Facebook delivery dimension normalization', () => {
  it('emits history without summing periods, ratios or currencies into totals', () => {
    const accounts = [{ id: 'a', name: 'A', currency: 'USD' }, { id: 'b', name: 'B', currency: 'EUR' }];
    const adRows = accounts.flatMap(adAccount => [1, 2].map(day => ({ date: new Date(`2026-10-0${day}T00:00:00Z`), spend: 20, impressions: 100, clicks: 10, reach: 50, cpc: 2, cpm: 200, cpp: 0.4, ctr: 10, frequency: 2,
      actions: null, fetchedAt: until, adAccount,
      fields: { delivery_breakdowns: [{ dimensions: ['age', 'gender'], rows: [{ age: '25-34', gender: 'female', spend: '2', impressions: String(day), cpc: '0.5', actions: [{ action_type: 'link_click', value: '3' }] }] }] },
    })));
    const result = normalizeFacebookAnalytics({ pageRows: [], audienceRows: [], adRows, selectedTargets: [], selectedAdAccounts: accounts });
    const delivery = result.metrics.filter(metric => metric.key.startsWith('delivery:'));
    expect(delivery).toHaveLength(6); // spend and CPC split by currency; counts and actions shared
    expect(delivery.every(metric => metric.totalOverride === null && metric.observations.length === 0)).toBe(true);
    const impressions = delivery.find(metric => metric.label === 'Impressions')!;
    expect(impressions.breakdownHistory).toHaveLength(4); expect(impressions.rows?.map(row => row.value)).toEqual([2, 2]);
    expect(delivery.filter(metric => metric.unit === 'currency').map(metric => metric.label)).toEqual(expect.arrayContaining(['Spend · USD', 'Spend · EUR']));
    expect(result.metrics.some(metric => metric.key.includes('delivery_breakdowns'))).toBe(false);
  });
  it('preserves unknown nested Page category leaves as null', () => {
    expect(facebookInsightCategories({ organic: { female: '7', male: null } })).toEqual([{ label: 'organic · female', value: 7 }, { label: 'organic · male', value: null }]);
  });
});

it('retains configured reaction summary fields without requiring speculative insight metrics', async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input)); expect(url.searchParams.get('fields')).toContain('reactions');
    return response({ data: [{ id: 'post1', reactions: { data: [], summary: { total_count: 9 } } }] });
  });
  const result = await createFacebookDataCollector({ ...config, pageInsightMetrics: [] }, { periods: ['day'], content: [{ edge: 'posts', insightEdge: 'insights', fields: ['reactions.limit(0).summary(true)'], metrics: [], periods: ['lifetime'] }] }, fetcher).getPageInsightObservations('token', 'page', since, until);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(result[0]!.metric).toBe('content:posts:post1:field:reactions');
  expect(facebookInsightCategories(result[0]!.value)).toContainEqual({ label: 'summary · total_count', value: 9 });
});

it('fails before transport if signing material is unavailable', async () => {
  const fetcher = vi.fn();
  await expect(createFacebookDataCollector({ ...config, appSecret: undefined }, { periods: ['day'], content: [] }, fetcher).getPageInsightObservations('token', 'page', since, until)).rejects.toThrow('No configured');
  expect(fetcher).not.toHaveBeenCalled();
});

it('deduplicates identical Ads dimension combinations before fetching', async () => {
  const fetcher = vi.fn(async () => response({ data: [] }));
  await collector(fetcher).collectAdBreakdowns('token', 'act_1', since, until, [['age', 'gender'], ['gender', 'age']], []);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('emits top-level array categories with full stored snapshot history', () => {
  const target = { id: 'page', name: 'Page', type: 'page', socialAccountId: 'connection' };
  const result = normalizeFacebookAnalytics({ audienceRows: [], adRows: [], selectedTargets: [target], selectedAdAccounts: [], pageRows: [{ metric: 'content:videos:v:verified_array', period: 'lifetime', endTime: until, fetchedAt: until, numeric: null, value: [{ bucket: 0, value: 9 }, { bucket: 1, value: null }], target }] });
  expect(result.metrics[0]!.totalOverride).toBeNull();
  expect(result.metrics[0]!.breakdownHistory?.[0]?.rows).toContainEqual({ label: '1 · value', value: null });
  expect(result.metrics[0]!.breakdownHistory?.[0]?.rows).toContainEqual({ label: '0 · value', value: 9 });
});
