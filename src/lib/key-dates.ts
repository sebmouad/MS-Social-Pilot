/**
 * Dates worth a post (NEXT_PHASES H2), from the calendars a Page's audience
 * follows (H0). Nothing is on by default and no calendar is favoured: each
 * Page ticks the ones its audience keeps.
 *
 * Moveable feasts are computed, never typed in: Easter by the computus, the
 * Islamic, Hebrew and Chinese dates with the calendars built into `Intl`.
 * Hindu festivals follow local lunar reckoning that `Intl` does not carry, so
 * none are computed — a wrong date on a content calendar is worse than none;
 * they arrive with a country's public holidays, or the team adds them.
 *
 * A plain module: no database, safe anywhere.
 */

export interface ComputedDay {
  /** `yyyy-MM-dd`. */
  date: string;
  /** Message key under `calendar.days`. */
  key: string;
  calendar: string;
}

/** International observances shared everywhere (the `international_days` calendar). */
export const INTERNATIONAL_DAYS: Array<{ date: string; key: string }> = [
  { date: '01-01', key: 'newYear' },
  { date: '02-04', key: 'worldCancerDay' },
  { date: '02-14', key: 'valentines' },
  { date: '03-08', key: 'womensDay' },
  { date: '03-20', key: 'happinessDay' },
  { date: '04-07', key: 'worldHealthDay' },
  { date: '04-22', key: 'earthDay' },
  { date: '05-01', key: 'labourDay' },
  { date: '06-05', key: 'environmentDay' },
  { date: '06-21', key: 'musicDay' },
  { date: '09-21', key: 'peaceDay' },
  { date: '09-27', key: 'tourismDay' },
  { date: '09-29', key: 'heartDay' },
  { date: '10-01', key: 'coffeeDay' },
  { date: '10-10', key: 'mentalHealthDay' },
  { date: '10-16', key: 'foodDay' },
  { date: '10-31', key: 'halloween' },
  { date: '11-27', key: 'blackFriday' },
  { date: '12-31', key: 'newYearsEve' },
];

const pad = (value: number) => String(value).padStart(2, '0');
const iso = (date: Date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

/** Western (Gregorian) Easter Sunday — the anonymous Gregorian algorithm. */
export function westernEaster(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Orthodox Easter Sunday: the Julian computus, moved onto the Gregorian calendar. */
export function orthodoxEaster(year: number): Date {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const julianToGregorian = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  return addDays(new Date(Date.UTC(year, month - 1, day)), julianToGregorian);
}

/** Black Friday: the day after the fourth Thursday of November. */
function blackFriday(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1));
  const firstThursday = 1 + ((4 - first.getUTCDay() + 7) % 7);
  return `${year}-11-${pad(firstThursday + 22)}`;
}

/** Every day of a Gregorian year with its date in another calendar, once per calendar. */
const lunarCache = new Map<string, Array<{ date: string; month: string; day: number }>>();
function yearIn(calendar: 'islamic-umalqura' | 'hebrew' | 'chinese', year: number) {
  const cacheKey = `${calendar}:${year}`;
  const cached = lunarCache.get(cacheKey);
  if (cached) return cached;
  const format = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, {
    timeZone: 'UTC',
    month: calendar === 'hebrew' ? 'long' : 'numeric',
    day: 'numeric',
  });
  const days: Array<{ date: string; month: string; day: number }> = [];
  for (let date = new Date(Date.UTC(year, 0, 1)); date.getUTCFullYear() === year; date = addDays(date, 1)) {
    const parts = Object.fromEntries(format.formatToParts(date).map((part) => [part.type, part.value]));
    days.push({ date: iso(date), month: String(parts.month), day: Number(parts.day) });
  }
  lunarCache.set(cacheKey, days);
  return days;
}

/** Gregorian dates in `year` whose date in `calendar` is month/day. */
function datesOf(calendar: 'islamic-umalqura' | 'hebrew' | 'chinese', year: number, month: string, day: number): string[] {
  return yearIn(calendar, year)
    .filter((entry) => entry.month === month && entry.day === day)
    .map((entry) => entry.date);
}

