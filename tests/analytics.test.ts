import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';

/**
 * The insights fetcher.
 *
 * The behaviour worth protecting is the bisection. Graph rejects an entire
 * request if one metric name is unknown, and Meta removes metrics between
 * versions — so asking for thirty and getting a 400 must not lose the
 * twenty-nine that were fine.
 */

let server: Server;
let baseUrl: string;

/** Metric names this stub pretends Meta has removed. */
let removed = new Set<string>();
/** Every `metric=` parameter the stub received, for asserting on chunking. */
let requests: string[][] = [];
let failEverything: { code: number; message: string } | null = null;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.SESSION_SECRET = 'test';
  process.env.FACEBOOK_APP_ID = '1';
  process.env.FACEBOOK_APP_SECRET = 'secret';

  server = createServer((request, response) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    const names = (url.searchParams.get('metric') ?? '').split(',').filter(Boolean);
    const period = url.searchParams.get('period') ?? 'day';
    requests.push(names);

    if (failEverything) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: failEverything.message, code: failEverything.code } }));
      return;
    }

    const bad = names.filter((name) => removed.has(name));
    if (bad.length > 0) {
      // Exactly how Graph behaves: the whole call fails, naming one metric.
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: { message: `(#100) Metric ${bad[0]} is not valid`, code: 100 },
        }),
      );
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        data: names.map((name) => ({
          name,
          period,
          values:
            name === 'page_fans_country'
              ? [{ value: { FR: 120, GB: 80, US: 40 }, end_time: '2026-09-02T07:00:00+0000' }]
              : [
                  { value: 10, end_time: '2026-09-01T07:00:00+0000' },
                  { value: 20, end_time: '2026-09-02T07:00:00+0000' },
                ],
        })),
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.FACEBOOK_GRAPH_BASE_URL = baseUrl;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  removed = new Set();
  requests = [];
  failEverything = null;
});

const { chunk, fetchInsights, topBreakdown } = await import('../src/lib/facebook/analytics');
const { PAGE_METRICS, POST_METRICS, findMetric } = await import('../src/lib/facebook/metrics');
const { trendOf } = await import('../src/lib/analytics');

