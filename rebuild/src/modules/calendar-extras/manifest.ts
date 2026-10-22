import type { Area } from './contracts';
/** Route metadata inherits existing feature grants; do not add duplicate feature IDs to PAGES. */
export const CALENDAR_EXTRAS_SCREENS = {
 dates: { featureId: 'publishing/calendar', href: '/publishing/calendar/dates', title: 'Key dates' },
 seasons: { featureId: 'publishing/calendar', href: '/publishing/calendar/seasons', title: 'Seasons' },
 feeds: { featureId: 'publishing/calendar', href: '/publishing/calendar/feeds', title: 'Calendar subscriptions' },
 trends: { featureId: 'publishing/calendar', href: '/publishing/calendar/trends', title: 'Holidays & trends' },
 notes: { featureId: 'analytics/overview', href: '/analytics/notes', title: 'Chart notes' },
} as const satisfies Record<Area, { featureId: string; href: string; title: string }>;
export const CALENDAR_EXTRAS_ROOT_PREFIX = 'calendarExtras.';
