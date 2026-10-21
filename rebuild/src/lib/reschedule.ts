import { synchronousPolicy } from "./config/synchronous-policy";
import type { ReschedulePolicy } from "./config/reschedule-policy";
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
 * by the Root-configured offsets. Day moves keep the
 * workspace-local clock time; hour moves shift the actual instant.
 */
export function moveCandidates(whenIso: string, timeZone: string, nowMs: number, policy: ReschedulePolicy = synchronousPolicy("shared.reschedulePolicy")): MoveCandidate[] {
  const current = new Date(whenIso);
  const wall = instantToWall(current, timeZone);
  const language = policy.locale === 'fr-FR' ? 'fr' : 'en';
  return policy.moves.map(move => {
    const next = move.unit === 'hour'
      ? instantToWall(new Date(current.getTime() + move.amount * HOUR), timeZone)
      : { date: addDaysToKey(wall.date, move.amount), time: wall.time };
    return candidate(move.id, move.label[language], next.date, next.time, timeZone, nowMs);
  });
}

/** Workspace time with Root-selected language and clock format. */
export function formatWhen(instant: Date | string, timeZone: string, policy: ReschedulePolicy = synchronousPolicy("shared.reschedulePolicy")): string {
  return new Intl.DateTimeFormat(policy.locale, { timeZone, hour12: policy.hour12, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(typeof instant === "string" ? new Date(instant) : instant);
}

export function formatWallTime(date: string, time: string, timeZone: string, policy: ReschedulePolicy = synchronousPolicy("shared.reschedulePolicy")): string | null {
  const resolved = wallTimeToInstant(date, time, timeZone);
  return resolved.ok ? formatWhen(resolved.instant, timeZone, policy) : null;
}

const SAFE_FAILURES = [
  "Choose a future", "does not exist on that day", "Choose a valid date", "cannot be rescheduled", "still waiting to publish",
  "no longer a member", "do not have permission", "outside your channel", "You cannot reschedule", "deletion is in progress", "unavailable in your channel scope",
];

/** Customer-safe text for a failed reschedule; unknown errors stay generic. */
export function rescheduleFailureMessage(error: unknown, policy: ReschedulePolicy = synchronousPolicy("shared.reschedulePolicy")): string {
  const message = error instanceof Error ? error.message : "";
  return SAFE_FAILURES.some(phrase => message.includes(phrase)) ? message : policy.failure[policy.locale === 'fr-FR' ? 'fr' : 'en'];
}