describe('chunk', () => {
  it('splits evenly', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('keeps the remainder', () => {
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
  });

  it('handles an empty list', () => {
    expect(chunk([], 5)).toEqual([]);
  });
});

describe('fetchInsights', () => {
  it('returns a series per metric', async () => {
    const result = await fetchInsights({
      objectId: '1000',
      level: 'page',
      accessToken: 'token',
      period: 'day',
      only: ['page_impressions', 'page_post_engagements'],
    });

    expect(result.series.map((entry) => entry.name).sort()).toEqual([
      'page_impressions',
      'page_post_engagements',
    ]);
    expect(result.unavailable).toEqual([]);
  });

  it('sums a plain series into a total', async () => {
    const result = await fetchInsights({
      objectId: '1000',
      level: 'page',
      accessToken: 'token',
      period: 'day',
      only: ['page_impressions'],
    });

    expect(result.series[0]!.total).toBe(30);
    expect(result.series[0]!.latest).toBe(20);
  });

  it('keeps a breakdown as a map and refuses to total it', async () => {
    // Summing "FR + GB + US" would be a number that means nothing.
    const result = await fetchInsights({
      objectId: '1000',
      level: 'page',
      accessToken: 'token',
      period: 'lifetime',
      only: ['page_fans_country'],
    });

    expect(result.series[0]!.total).toBeNull();
    expect(result.series[0]!.latest).toEqual({ FR: 120, GB: 80, US: 40 });
  });

  it('isolates one removed metric and keeps the rest', async () => {
    removed = new Set(['page_impressions_viral']);

    const result = await fetchInsights({
      objectId: '1000',
      level: 'page',
      accessToken: 'token',
      period: 'day',
      only: ['page_impressions', 'page_impressions_viral', 'page_post_engagements'],
    });

    expect(result.unavailable.map((entry) => entry.name)).toEqual(['page_impressions_viral']);
    expect(result.series.map((entry) => entry.name).sort()).toEqual([
      'page_impressions',
      'page_post_engagements',
    ]);
  });

  it('isolates several removed metrics at once', async () => {
    removed = new Set(['page_impressions_viral', 'page_consumptions']);

    const result = await fetchInsights({
      objectId: '1000',
      level: 'page',
      accessToken: 'token',
      period: 'day',
    });

    expect(result.unavailable.map((entry) => entry.name).sort()).toEqual([
      'page_consumptions',
      'page_impressions_viral',
    ]);
    expect(result.series.length).toBeGreaterThan(5);
  });

  it('records why a metric was refused', async () => {
    removed = new Set(['page_consumptions']);

    const result = await fetchInsights({
      objectId: '1000',
      level: 'page',
      accessToken: 'token',
      period: 'day',
      only: ['page_impressions', 'page_consumptions'],
    });

    expect(result.unavailable[0]!.code).toBe(100);
    expect(result.unavailable[0]!.reason).toMatch(/not valid/i);
  });

  it('chunks rather than asking for everything in one call', async () => {
    await fetchInsights({ objectId: '1000', level: 'page', accessToken: 'token', period: 'day' });

    expect(requests.length).toBeGreaterThan(1);
    expect(Math.max(...requests.map((names) => names.length))).toBeLessThanOrEqual(8);
  });

  it('does not bisect an auth failure', async () => {
    // A dead token applies to every metric equally; splitting the request just
    // spends more calls to learn the same thing.
    failEverything = { code: 190, message: 'Invalid OAuth access token' };

    await expect(
      fetchInsights({
        objectId: '1000',
        level: 'page',
        accessToken: 'token',
        period: 'day',
        only: ['page_impressions', 'page_post_engagements', 'page_consumptions'],
      }),
    ).rejects.toThrow(/OAuth/i);

    expect(requests).toHaveLength(1);
  });

  it('does not bisect a rate limit', async () => {
    failEverything = { code: 4, message: 'Application request limit reached' };

    await expect(
      fetchInsights({ objectId: '1000', level: 'page', accessToken: 'token', period: 'day' }),
    ).rejects.toThrow(/limit/i);

    expect(requests).toHaveLength(1);
  });

  it('only asks for metrics valid in the requested period', async () => {
    await fetchInsights({ objectId: '1000', level: 'page', accessToken: 'token', period: 'lifetime' });

    const asked = requests.flat();
    for (const name of asked) {
      expect(findMetric(name)!.periods).toContain('lifetime');
    }
  });

  it('reads post metrics too', async () => {
    const result = await fetchInsights({
      objectId: '1000_2000',
      level: 'post',
      accessToken: 'token',
      period: 'lifetime',
    });

    expect(result.series.some((entry) => entry.name === 'post_impressions')).toBe(true);
  });
});

describe('metric catalogue', () => {
  it('has no duplicate names', () => {
    const names = [...PAGE_METRICS, ...POST_METRICS].map((metric) => metric.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every metric at least one period and a description', () => {
    for (const metric of [...PAGE_METRICS, ...POST_METRICS]) {
      expect(metric.periods.length, metric.name).toBeGreaterThan(0);
      expect(metric.description.length, metric.name).toBeGreaterThan(10);
    }
  });

  it('scopes page and post metrics to their own level', () => {
    expect(PAGE_METRICS.every((metric) => metric.name.startsWith('page_'))).toBe(true);
    expect(POST_METRICS.every((metric) => metric.name.startsWith('post_'))).toBe(true);
  });
});

describe('topBreakdown', () => {
  it('sorts by value, largest first', () => {
    expect(topBreakdown({ a: 1, b: 9, c: 5 })).toEqual([
      { key: 'b', value: 9 },
      { key: 'c', value: 5 },
      { key: 'a', value: 1 },
    ]);
  });

  it('caps the list', () => {
    const wide = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`k${index}`, index]));
    expect(topBreakdown(wide, 5)).toHaveLength(5);
  });

  it('returns nothing for a plain number or null', () => {
    expect(topBreakdown(42)).toEqual([]);
    expect(topBreakdown(null)).toEqual([]);
  });
});

describe('trendOf', () => {
  it('reports growth between the halves of a series', () => {
    expect(trendOf([1, 1, 2, 2])).toBe(100);
  });

  it('reports decline', () => {
    expect(trendOf([10, 10, 5, 5])).toBe(-50);
  });

  it('returns null when the earlier half is zero', () => {
    // "Up from nothing" is not a percentage.
    expect(trendOf([0, 0, 5, 5])).toBeNull();
  });

  it('returns null for a series too short to have halves', () => {
    expect(trendOf([1, 2])).toBeNull();
  });
});
