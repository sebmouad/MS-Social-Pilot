import { describe, expect, it } from 'vitest';
import { PlatformApiError } from '../src/platforms/errors';
import { FacebookApiError } from '../src/platforms/facebook/publishing';
import { isRetryableSyncError, withRetries } from '../src/server/jobs/retry';

describe('provider-neutral retry contract', () => {
  it('retries an adapter error without knowing its provider', async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await withRetries(async () => {
      if (++calls === 1) throw new PlatformApiError('Temporary example provider failure', true);
      return 'done';
    }, 1, { baseDelayMs: 20, maxDelayMs: 20 }, async value => { delays.push(value); });
    expect(result).toBe('done');
    expect(calls).toBe(2);
    expect(delays).toEqual([20]);
  });

  it('does not retry a permanent adapter rejection', async () => {
    let calls = 0;
    await expect(withRetries(async () => { calls++; throw new PlatformApiError('Permanent example rejection', false); }, 3, undefined, async () => undefined)).rejects.toThrow('Permanent example rejection');
    expect(calls).toBe(1);
  });
});

describe('Facebook-owned retry classification', () => {
  it.each([
    [0, undefined, true], [429, undefined, true], [503, undefined, true],
    [400, 4, true], [400, 17, true], [400, 32, true], [400, 613, true],
    [400, 190, false], [403, undefined, false], [200, undefined, false],
  ] as const)('classifies HTTP %s / Graph %s as retryable=%s', (status, code, retryable) => {
    const error = new FacebookApiError('Example provider failure', status, code);
    expect(error).toBeInstanceOf(PlatformApiError);
    expect(isRetryableSyncError(error)).toBe(retryable);
  });
});
