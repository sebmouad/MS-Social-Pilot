import { runtimeConfigBatch } from '@/server/config/store';
import { PlatformApiError } from '@/platforms/errors';

export function isRetryableSyncError(error: unknown): boolean {
  if (error instanceof PlatformApiError) return error.retryable;
  return error instanceof TypeError || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
}

export type RetryBackoff = { baseDelayMs: number; maxDelayMs: number };

export async function withRetries<T>(
  operation: () => Promise<T>,
  retryLimit: number,
  backoff?: RetryBackoff,
  delay: (milliseconds: number) => Promise<void> = sleep,
  shouldRetry: (error: unknown) => boolean = isRetryableSyncError,
): Promise<T> {
  let attempt = 0;
  let policy = backoff;
  for (;;) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= retryLimit || !shouldRetry(error)) throw error;
      if (!policy) {
        const values = await runtimeConfigBatch(['sync.retryBaseDelayMs', 'sync.retryMaxDelayMs']);
        policy = { baseDelayMs: Number(values['sync.retryBaseDelayMs']), maxDelayMs: Number(values['sync.retryMaxDelayMs']) };
      }
      const wait = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
      attempt += 1;
      await delay(wait);
    }
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
