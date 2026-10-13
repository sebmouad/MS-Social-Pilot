import { audienceOf, effectiveAudience } from './audience';
import { holidaysBetween } from './holidays';
import { computedDaysBetween, customDatesBetween } from './key-dates';
import { prisma } from './prisma';

/**
 * The days worth a post on the calendar, for the Pages being
 * looked at: the calendars and countries their audiences follow, plus the
 * team's own key dates. Nothing shows for a Page whose audience ticks nothing.
 */

export type KeyDay =
  | { date: string; kind: 'computed'; key: string }
  | { date: string; kind: 'holiday'; name: string; localName: string; country: string }
  | { date: string; kind: 'custom'; id: string; title: string };

/** Key days between two `yyyy-MM-dd` dates, by date. */
export async function keyDaysBetween(workspaceId: string, targetIds: string[], from: string, to: string): Promise<Map<string, KeyDay[]>> {
  const [workspace, targets, custom] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { timezone: true, audienceCountries: true, audienceLanguages: true, audienceTimezone: true, audienceCalendars: true },
    }),
    prisma.target.findMany({
      where: { workspaceId, id: { in: targetIds } },
      select: { audienceCountries: true, audienceLanguages: true, audienceTimezone: true, audienceCalendars: true },
    }),
    prisma.keyDate.findMany({ where: { workspaceId }, orderBy: { date: 'asc' } }),
  ]);
  const workspaceAudience = audienceOf(workspace);
  const calendars = new Set<string>();
  const countries = new Set<string>();
  for (const target of targets) {
    const audience = effectiveAudience(audienceOf(target), workspaceAudience, workspace.timezone);
    audience.calendars.forEach((calendar) => calendars.add(calendar));
    if (audience.calendars.includes('public_holidays')) audience.countries.forEach((country) => countries.add(country));
  }

  const days: KeyDay[] = [
    ...computedDaysBetween(from, to, [...calendars]).map((day) => ({ date: day.date, kind: 'computed' as const, key: day.key })),
    ...(await holidaysBetween([...countries], from, to)).map((holiday) => ({
      date: holiday.date,
      kind: 'holiday' as const,
      name: holiday.name,
      localName: holiday.localName,
      country: holiday.country,
    })),
    ...custom.flatMap((row) => {
      // A date kept for some Pages only shows when one of them is looked at.
      if (row.targetIds.length > 0 && !row.targetIds.some((id) => targetIds.includes(id))) return [];
      return customDatesBetween(row.date, row.yearly, from, to).map((date) => ({ date, kind: 'custom' as const, id: row.id, title: row.title }));
    }),
  ];

  const byDate = new Map<string, KeyDay[]>();
  for (const day of days) {
    const list = byDate.get(day.date) ?? [];
    // The same holiday in two countries of the selection shows once.
    if (day.kind === 'holiday' && list.some((other) => other.kind === 'holiday' && other.name === day.name)) continue;
    list.push(day);
    byDate.set(day.date, list);
  }
  return byDate;
}
