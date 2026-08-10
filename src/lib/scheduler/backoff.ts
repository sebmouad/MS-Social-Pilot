import type { GraphFailureKind } from '../facebook/graph';

/**
 * Retry policy.
 *
 * The base delay depends on *why* the attempt failed. A transient Meta blip is
 * worth retrying in a minute; being rate limited is not — hammering a throttled
 * endpoint extends the throttle. Jitter is applied so that a fleet of posts
 * that failed together does not retry in lockstep.
 */

const BASE_DELAY_SECONDS: Record<GraphFailureKind, number> = {
  transient: 60,
  rate_limit: 900, // 15 minutes; Meta's buckets refill over the hour.
  auth: 0,
  permission: 0,
  rejected: 0,
  invalid_request: 0,
};

const MAX_DELAY_SECONDS = 6 * 60 * 60;

export function isRetryableKind(kind: GraphFailureKind): boolean {
  return kind === 'transient' || kind === 'rate_limit';
}

/**
 * Delay before attempt number `attempt` (1-based: `attempt` 1 is the first
 * retry after the initial failure). Exponential, capped, with ±20% jitter.
 *
 * `random` is injectable so tests can assert exact values.
 */
export function backoffSeconds(
  kind: GraphFailureKind,
  attempt: number,
  random: () => number = Math.random,
): number {
  const base = BASE_DELAY_SECONDS[kind];
  if (base === 0) return 0;

  const exponential = Math.min(base * 2 ** Math.max(0, attempt - 1), MAX_DELAY_SECONDS);
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(exponential * jitter);
}

export function nextAttemptAt(
  kind: GraphFailureKind,
  attempt: number,
  now: Date = new Date(),
  random: () => number = Math.random,
): Date | null {
  if (!isRetryableKind(kind)) return null;
  return new Date(now.getTime() + backoffSeconds(kind, attempt, random) * 1000);
}

export interface RetryDecision {
  shouldRetry: boolean;
  nextAttemptAt: Date | null;
  reason: string;
}

/**
 * Decide what happens after a failed publish attempt.
 *
 * `attempts` is the count *including* the attempt that just failed.
 */
export function decideRetry(options: {
  kind: GraphFailureKind;
  attempts: number;
  maxAttempts: number;
  now?: Date;
  random?: () => number;
}): RetryDecision {
  const { kind, attempts, maxAttempts } = options;
  const now = options.now ?? new Date();

  if (!isRetryableKind(kind)) {
    return {
      shouldRetry: false,
      nextAttemptAt: null,
      reason:
        kind === 'auth'
          ? 'The Facebook connection is no longer valid; reconnect the account.'
          : kind === 'permission'
            ? 'The connected account lacks permission to publish here.'
            : 'Facebook rejected this post, so retrying will not help.',
    };
  }

  if (attempts >= maxAttempts) {
    return {
      shouldRetry: false,
      nextAttemptAt: null,
      reason: `Gave up after ${attempts} attempts.`,
    };
  }

  const next = nextAttemptAt(kind, attempts, now, options.random);
  return {
    shouldRetry: true,
    nextAttemptAt: next,
    reason: `Attempt ${attempts} of ${maxAttempts} failed; retrying.`,
  };
}
