import { describe, expect, it } from 'vitest';

import { backoffSeconds, decideRetry, isRetryableKind, nextAttemptAt } from '../src/lib/scheduler/backoff';

// No jitter, so the exponential curve is exactly assertable.
const noJitter = () => 0.5;

describe('isRetryableKind', () => {
  it('retries transient faults and rate limits', () => {
    expect(isRetryableKind('transient')).toBe(true);
    expect(isRetryableKind('rate_limit')).toBe(true);
  });

  it('does not retry auth, permission or rejection failures', () => {
    expect(isRetryableKind('auth')).toBe(false);
    expect(isRetryableKind('permission')).toBe(false);
    expect(isRetryableKind('rejected')).toBe(false);
    expect(isRetryableKind('invalid_request')).toBe(false);
  });
});

describe('backoffSeconds', () => {
  it('doubles with each attempt', () => {
    expect(backoffSeconds('transient', 1, noJitter)).toBe(60);
    expect(backoffSeconds('transient', 2, noJitter)).toBe(120);
    expect(backoffSeconds('transient', 3, noJitter)).toBe(240);
  });

  it('waits far longer when rate limited', () => {
    // Retrying a throttled endpoint quickly only extends the throttle.
    expect(backoffSeconds('rate_limit', 1, noJitter)).toBe(900);
    expect(backoffSeconds('rate_limit', 1, noJitter)).toBeGreaterThan(
      backoffSeconds('transient', 1, noJitter),
    );
  });

  it('caps the delay at six hours', () => {
    expect(backoffSeconds('transient', 40, noJitter)).toBe(6 * 60 * 60);
  });

  it('applies jitter within ±20%', () => {
    const low = backoffSeconds('transient', 1, () => 0);
    const high = backoffSeconds('transient', 1, () => 1);
    expect(low).toBe(48); // 60 × 0.8
    expect(high).toBe(72); // 60 × 1.2
  });

  it('returns zero for failures that are not worth retrying', () => {
    expect(backoffSeconds('auth', 1, noJitter)).toBe(0);
  });
});

describe('nextAttemptAt', () => {
  it('schedules the retry relative to now', () => {
    const now = new Date('2026-05-01T12:00:00Z');
    expect(nextAttemptAt('transient', 1, now, noJitter)).toEqual(new Date('2026-05-01T12:01:00Z'));
  });

  it('returns null when the failure is terminal', () => {
    expect(nextAttemptAt('permission', 1, new Date(), noJitter)).toBeNull();
  });
});

describe('decideRetry', () => {
  const now = new Date('2026-05-01T12:00:00Z');

  it('retries a transient failure below the attempt ceiling', () => {
    const decision = decideRetry({ kind: 'transient', attempts: 1, maxAttempts: 5, now, random: noJitter });
    expect(decision.shouldRetry).toBe(true);
    expect(decision.nextAttemptAt).toEqual(new Date('2026-05-01T12:01:00Z'));
  });

  it('stops once the attempt ceiling is reached', () => {
    const decision = decideRetry({ kind: 'transient', attempts: 5, maxAttempts: 5, now, random: noJitter });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.nextAttemptAt).toBeNull();
    expect(decision.reason).toMatch(/gave up after 5/i);
  });

  it('never retries a dead token, and says to reconnect', () => {
    const decision = decideRetry({ kind: 'auth', attempts: 1, maxAttempts: 5, now });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toMatch(/reconnect/i);
  });

  it('never retries content Facebook rejected', () => {
    const decision = decideRetry({ kind: 'rejected', attempts: 1, maxAttempts: 5, now });
    expect(decision.shouldRetry).toBe(false);
    expect(decision.reason).toMatch(/retrying will not help/i);
  });
});
