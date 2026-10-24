import { CALENDAR_EXTRAS_SCREENS } from '../manifest';
import type { Area, Locale } from '../contracts';
import { settings } from './settings';

export type CalendarExtrasLink = { area: Area; href: string; label: string };

/** Contextual sidebar links with Root-managed labels. A settings failure hides the links instead of breaking the shell. */
export async function calendarExtrasLinks(locale: Locale, areas: readonly Area[]): Promise<CalendarExtrasLink[]> {
 try {
  const { copy } = await settings(locale);
  return areas.map(area => ({ area, href: CALENDAR_EXTRAS_SCREENS[area].href, label: copy[area] }));
 } catch { return []; }
}
