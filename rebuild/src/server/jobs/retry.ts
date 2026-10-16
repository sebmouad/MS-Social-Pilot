import { PlatformApiError } from '@/platforms/errors';

export function isRetryableSyncError(error: unknown): boolean {
  if (error instanceof PlatformApiError) return error.retryable;
  return error instanceof TypeError || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
}

export type RetryBackoff = { baseDelayMs: number; maxDelayMs: number };
const DEFAULT_BACKOFF: RetryBackoff = { baseDelayMs: 1000, maxDelayMs: 60_000 };

export async function withRetries<T>(
  operation: () => Promise<T>,
  retryLimit: number,
  backoff: RetryBackoff = DEFAULT_BACKOFF,
  delay: (milliseconds: number) => Promise<void> = sleep,
  shouldRetry: (error: unknown) => boolean = isRetryableSyncError,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= retryLimit || !shouldRetry(error)) throw error;
      const wait = Math.min(backoff.maxDelayMs, backoff.baseDelayMs * 2 ** attempt);
      attempt += 1;
      await delay(wait);
    }
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
