import { addDaysToKey, instantToWall, wallTimeToInstant } from "./calendar-dates";

export type MoveCandidate = {
  id: string;
  label: string;
  date: string;
  time: string;
  /** Why this move cannot be chosen, when it cannot. */
  unavailable?: "past" | "skipped";
};

const HOUR = 60 * 60 * 1000;

function candidate(id: string, label: string, date: string, time: string, timeZone: string, nowMs: number): MoveCandidate {
  const resolved = wallTimeToInstant(date, time, timeZone);
  if (!resolved.ok) return { id, label, date, time, unavailable: "skipped" };
  return { id, label, date, time, ...(resolved.instant.getTime() <= nowMs ? { unavailable: "past" as const } : {}) };
}

/**
 * Keyboard- and touch-friendly alternatives to dragging: move a scheduled post
 * earlier or later by an hour, a day or a week. Day and week moves keep the
 * workspace-local clock time; hour moves shift the actual instant.
 */
export function moveCandidates(whenIso: string, timeZone: string, nowMs: number): MoveCandidate[] {
  const current = new Date(whenIso);
  const wall = instantToWall(current, timeZone);
  const byHours = (hours: number) => instantToWall(new Date(current.getTime() + hours * HOUR), timeZone);
  const earlierHour = byHours(-1);
  const laterHour = byHours(1);
  return [
    candidate("hour-earlier", "1 hour earlier", earlierHour.date, earlierHour.time, timeZone, nowMs),
    candidate("hour-later", "1 hour later", laterHour.date, laterHour.time, timeZone, nowMs),
    candidate("day-earlier", "1 day earlier", addDaysToKey(wall.date, -1), wall.time, timeZone, nowMs),
    candidate("day-later", "1 day later", addDaysToKey(wall.date, 1), wall.time, timeZone, nowMs),
    candidate("week-earlier", "1 week earlier", addDaysToKey(wall.date, -7), wall.time, timeZone, nowMs),
    candidate("week-later", "1 week later", addDaysToKey(wall.date, 7), wall.time, timeZone, nowMs),
  ];
}

/** "Tue, Oct 20, 4:00 PM" in the workspace time zone. Fixed locale: the UI is English. */
export function formatWhen(instant: Date | string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(typeof instant === "string" ? new Date(instant) : instant);
}

export function formatWallTime(date: string, time: string, timeZone: string): string | null {
  const resolved = wallTimeToInstant(date, time, timeZone);
  return resolved.ok ? formatWhen(resolved.instant, timeZone) : null;
}

const SAFE_FAILURES = [
  "Choose a future", "does not exist on that day", "Choose a valid date", "cannot be rescheduled", "still waiting to publish",
  "no longer a member", "do not have permission", "outside your channel", "You cannot reschedule", "deletion is in progress", "unavailable in your channel scope",
];

/** Customer-safe text for a failed reschedule; unknown errors stay generic. */
export function rescheduleFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return SAFE_FAILURES.some(phrase => message.includes(phrase)) ? message : "The post could not be moved. Reload the calendar and try again.";
}
