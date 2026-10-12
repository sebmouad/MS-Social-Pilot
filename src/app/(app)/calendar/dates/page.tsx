import { getLocale, getTranslations } from 'next-intl/server';

import { KeyDatesClient } from '@/components/KeyDatesClient';
import { requirePage } from '@/lib/auth';
import { audienceOf, effectiveAudience } from '@/lib/audience';
import { keyDaysBetween } from '@/lib/calendar-days';
import { canManageSettings } from '@/lib/constants';
import { uncoveredCountries } from '@/lib/holidays';
import { screenMetadata } from '@/lib/metadata';
import { ChannelsLayout } from '@/components/ChannelsLayout';
import { loadPageFilter } from '@/lib/page-filter';
import { prisma } from '@/lib/prisma';
import { formatInZone } from '@/lib/time';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return screenMetadata('keyDates.title');
}

/** How far ahead the upcoming list looks. */
const AHEAD_DAYS = 90;

/**
 * Key dates and seasons (NEXT_PHASES H2): what is coming up for the Pages in
 * the selection, the team's own dates, and the seasonal modes that change
 * when the queue posts.
 */
export default async function KeyDatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requirePage();
  const t = await getTranslations('keyDates');
  const tDays = await getTranslations('calendar.days');
  const locale = await getLocale();
  const filter = await loadPageFilter(auth, await searchParams);
  const timezone = auth.workspace.timezone;
  const now = new Date();
  const from = formatInZone(now, timezone, 'yyyy-MM-dd');
  const to = formatInZone(new Date(now.getTime() + AHEAD_DAYS * 86_400_000), timezone, 'yyyy-MM-dd');

  const [byDate, keyDates, seasons, workspace, targets] = await Promise.all([
    keyDaysBetween(auth.workspace.id, filter.ids, from, to),
    prisma.keyDate.findMany({ where: { workspaceId: auth.workspace.id }, orderBy: { date: 'asc' } }),
    prisma.seasonalMode.findMany({ where: { workspaceId: auth.workspace.id }, orderBy: { startsOn: 'asc' } }),
    prisma.workspace.findUniqueOrThrow({
      where: { id: auth.workspace.id },
      select: { audienceCountries: true, audienceLanguages: true, audienceTimezone: true, audienceCalendars: true },
    }),
    prisma.target.findMany({
      where: { workspaceId: auth.workspace.id, id: { in: filter.ids } },
      select: { audienceCountries: true, audienceLanguages: true, audienceTimezone: true, audienceCalendars: true },
    }),
  ]);

  const audiences = targets.map((target) => effectiveAudience(audienceOf(target), audienceOf(workspace), timezone));
  const countries = [...new Set(audiences.filter((a) => a.calendars.includes('public_holidays')).flatMap((a) => a.countries))];
  const uncovered = await uncoveredCountries(countries);
  const regions = new Intl.DisplayNames([locale], { type: 'region' });
  const followsAnything = audiences.some((audience) => audience.calendars.length > 0);

  const upcoming = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date, days]) =>
    days.map((day) => ({
      date,
      kind: day.kind,
      name:
        day.kind === 'computed'
          ? tDays(day.key)
          : day.kind === 'custom'
            ? day.title
            : `${locale.startsWith('en') ? day.name : day.localName} (${regions.of(day.country) ?? day.country})`,
    })),
  );

  return (
    <ChannelsLayout auth={auth} selection={filter}>
    <div className="min-w-0 flex-1 space-y-6">
      <header>
        <h1 className="text-xl font-semibold sm:text-2xl text-slate-900">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('intro')}</p>
      </header>
      <KeyDatesClient
        canEdit={canManageSettings(auth.role)}
        pages={filter.pages.map((page) => ({ id: page.id, name: page.name }))}
        upcoming={upcoming}
        followsAnything={followsAnything}
        hindu={audiences.some((audience) => audience.calendars.includes('hindu'))}
        uncovered={uncovered.map((code) => regions.of(code) ?? code)}
        keyDates={keyDates.map((row) => ({ id: row.id, date: row.date, title: row.title, yearly: row.yearly, targetIds: row.targetIds }))}
        seasons={seasons.map((row) => ({
          id: row.id,
          name: row.name,
          startsOn: row.startsOn,
          endsOn: row.endsOn,
          targetIds: row.targetIds,
          rule: row.rule,
          shiftMinutes: row.shiftMinutes,
          extraTimes: row.extraTimes,
        }))}
        today={from}
      />
    </div>
    </ChannelsLayout>
  );
}
