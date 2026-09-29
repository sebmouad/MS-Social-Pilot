/**
 * A fixed-window counter for endpoints a stranger can reach.
 *
 * Deliberately in memory rather than in the database. The thing being defended
 * against is a flood of requests, and a table write per attempt hands the
 * attacker a second, cheaper way to do damage — the defence would become the
 * amplifier. The cost is that counts are per process and reset on restart,
 * which is the right trade for a self-hosted tool: this is a brake, not an
 * access control, and the control it protects (a hashed password) is still
 * there underneath.
 *
 * Fixed windows, not sliding: a sliding window needs the timestamps of every
 * attempt, which is another thing an attacker can make grow.
 */

interface Window {
  count: number;
  resetAt: number;
}

/**
 * How many keys are tracked at once.
 *
 * Someone guessing at random addresses would otherwise grow this map for as
 * long as they kept going, which is the memory-exhaustion version of the attack
 * being prevented.
 */
const MAX_KEYS = 10_000;

const windows = new Map<string, Window>();

function prune(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }

  // Still full of live windows: drop the oldest, which are the closest to
  // expiring anyway. Map iterates in insertion order, so this is the front.
  while (windows.size >= MAX_KEYS) {
    const oldest = windows.keys().next();
    if (oldest.done) break;
    windows.delete(oldest.value);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts left in this window, after counting the current one. */
  remaining: number;
  /** When the window resets, as epoch milliseconds. */
  resetAt: number;
}

/**
 * Count one attempt against `key` and say whether it is allowed.
 *
 * Counting happens even when the answer is no, so a caller that keeps trying
 * keeps the window alive rather than slipping through as it expires.
 */
export function hit(
  key: string,
  options: { limit: number; windowMs: number; now?: number },
): RateLimitResult {
  const now = options.now ?? Date.now();
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_KEYS) prune(now);
    const window = { count: 1, resetAt: now + options.windowMs };
    windows.set(key, window);
    return { allowed: true, remaining: options.limit - 1, resetAt: window.resetAt };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= options.limit,
    remaining: Math.max(0, options.limit - existing.count),
    resetAt: existing.resetAt,
  };
}

/** Forget a key, so a success does not leave the failures counted against it. */
export function clear(key: string): void {
  windows.delete(key);
}

/**
 * Take back `attempts` counted against `key`, and no more.
 *
 * For attempts that turned out not to be what the limit is for — a correct
 * password, say — where `clear` would also wipe unrelated failures counted
 * under the same key.
 */
export function forgive(key: string, attempts = 1): void {
  const window = windows.get(key);
  if (window) window.count = Math.max(0, window.count - attempts);
}

/** Test seam: drop everything. */
export function reset(): void {
  windows.clear();
}
