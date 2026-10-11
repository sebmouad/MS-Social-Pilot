import { prisma } from './prisma';
import { findMetric, isServed } from './facebook/metrics';
import { humanise } from './analytics';
import { sumKnown } from './aggregate';

/**
 * Page metrics a person pins from the full list (analytics → Overview) so they
 * show as tiles on the Analysis and All profiles views (NEXT_PHASES B3).
 * Stored on the user as `metric::period` keys.
 */

export const MAX_PINNED = 8;

/** Figures that are a level on a day (a follower count), not something that happened that day. */
const LEVEL_METRICS = new Set(['page_fans', 'page_follows', 'page_fans_online_per_day']);

/**
 * Whether a key names a daily Page metric Meta still serves, as one number.
 * Daily only: weekly and 28-day figures overlap, so they cannot be added up.
 */
export function isPinnable(key: string): boolean {
  const [name, period] = key.split('::');
  if (!name || period !== 'day') return false;
  const definition = findMetric(name, 'page');
  return Boolean(definition && isServed(definition) && !definition.breakdown && definition.periods.includes('day'));
}

/** Keep the valid keys, once each, at most {@link MAX_PINNED}. */
export function cleanPinned(keys: ReadonlyArray<string>): string[] {
  return [...new Set(keys)].filter(isPinnable).slice(0, MAX_PINNED);
}

export interface PinnedFigure {
  key: string;
  label: string;
  description: string;
  value: number | null;
  /** Counts people: summed over several profiles it is a ceiling ("up to"). */
  unique: boolean;
  /** Profiles that had a figure for it in the window. */
  profiles: number;
}

/**
 * Each pinned metric over the window, added up across the profiles. Things
 * that happen (views, clicks) are summed over the days; a level (followers)
 * takes each profile's last value. Unique-people metrics are flagged so the
 * screen can say "up to" when several profiles are summed.
 */
export async function readPinnedFigures(options: {
  keys: string[];
  targetIds: string[];
  from: Date;
  to: Date;
}): Promise<PinnedFigure[]> {
  const keys = cleanPinned(options.keys);
  if (keys.length === 0 || options.targetIds.length === 0) return [];

  const rows = await prisma.pageInsight.findMany({
    where: {
      targetId: { in: options.targetIds },
      metric: { in: keys.map((key) => key.split('::')[0]!) },
      endTime: { gt: options.from, lte: options.to },
    },
    select: { targetId: true, metric: true, period: true, endTime: true, numeric: true },
    orderBy: { endTime: 'asc' },
  });

  return keys.map((key) => {
    const [name, period] = key.split('::') as [string, string];
    const definition = findMetric(name, 'page')!;
    const level = LEVEL_METRICS.has(name);
    const perProfile = options.targetIds.map((targetId) => {
      const values = rows
        .filter((row) => row.targetId === targetId && row.metric === name && row.period === period)
        .map((row) => row.numeric)
        .filter((value): value is number => value !== null);
      if (values.length === 0) return null;
      return level ? values[values.length - 1]! : values.reduce((sum, value) => sum + value, 0);
    });
    const value = sumKnown(perProfile);
    return {
      key,
      label: humanise(name),
      description: definition.description,
      value: value === null ? null : Math.round(value),
      unique: name.includes('_unique'),
      profiles: perProfile.filter((entry) => entry !== null).length,
    };
  });
}
