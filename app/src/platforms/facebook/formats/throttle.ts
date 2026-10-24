import { FacebookApiError } from '../publishing';

/**
 * Neutral rate-limit signal attached to outcomes. It never changes whether a write is
 * resent: an uncertain write stays uncertain. It only tells the host when a later
 * (read or reconcile) attempt is reasonable. Facebook-specific codes stay in this file.
 *
 * Codes are UNVERIFIED against live Graph: 4 (application), 17 (user), 32 (page),
 * 613 (custom), 80001-80014 (business-use-case limits), plus HTTP 429.
 */
export interface FacebookThrottle { retryAfterSeconds: number | null }

const THROTTLE_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);
const MAX_RETRY_AFTER_SECONDS = 86_400;
export const FACEBOOK_DEFAULT_THROTTLE_SECONDS = 300;

/**
 * Returns a throttle signal when the error is a rate-limit answer, else null.
 * A numeric `retryAfterSeconds` set by the transport is honoured only when finite, positive
 * and bounded; a missing or invalid hint yields a conservative default, never zero.
 */
export function interpretFacebookThrottle(e: unknown): FacebookThrottle | null {
  if (!(e instanceof FacebookApiError)) return null;
  const limited = e.status === 429 || (e.code !== undefined && THROTTLE_CODES.has(e.code));
  if (!limited) return null;
  const hint = (e as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  const secs = typeof hint === 'number' && Number.isFinite(hint) && hint > 0 ? Math.min(Math.ceil(hint), MAX_RETRY_AFTER_SECONDS) : FACEBOOK_DEFAULT_THROTTLE_SECONDS;
  return { retryAfterSeconds: secs };
}
