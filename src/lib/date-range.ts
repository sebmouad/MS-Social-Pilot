import { formatInZone, localInputToUtc } from './time';

/**
 * The date ranges analytics can be read over, as Meta Business Suite and the
 * scheduling tools offer them: named periods first, then any two dates.
 *
 * Every boundary is a midnight in the workspace's own zone, not UTC's, so
 * "yesterday" for a client in Toronto is their yesterday. A range runs from
 * `from` (inclusive) to `to` (exclusive, or "now" for a period still running).
 */
export const RANGE_PRESETS = [
  'today',
  'yesterday',
  '7d',
  '30d',
  '90d',
  'thisMonth',
  'lastMonth',
  'thisYear',
  'all',
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];
export type RangeKey = RangePreset | 'custom';

export interface DateRange {
  key: RangeKey;
  from: Date;
  to: Date;
  /** Whole days covered, rounded up: what "compared with the N days before" uses. */
  days: number;
  /** `YYYY-MM-DD` of the first and last day shown, in the workspace's zone. */
  fromDay: string;
  toDay: string;
}

/** Facebook keeps about two years of insights; "all time" is that much. */
export const ALL_TIME_DAYS = 730;

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT: RangePreset = '30d';

/** Midnight at the start of a `YYYY-MM-DD` day in the given zone. */
function startOfDay(day: string, timeZone: string): Date {
  return localInputToUtc(`${day}T00:00`, timeZone);
}

/** `YYYY-MM-DD` of the day `offset` days after `day`, calendar-wise. */
function shiftDay(day: string, offset: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
}

function isDay(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)));
}

/**
 * Read a range from a URL's parameters.
 *
 * `range=<preset>`, or `from`/`to` days for a custom range. The older `days=N`
 * links still work: 7, 30 and 90 map to their presets, any other count to the
 * last N days.
 */
export function parseRange(
  params: { range?: string; from?: string; to?: string; days?: string },
  timeZone: string,
  now: Date = new Date(),
): DateRange {
  const today = formatInZone(now, timeZone, 'yyyy-MM-dd');
  const build = (key: RangeKey, fromDay: string, lastDay: string, to?: Date): DateRange => {
    const from = startOfDay(fromDay, timeZone);
    const end = to ?? startOfDay(shiftDay(lastDay, 1), timeZone);
    const bounded = end > now ? now : end;
    return {
      key,
      from,
      to: bounded,
      days: Math.max(1, Math.ceil((bounded.getTime() - from.getTime()) / DAY_MS)),
      fromDay,
      toDay: lastDay,
    };
  };

  if (isDay(params.from) && isDay(params.to)) {
    const [first, last] = params.from <= params.to ? [params.from, params.to] : [params.to, params.from];
    // Never past today, and never further back than Facebook keeps.
    const lastDay = last > today ? today : last;
    const earliest = shiftDay(today, -ALL_TIME_DAYS);
    return build('custom', first < earliest ? earliest : first, lastDay);
  }

  let preset = (RANGE_PRESETS as readonly string[]).includes(params.range ?? '')
    ? (params.range as RangePreset)
    : null;
  if (!preset && params.days) {
    const days = Number.parseInt(params.days, 10);
    if (days === 7 || days === 30 || days === 90) preset = `${days}d` as RangePreset;
    else if (Number.isFinite(days) && days > 0 && days <= ALL_TIME_DAYS) {
      return build('custom', shiftDay(today, -(days - 1)), today, now);
    }
  }

  const [year, month] = today.split('-');
  switch (preset ?? DEFAULT) {
    case 'today':
      return build('today', today, today, now);
    case 'yesterday':
      return build('yesterday', shiftDay(today, -1), shiftDay(today, -1));
    case '7d':
      return build('7d', shiftDay(today, -6), today, now);
    case '90d':
      return build('90d', shiftDay(today, -89), today, now);
    case 'thisMonth':
      return build('thisMonth', `${year}-${month}-01`, today, now);
    case 'lastMonth': {
      const firstOfThis = `${year}-${month}-01`;
      const lastOfPrevious = shiftDay(firstOfThis, -1);
      return build('lastMonth', `${lastOfPrevious.slice(0, 7)}-01`, lastOfPrevious);
    }
    case 'thisYear':
      return build('thisYear', `${year}-01-01`, today, now);
    case 'all':
      return build('all', shiftDay(today, -(ALL_TIME_DAYS - 1)), today, now);
    case '30d':
    default:
      return build('30d', shiftDay(today, -29), today, now);
  }
}

/** The URL parameters that reproduce a range, for links that must keep it. */
export function rangeParams(range: DateRange): Record<string, string> {
  return range.key === 'custom' ? { from: range.fromDay, to: range.toDay } : { range: range.key };
}

/** The same as a query string fragment: `range=30d` or `from=…&to=…`. */
export function rangeQuery(range: DateRange): string {
  return new URLSearchParams(rangeParams(range)).toString();
}

/**
 * What a period is measured against: the stretch just before it, or the same
 * dates a year earlier — the fair comparison for a seasonal business, whose
 * December is never going to look like its November.
 */
export const COMPARE_MODES = ['previous', 'year'] as const;
export type CompareMode = (typeof COMPARE_MODES)[number];

export function parseCompare(raw: string | undefined | null): CompareMode {
  return raw === 'year' ? 'year' : 'previous';
}

/** The window `from`–`to` is compared with: `[from, to)` before it, or a year back. */
export function comparisonWindow(from: Date, to: Date, mode: CompareMode): { from: Date; to: Date } {
  if (mode === 'year') {
    const back = (date: Date) => {
      const moved = new Date(date);
      moved.setUTCFullYear(moved.getUTCFullYear() - 1);
      return moved;
    };
    return { from: back(from), to: back(to) };
  }
  const length = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - length), to: from };
}
