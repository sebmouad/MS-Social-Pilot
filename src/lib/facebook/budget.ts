/**
 * How much of the Meta app's call allowance is left, as this process last saw
 * it — so background reading stands aside before publishing runs out.
 *
 * Meta meters an app, not a Page: every call this installation makes, for
 * every Page, draws on one allowance of about two hundred calls an hour per
 * person who has used the app. A small installation has one such person. Its
 * syncs — every post's metric catalogue, every Page's insights, comments,
 * inbox — can spend that allowance on their own, and once it is gone Facebook
 * refuses everything, a scheduled post included, until the hour rolls over.
 *
 * Facebook reports the share used on every response (`x-app-usage`), and the
 * refusal itself is an error code. Both are noted here; the background jobs
 * ask before they start, and publishing never does. In memory, per process:
 * the worker makes the background calls, so it is the worker's view that
 * matters, and a restart starts optimistic — the first refusal corrects it.
 */

/** Above this share used, background syncs wait and publishing keeps the rest. */
export const BACKGROUND_USAGE_CEILING = 75;
/** How long a reading, or a refusal, is taken to hold. Meta's window is an hour. */
const HOLD_MS = 60 * 60 * 1000;
/** After a refusal, how long to stay off before trying again. */
export const THROTTLE_COOLDOWN_MS = 30 * 60 * 1000;

let usage: { percent: number; at: number } | null = null;
let throttledAt: number | null = null;

/** The share of the allowance Facebook says is used, from a response header. */
export function noteAppUsage(percent: number | null, now: number = Date.now()): void {
  if (percent === null || !Number.isFinite(percent)) return;
  usage = { percent, at: now };
}

/** Facebook refused a call for the app being over its limit. */
export function noteThrottled(now: number = Date.now()): void {
  throttledAt = now;
  usage = { percent: 100, at: now };
}

export type BudgetVerdict = { ok: true } | { ok: false; reason: string; retryInMs: number };

/** Whether a background sync may spend calls now. */
export function backgroundBudget(now: number = Date.now()): BudgetVerdict {
  if (throttledAt !== null && now - throttledAt < THROTTLE_COOLDOWN_MS) {
    return {
      ok: false,
      reason: 'Facebook is refusing calls for this app (request limit reached)',
      retryInMs: THROTTLE_COOLDOWN_MS - (now - throttledAt),
    };
  }
  if (usage && now - usage.at < HOLD_MS && usage.percent >= BACKGROUND_USAGE_CEILING) {
    return {
      ok: false,
      reason: `this app has used ${Math.round(usage.percent)}% of its Facebook call allowance`,
      // Meta's window slides; a quarter of an hour frees a quarter of it.
      retryInMs: 15 * 60 * 1000,
    };
  }
  return { ok: true };
}

/** For tests: forget everything seen. */
export function resetBudget(): void {
  usage = null;
  throttledAt = null;
}
