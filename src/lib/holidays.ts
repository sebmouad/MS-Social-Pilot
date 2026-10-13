import { prisma } from './prisma';

/**
 * Public holidays of every country an audience names, from
 * the open Nager.Date dataset (over 100 countries, no key). Fetched by the
 * worker for the countries in use, one country-year at a time, stored and
 * shared by every workspace; screens read the database only.
 */

export const HOLIDAYS_SOURCE = 'https://date.nager.at/api/v3/PublicHolidays';

/** Country-years asked for per run: a new audience fills in over a few runs, never a burst. */
const PER_RUN = 12;
/** A country-year is asked again after this long, to pick up corrections. */
const REFRESH_DAYS = 90;

/** Every country named by a workspace's or a Page's audience. */
export async function countriesInUse(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ country: string }>>`
    SELECT DISTINCT unnest("audienceCountries") AS country FROM workspaces
    UNION
    SELECT DISTINCT unnest("audienceCountries") AS country FROM targets
  `;
  return rows.map((row) => row.country).filter((code) => /^[A-Z]{2}$/.test(code)).sort();
}

/**
 * Fetch the holidays still missing (this year and next) for the countries in
 * use. Returns the country-years fetched. A country the dataset does not cover
 * is remembered with 0 holidays, so it is not asked again for months.
 */
export async function refreshHolidays(now: Date, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const countries = await countriesInUse();
  if (countries.length === 0) return [];
  const year = now.getUTCFullYear();
  const years = [year, year + 1];
  const known = await prisma.holidayYear.findMany({ where: { country: { in: countries }, year: { in: years } } });
  const fresh = new Set(
    known
      .filter((row) => now.getTime() - row.fetchedAt.getTime() < REFRESH_DAYS * 86_400_000)
      .map((row) => `${row.country}:${row.year}`),
  );
  const due = countries.flatMap((country) => years.map((y) => ({ country, year: y }))).filter((entry) => !fresh.has(`${entry.country}:${entry.year}`));

  const fetched: string[] = [];
  for (const { country, year: y } of due.slice(0, PER_RUN)) {
    const response = await fetchImpl(`${HOLIDAYS_SOURCE}/${y}/${country}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    let holidays: Array<{ date: string; name: string; localName: string }> = [];
    if (response.status === 200) {
      const body = (await response.json()) as Array<{ date?: unknown; name?: unknown; localName?: unknown; global?: unknown }>;
      holidays = (Array.isArray(body) ? body : [])
        // Nationwide only: a regional holiday is not a day the whole audience keeps.
        .filter((entry) => entry.global !== false && typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && typeof entry.name === 'string')
        .map((entry) => ({
          date: entry.date as string,
          name: String(entry.name).slice(0, 200),
          localName: String(entry.localName ?? entry.name).slice(0, 200),
        }));
    } else if (response.status !== 204 && response.status !== 404) {
      // A hiccup on their side: try again next run, without failing the others.
      continue;
    }
    await prisma.$transaction([
      prisma.publicHoliday.deleteMany({ where: { country, date: { startsWith: `${y}-` } } }),
      prisma.publicHoliday.createMany({ data: holidays.map((holiday) => ({ country, ...holiday })), skipDuplicates: true }),
      prisma.holidayYear.upsert({
        where: { country_year: { country, year: y } },
        create: { country, year: y, count: holidays.length, fetchedAt: now },
        update: { count: holidays.length, fetchedAt: now },
      }),
    ]);
    fetched.push(`${country}:${y}`);
  }
  return fetched;
}

/** The stored holidays of these countries between two `yyyy-MM-dd` dates. */
export async function holidaysBetween(countries: string[], from: string, to: string) {
  if (countries.length === 0) return [];
  return prisma.publicHoliday.findMany({
    where: { country: { in: countries }, date: { gte: from, lte: to } },
    orderBy: [{ date: 'asc' }, { country: 'asc' }],
  });
}

/** Countries the dataset has no holidays for (fetched, none found). */
export async function uncoveredCountries(countries: string[]): Promise<string[]> {
  if (countries.length === 0) return [];
  const rows = await prisma.holidayYear.groupBy({
    by: ['country'],
    where: { country: { in: countries } },
    _max: { count: true },
  });
  return rows.filter((row) => (row._max.count ?? 0) === 0).map((row) => row.country);
}