const LUNAR: Record<string, Array<{ key: string; calendar: 'islamic-umalqura' | 'hebrew' | 'chinese'; month: string; day: number }>> = {
  islamic: [
    { key: 'islamicNewYear', calendar: 'islamic-umalqura', month: '1', day: 1 },
    { key: 'mawlid', calendar: 'islamic-umalqura', month: '3', day: 12 },
    { key: 'ramadanStart', calendar: 'islamic-umalqura', month: '9', day: 1 },
    { key: 'eidAlFitr', calendar: 'islamic-umalqura', month: '10', day: 1 },
    { key: 'eidAlAdha', calendar: 'islamic-umalqura', month: '12', day: 10 },
  ],
  jewish: [
    { key: 'roshHashanah', calendar: 'hebrew', month: 'Tishri', day: 1 },
    { key: 'yomKippur', calendar: 'hebrew', month: 'Tishri', day: 10 },
    { key: 'sukkot', calendar: 'hebrew', month: 'Tishri', day: 15 },
    { key: 'hanukkah', calendar: 'hebrew', month: 'Kislev', day: 25 },
    { key: 'purim', calendar: 'hebrew', month: 'Adar', day: 14 },
    { key: 'purim', calendar: 'hebrew', month: 'Adar II', day: 14 },
    { key: 'passover', calendar: 'hebrew', month: 'Nisan', day: 15 },
    { key: 'shavuot', calendar: 'hebrew', month: 'Sivan', day: 6 },
  ],
  lunar_new_year: [
    { key: 'lunarNewYear', calendar: 'chinese', month: '1', day: 1 },
    { key: 'lanternFestival', calendar: 'chinese', month: '1', day: 15 },
    { key: 'dragonBoat', calendar: 'chinese', month: '5', day: 5 },
    { key: 'midAutumn', calendar: 'chinese', month: '8', day: 15 },
  ],
  buddhist: [{ key: 'buddhasBirthday', calendar: 'chinese', month: '4', day: 8 }],
};

/** The computed days of these calendars in one Gregorian year, by date. */
export function computedDays(year: number, calendars: readonly string[]): ComputedDay[] {
  const out: ComputedDay[] = [];
  const wants = new Set(calendars);
  if (wants.has('international_days')) {
    for (const day of INTERNATIONAL_DAYS) {
      out.push({ date: day.key === 'blackFriday' ? blackFriday(year) : `${year}-${day.date}`, key: day.key, calendar: 'international_days' });
    }
  }
  if (wants.has('christian_western')) {
    const easter = westernEaster(year);
    out.push(
      { date: iso(addDays(easter, -2)), key: 'goodFriday', calendar: 'christian_western' },
      { date: iso(easter), key: 'easter', calendar: 'christian_western' },
      { date: iso(addDays(easter, 49)), key: 'pentecost', calendar: 'christian_western' },
      { date: `${year}-12-24`, key: 'christmasEve', calendar: 'christian_western' },
      { date: `${year}-12-25`, key: 'christmas', calendar: 'christian_western' },
    );
  }
  if (wants.has('christian_orthodox')) {
    out.push(
      { date: `${year}-01-07`, key: 'orthodoxChristmas', calendar: 'christian_orthodox' },
      { date: iso(orthodoxEaster(year)), key: 'orthodoxEaster', calendar: 'christian_orthodox' },
    );
  }
  for (const [calendar, entries] of Object.entries(LUNAR)) {
    if (!wants.has(calendar)) continue;
    for (const entry of entries) {
      for (const date of datesOf(entry.calendar, year, entry.month, entry.day)) out.push({ date, key: entry.key, calendar });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** The computed days between two `yyyy-MM-dd` dates, inclusive. */
export function computedDaysBetween(from: string, to: string, calendars: readonly string[]): ComputedDay[] {
  const years: number[] = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) years.push(year);
  return years.flatMap((year) => computedDays(year, calendars)).filter((day) => day.date >= from && day.date <= to);
}

/** A custom date's occurrences between two dates: once, or every year on the same day. */
export function customDatesBetween(date: string, yearly: boolean, from: string, to: string): string[] {
  if (!yearly) return date >= from && date <= to ? [date] : [];
  const out: string[] = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    const candidate = `${year}${date.slice(4)}`;
    // 29 February keeps to leap years.
    if (candidate.endsWith('-02-29') && new Date(`${candidate}T00:00:00Z`).getUTCDate() !== 29) continue;
    if (candidate >= from && candidate <= to && candidate >= date) out.push(candidate);
  }
  return out;
}
