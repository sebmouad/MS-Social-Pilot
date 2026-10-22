import { Prisma } from '../../../../generated/client';
import { prisma } from '@/server/data';
import { array, fail, type Access } from './access';
import type { Actor, Filters, Holiday, Trend } from '../contracts';
import type { Policy } from '../config';
import type { Copy } from '../copy';
export function matchesKeywords(trend: Pick<Trend, 'title' | 'newsTitle'>, keywords: string[]) {
 const text = `${trend.title} ${trend.newsTitle ?? ''}`.toLocaleLowerCase();
 return !keywords.length || keywords.some(k => text.includes(k.toLocaleLowerCase()));
}
export async function readTrends(actor: Actor, access: Access, f: Filters, policy: Policy, copy: Copy, limit: number) {
 const workspace = await prisma.$queryRaw<Array<{ countries: string[]; keywords: string[] }>>`SELECT "audienceCountries" AS countries, "trendKeywords" AS keywords FROM workspaces WHERE id = ${actor.workspaceId}`;
 const channels = f.targetId ? [f.targetId] : access.channels.map(c => c.id);
 const audiences = await prisma.$queryRaw<Array<{ countries: string[] }>>(Prisma.sql`SELECT "audienceCountries" AS countries FROM targets WHERE "workspaceId" = ${actor.workspaceId} AND id = ANY(${array(channels)})`);
 const countries = [...new Set(audiences.flatMap(a => a.countries.length ? a.countries : workspace[0]?.countries ?? []))].filter(c => /^[A-Z]{2}$/.test(c)).sort();
 const keywords = workspace[0]?.keywords ?? [];
 const since = new Date(Date.now() - policy.trendMaxAgeHours * 60 * 60 * 1000);
 const [holidays, trends, coverage] = await Promise.all([
  prisma.$queryRaw<Holiday[]>(Prisma.sql`SELECT country, date, name, "localName" FROM public_holidays WHERE country = ANY(${array(countries)}) AND date BETWEEN ${f.from} AND ${f.to} ORDER BY date, country, name LIMIT ${policy.maxRows + 1}`),
  prisma.$queryRaw<Trend[]>(Prisma.sql`SELECT id, country, title, traffic, "newsTitle", "newsUrl", "fetchedAt", "startedAt" FROM trending_topics WHERE country = ANY(${array(countries)}) AND "fetchedAt" >= ${since} ORDER BY country, "startedAt" DESC NULLS LAST, id LIMIT ${policy.maxRows + 1}`),
  prisma.$queryRaw<Array<{ country: string; year: number; count: number; fetchedAt: Date }>>(Prisma.sql`SELECT country, year, count, "fetchedAt" FROM holiday_years WHERE country = ANY(${array(countries)}) AND year BETWEEN ${Number(f.from.slice(0, 4))} AND ${Number(f.to.slice(0, 4))}`),
 ]);
 if (holidays.length > policy.maxRows || trends.length > policy.maxRows) return fail('invalid_request', copy.tooMany);
 const filtered = f.showAll ? trends : trends.filter(t => matchesKeywords(t, keywords));
 return { countries, keywords, holidays, coverage, items: filtered.slice(f.offset, f.offset + limit), offset: f.offset, limit, hasMore: filtered.length > f.offset + limit, fetchedAfter: since.toISOString() };
}
