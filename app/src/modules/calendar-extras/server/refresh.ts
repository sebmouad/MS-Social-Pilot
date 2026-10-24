import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/data';
import { runtimeConfig } from '@/server/config/store';
import { defaultFetchDeps, guardedFetch, type FetchDeps, type FetchPolicy } from '@/modules/publishing/server/media/network/net-guard';
import { refreshSchema, type Refresh } from '../config';

/**
 * Background refresh of the shared public data the calendar reads: national holidays and daily trending searches.
 * Run by the shared worker as the Publishing-declared `calendarHolidays` and `calendarTrends` jobs. Sources, allowed hosts,
 * batch sizes, ages and fetch bounds come from Root (`calendarExtras.refresh`); fetching goes through the shared outbound guard.
 * Rows are shared by every workspace; screens and the service only read them. A country the source answers with a failure is
 * left for a later run without failing the others.
 */
export type RefreshSummary = { reason?: 'disabled'; countries: number; attempted: number; stored: number; failed: number };
const DAY_MS = 86_400_000;

export async function refreshSettings(): Promise<Refresh> { return refreshSchema.parse(await runtimeConfig('calendarExtras.refresh')); }
const policyOf = (s: Refresh): FetchPolicy => ({ timeoutMs: s.fetchTimeoutMs, maxBytes: s.fetchMaxBytes, maxRedirects: s.fetchMaxRedirects, allowHttp: false, hostAllowlist: s.hostAllowlist });

/** Every country named by a workspace or channel audience, bounded by the Root retention limit. */
export async function countriesInUse(limit: number): Promise<string[]> {
 const rows = await prisma.$queryRaw<Array<{ country: string }>>`
  SELECT DISTINCT country FROM (SELECT unnest("audienceCountries") AS country FROM workspaces UNION ALL SELECT unnest("audienceCountries") AS country FROM targets) c
  WHERE country ~ '^[A-Z]{2}$' ORDER BY country LIMIT ${limit}`;
 return rows.map(r => r.country);
}

export type Holiday = { date: string; name: string; localName: string };
/** Nationwide holidays only; a regional holiday is not a day the whole audience keeps. */
export function parseHolidays(body: unknown, s: Pick<Refresh, 'holidayNameLength' | 'maxHolidaysPerCountryYear'>): Holiday[] {
 if (!Array.isArray(body)) return [];
 const out: Holiday[] = [];
 for (const e of body as Array<Record<string, unknown>>) {
  if (!e || e.global === false || typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || typeof e.name !== 'string') continue;
  out.push({ date: e.date, name: e.name.slice(0, s.holidayNameLength), localName: String(e.localName ?? e.name).slice(0, s.holidayNameLength) });
  if (out.length >= s.maxHolidaysPerCountryYear) break;
 }
 return out;
}

