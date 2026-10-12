/**
 * Seasonal posting modes (NEXT_PHASES H2): between two dates, a Page's queue
 * pauses, moves its times, keeps fewer of them or adds more. Defined by the
 * user per Page; none exist by default. A plain module, shared by the queue
 * and the screens.
 */

export const SEASON_RULES = ['pause', 'shift', 'fewer', 'more'] as const;
export type SeasonRule = (typeof SEASON_RULES)[number];

export interface Season {
  startsOn: string;
  endsOn: string;
  /** Empty for every Page. */
  targetIds: string[];
  rule: string;
  shiftMinutes: number;
  /** `HH:mm`. */
  extraTimes: string[];
}

/** What the queue does on one day. */
export interface DayAdjustment {
  pause: boolean;
  shiftMinutes: number;
  fewer: boolean;
  extra: Array<{ hour: number; minute: number }>;
}

const parseTime = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
};

/**
 * How the seasons that cover these Pages change one day (`yyyy-MM-dd`), or
 * null when none does. A post to several Pages goes out once, so a season on
 * any of them counts: one pause pauses it, shifts add up, extra times join.
 */
export function adjustmentFor(seasons: Season[], targetIds: string[], day: string): DayAdjustment | null {
  const active = seasons.filter(
    (season) =>
      season.startsOn <= day &&
      day <= season.endsOn &&
      (season.targetIds.length === 0 || targetIds.length === 0 || season.targetIds.some((id) => targetIds.includes(id))),
  );
  if (active.length === 0) return null;
  const extra = active
    .filter((season) => season.rule === 'more')
    .flatMap((season) => season.extraTimes.map(parseTime))
    .filter((time): time is { hour: number; minute: number } => time !== null);
  return {
    pause: active.some((season) => season.rule === 'pause'),
    shiftMinutes: active.filter((season) => season.rule === 'shift').reduce((sum, season) => sum + season.shiftMinutes, 0),
    fewer: active.some((season) => season.rule === 'fewer'),
    extra,
  };
}

/**
 * One day's queue times after a season's adjustment: extra times added,
 * every other time dropped for "fewer" (the first kept), all moved by the
 * shift. A time moved off the day is dropped rather than landing on another.
 */
export function adjustDaySlots(
  slots: Array<{ hour: number; minute: number }>,
  adjustment: DayAdjustment | null,
): Array<{ hour: number; minute: number }> {
  if (!adjustment) return slots;
  if (adjustment.pause) return [];
  const byMinute = new Map<number, { hour: number; minute: number }>();
  for (const slot of [...slots, ...adjustment.extra]) byMinute.set(slot.hour * 60 + slot.minute, slot);
  let minutes = [...byMinute.keys()].sort((a, b) => a - b);
  if (adjustment.fewer) minutes = minutes.filter((_, index) => index % 2 === 0);
  return minutes
    .map((minute) => minute + adjustment.shiftMinutes)
    .filter((minute) => minute >= 0 && minute < 24 * 60)
    .map((minute) => ({ hour: Math.floor(minute / 60), minute: minute % 60 }));
}
