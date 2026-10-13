import { prisma } from './prisma';
import { countriesInUse } from './holidays';
import { tagText } from './rss/parse';

/**
 * Trending topics: what people search for today in each
 * country an audience names, from Google Trends' public daily feed (no key).
 * The worker fetches it for the countries in use and stores it, shared by
 * every workspace; screens read the database only.
 */

export const TRENDS_SOURCE = 'https://trends.google.com/trending/rss';

/** Countries asked for per run, so a new audience fills in without a burst. */
const PER_RUN = 20;
/** A country's list is asked again after this long. */
const REFRESH_MS = 3 * 60 * 60 * 1000;
/** Lists older than this are not today's any more and are not shown. */
export const TREND_MAX_AGE_MS = 36 * 60 * 60 * 1000;

export interface Trend {
  title: string;
  traffic: string | null;
  newsTitle: string | null;
  newsUrl: string | null;
  startedAt: Date | null;
}

/** The feed's items; tolerant of anything missing. */
export function parseTrends(xml: string): Trend[] {
  const trends: Trend[] = [];
  for (const [item] of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const title = tagText(item, 'title');
    if (!title) continue;
    const news = /<(?:\w+:)?news_item\b[\s\S]*?<\/(?:\w+:)?news_item>/i.exec(item)?.[0] ?? '';
    const newsUrl = news ? tagText(news, 'news_item_url') : null;
    const date = tagText(item, 'pubDate');
    const startedAt = date ? new Date(date) : null;
    trends.push({
      title: title.slice(0, 200),
      traffic: tagText(item, 'approx_traffic')?.slice(0, 40) ?? null,
      newsTitle: news ? (tagText(news, 'news_item_title')?.slice(0, 300) ?? null) : null,
      newsUrl: newsUrl && /^https?:\/\//.test(newsUrl) ? newsUrl.slice(0, 1000) : null,
      startedAt: startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt : null,
    });
  }
  return trends;
}

/** Keep the topics that mention one of the team's words; no words keeps them all. */
export function matchesKeywords(trend: Pick<Trend, 'title' | 'newsTitle'>, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const text = `${trend.title} ${trend.newsTitle ?? ''}`.toLocaleLowerCase();
  return keywords.some((word) => text.includes(word.toLocaleLowerCase()));
}

/** Fetch the lists that are due. Returns the countries refreshed. */
export async function refreshTrends(now: Date, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const countries = await countriesInUse();
  if (countries.length === 0) return [];
  const latest = await prisma.trendingTopic.groupBy({ by: ['country'], where: { country: { in: countries } }, _max: { fetchedAt: true } });
  const fresh = new Set(
    latest.filter((row) => row._max.fetchedAt && now.getTime() - row._max.fetchedAt.getTime() < REFRESH_MS).map((row) => row.country),
  );

  const refreshed: string[] = [];
  for (const country of countries.filter((code) => !fresh.has(code)).slice(0, PER_RUN)) {
    const response = await fetchImpl(`${TRENDS_SOURCE}?geo=${country}`, {
      headers: { accept: 'application/rss+xml, application/xml' },
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    // A country Google does not cover, or a hiccup: try again on a later run.
    if (!response || response.status !== 200) continue;
    const trends = parseTrends(await response.text());
    if (trends.length === 0) continue;
    await prisma.$transaction([
      prisma.trendingTopic.deleteMany({ where: { country } }),
      prisma.trendingTopic.createMany({ data: trends.map((trend) => ({ country, ...trend, fetchedAt: now })), skipDuplicates: true }),
    ]);
    refreshed.push(country);
  }
  return refreshed;
}

/** Today's stored topics for these countries, newest first. */
export async function trendsFor(countries: string[], now: Date = new Date()) {
  if (countries.length === 0) return [];
  return prisma.trendingTopic.findMany({
    where: { country: { in: countries }, fetchedAt: { gte: new Date(now.getTime() - TREND_MAX_AGE_MS) } },
    orderBy: [{ country: 'asc' }, { startedAt: 'desc' }],
  });
}
