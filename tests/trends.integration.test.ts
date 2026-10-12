import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setTestEnv, setupTestDatabase, type TestDatabase } from './helpers/database';

/** Trending topics (NEXT_PHASES H7): read from Google Trends' daily feed for the countries audiences name. */

const FEED = `<?xml version="1.0"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel>
<item><title>product launch</title><ht:approx_traffic>20,000+</ht:approx_traffic>
<pubDate>Mon, 12 Oct 2026 08:40:00 -0700</pubDate>
<ht:news_item><ht:news_item_title>A launch &amp; a party</ht:news_item_title><ht:news_item_url>https://news.example/launch</ht:news_item_url></ht:news_item>
<ht:news_item><ht:news_item_title>Second story</ht:news_item_title><ht:news_item_url>https://news.example/2</ht:news_item_url></ht:news_item>
</item>
<item><title>weather</title><ht:approx_traffic>500+</ht:approx_traffic><ht:news_item><ht:news_item_url>javascript:alert(1)</ht:news_item_url></ht:news_item></item>
<item><title></title></item>
</channel></rss>`;

let database: TestDatabase;
let prisma: typeof import('../src/lib/prisma')['prisma'];
let trends: typeof import('../src/lib/trends');

beforeAll(async () => {
  setTestEnv();
  database = setupTestDatabase('trends');
  ({ prisma } = await import('../src/lib/prisma'));
  trends = await import('../src/lib/trends');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  database?.drop();
});

describe('trending topics', () => {
  it('reads the feed, keeping only safe links', () => {
    const parsed = trends.parseTrends(FEED);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ title: 'product launch', traffic: '20,000+', newsTitle: 'A launch & a party', newsUrl: 'https://news.example/launch' });
    expect(parsed[0]!.startedAt?.toISOString()).toBe('2026-10-12T15:40:00.000Z');
    expect(parsed[1]).toMatchObject({ title: 'weather', newsUrl: null });
  });

  it('keeps topics that mention the team’s words, any case', () => {
    expect(trends.matchesKeywords({ title: 'Product Launch', newsTitle: null }, [])).toBe(true);
    expect(trends.matchesKeywords({ title: 'weather', newsTitle: 'Storm closes the launch site' }, ['LAUNCH'])).toBe(true);
    expect(trends.matchesKeywords({ title: 'weather', newsTitle: null }, ['launch'])).toBe(false);
  });

  it('fetches the countries in use, then waits before asking again', async () => {
    const now = new Date('2026-10-12T12:00:00Z');
    await prisma.workspace.create({ data: { name: 'Client A', slug: 'client-a', audienceCountries: ['GB'] } });
    const asked: string[] = [];
    const fake = (async (url: string) => {
      asked.push(url);
      return new Response(FEED, { status: url.endsWith('ZZ') ? 404 : 200 });
    }) as unknown as typeof fetch;

    expect(await trends.refreshTrends(now, fake)).toEqual(['GB']);
    expect(asked).toEqual(['https://trends.google.com/trending/rss?geo=GB']);
    expect(await trends.trendsFor(['GB'], now)).toHaveLength(2);

    expect(await trends.refreshTrends(new Date(now.getTime() + 60 * 60 * 1000), fake)).toEqual([]);
    expect(asked).toHaveLength(1);
    // A day and a half later the old list is not shown any more.
    expect(await trends.trendsFor(['GB'], new Date(now.getTime() + 37 * 60 * 60 * 1000))).toHaveLength(0);
  });
});