const decode = (v: string) => v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();
const tag = (xml: string, name: string) => { const m = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`, 'i').exec(xml); return m ? decode(m[1]!) || null : null; };
export type ParsedTrend = { title: string; traffic: string | null; newsTitle: string | null; newsUrl: string | null; startedAt: Date | null };
export function parseTrends(xml: string, s: Pick<Refresh, 'trendTitleLength' | 'trendTrafficLength' | 'trendNewsUrlLength' | 'maxTrendsPerCountry'>): ParsedTrend[] {
 const out: ParsedTrend[] = [];
 for (const [item] of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
  const title = tag(item, 'title');
  if (!title) continue;
  const news = /<(?:\w+:)?news_item\b[\s\S]*?<\/(?:\w+:)?news_item>/i.exec(item)?.[0] ?? '';
  const url = news ? tag(news, 'news_item_url') : null;
  const date = tag(item, 'pubDate'); const started = date ? new Date(date) : null;
  out.push({ title: title.slice(0, s.trendTitleLength), traffic: tag(item, 'approx_traffic')?.slice(0, s.trendTrafficLength) ?? null, newsTitle: news ? tag(news, 'news_item_title')?.slice(0, s.trendTitleLength * 2) ?? null : null,
   newsUrl: url && /^https?:\/\//i.test(url) ? url.slice(0, s.trendNewsUrlLength) : null, startedAt: started && !Number.isNaN(started.getTime()) ? started : null });
  if (out.length >= s.maxTrendsPerCountry) break;
 }
 return out;
}

type Deps = { net?: FetchDeps; now?: Date };
const get = async (url: string, s: Refresh, accept: string, net: FetchDeps) => guardedFetch(url, policyOf(s), net, { headers: { accept } });

/** Fetch the missing or aged country-years of holidays. A country the source does not cover is recorded with zero so it is not asked again until it ages. */
export async function refreshHolidays(deps: Deps = {}): Promise<RefreshSummary> {
 const s = await refreshSettings(); const now = deps.now ?? new Date();
 if (!s.enabled) return { reason: 'disabled', countries: 0, attempted: 0, stored: 0, failed: 0 };
 const countries = await countriesInUse(s.retainedCountries);
 if (!countries.length) return { countries: 0, attempted: 0, stored: 0, failed: 0 };
 const year = now.getUTCFullYear(); const years = Array.from({ length: s.holidayYearsAhead + 1 }, (_, i) => year + i);
 const known = await prisma.$queryRaw<Array<{ country: string; year: number; fetchedAt: Date }>>`SELECT country, year, "fetchedAt" FROM holiday_years WHERE country = ANY(${countries}::text[]) AND year = ANY(${years}::int[])`;
 const fresh = new Set(known.filter(r => now.getTime() - r.fetchedAt.getTime() < s.holidayRefreshDays * DAY_MS).map(r => `${r.country}:${r.year}`));
 const due = countries.flatMap(country => years.map(y => ({ country, year: y }))).filter(e => !fresh.has(`${e.country}:${e.year}`)).slice(0, s.holidayCountryYearsPerRun);
 const net = deps.net ?? defaultFetchDeps(); const base = s.holidaysUrl.replace(/\/+$/, '');
 let stored = 0; let failed = 0;
 for (const { country, year: y } of due) {
  try {
   const r = await get(`${base}/${y}/${country}`, s, 'application/json', net);
   if (r.notModified) continue;
   let holidays: Holiday[] = [];
   if (r.status === 200) holidays = parseHolidays(JSON.parse(r.bytes.toString('utf8')), s);
   else if (r.status !== 204 && r.status !== 404) { failed += 1; continue; }
   await prisma.$transaction(async tx => {
    await tx.$executeRaw`DELETE FROM public_holidays WHERE country = ${country} AND date LIKE ${`${y}-%`}`;
    for (const h of holidays) await tx.$executeRaw`INSERT INTO public_holidays (country, date, name, "localName") VALUES (${country}, ${h.date}, ${h.name}, ${h.localName}) ON CONFLICT DO NOTHING`;
    await tx.$executeRaw`INSERT INTO holiday_years (country, year, count, "fetchedAt") VALUES (${country}, ${y}, ${holidays.length}, ${now}) ON CONFLICT (country, year) DO UPDATE SET count = EXCLUDED.count, "fetchedAt" = EXCLUDED."fetchedAt"`;
   });
   stored += 1;
  } catch { failed += 1; }
 }
 return { countries: countries.length, attempted: due.length, stored, failed };
}

/** Fetch today's trending searches for countries whose list has aged. Failures keep the previous list; it disappears from screens by the freshness window. */
export async function refreshTrends(deps: Deps = {}): Promise<RefreshSummary> {
 const s = await refreshSettings(); const now = deps.now ?? new Date();
 if (!s.enabled) return { reason: 'disabled', countries: 0, attempted: 0, stored: 0, failed: 0 };
 const countries = await countriesInUse(s.retainedCountries);
 if (!countries.length) return { countries: 0, attempted: 0, stored: 0, failed: 0 };
 const latest = await prisma.$queryRaw<Array<{ country: string; fetchedAt: Date }>>`SELECT country, MAX("fetchedAt") AS "fetchedAt" FROM trending_topics WHERE country = ANY(${countries}::text[]) GROUP BY country`;
 const fresh = new Set(latest.filter(r => now.getTime() - r.fetchedAt.getTime() < s.trendRefreshMinutes * 60_000).map(r => r.country));
 const due = countries.filter(c => !fresh.has(c)).slice(0, s.trendCountriesPerRun);
 const net = deps.net ?? defaultFetchDeps(); let stored = 0; let failed = 0;
 for (const country of due) {
  try {
   const r = await get(`${s.trendsUrl}${s.trendsUrl.includes('?') ? '&' : '?'}geo=${country}`, s, 'application/rss+xml, application/xml', net);
   if (r.notModified || r.status !== 200) { failed += 1; continue; }
   const trends = parseTrends(r.bytes.toString('utf8'), s);
   if (!trends.length) { failed += 1; continue; }
   await prisma.$transaction(async tx => {
    await tx.$executeRaw`DELETE FROM trending_topics WHERE country = ${country}`;
    for (const t of trends) await tx.$executeRaw`INSERT INTO trending_topics (id, country, title, traffic, "newsTitle", "newsUrl", "startedAt", "fetchedAt") VALUES (${randomUUID()}, ${country}, ${t.title}, ${t.traffic}, ${t.newsTitle}, ${t.newsUrl}, ${t.startedAt}, ${now}) ON CONFLICT (country, title) DO NOTHING`;
   });
   stored += 1;
  } catch { failed += 1; }
 }
 return { countries: countries.length, attempted: due.length, stored, failed };
}

export const formatRefreshSummary = (r: RefreshSummary) => `${r.reason ? `${r.reason} ` : ''}countries=${r.countries} attempted=${r.attempted} stored=${r.stored} failed=${r.failed}`;
