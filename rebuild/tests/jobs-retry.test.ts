import { describe, expect, it } from 'vitest';
import { FacebookApiError } from '../src/platforms/facebook/publishing';
import { withRetries } from '../src/server/jobs/retry';

describe('withRetries', () => {
  it('retries transient provider failures with capped exponential delays', async () => {
    let calls = 0;
    const waits: number[] = [];
    const backoff = { baseDelayMs: 250, maxDelayMs: 700 };
    const value = await withRetries(async () => {
      calls++;
      if (calls < 4) throw new FacebookApiError('temporary', 503);
      return 'done';
    }, 3, backoff, async wait => { waits.push(wait); });
    expect(value).toBe('done');
    expect(calls).toBe(4);
    expect(waits).toEqual([250, 500, 700]);
  });

  it('does not retry permanent provider errors', async () => {
    let calls = 0;
    await expect(withRetries(async () => { calls++; throw new FacebookApiError('bad token', 400, 190); }, 4, undefined, async () => undefined)).rejects.toThrow('bad token');
    expect(calls).toBe(1);
  });
});
