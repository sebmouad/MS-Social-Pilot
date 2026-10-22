import { runtimeConfig } from '@/server/config/store';
import { assertWorkspaceJobAccess } from '@/server/jobs/access';
import { jobAbortSignal, jobStopRequested } from '@/server/jobs/job-context';
import { withRetries, type RetryBackoff } from '@/server/jobs/retry';
import type { JobSummary } from '@/server/jobs/types';
import { OperationError } from '@/lib/operation-error';
import { listAccountsToRenew, renewStoredConnection, type RenewedToken } from './token-connection';

/**
 * Background renewal for modules whose access tokens end within hours. It renews every connection that
 * still has an enabled destination, so stored copies stay usable for status checks and deletion, which
 * carry no workspace identity. Access is rechecked per workspace; a refused grant marks the connection
 * for reconnection; any other failure is retried on the next pass.
 */
export async function renewProviderTokens(input: {
  provider: string; leadSeconds: number; now: Date; retryLimit: number; retryBackoff?: RetryBackoff;
  refresh: (refreshToken: string, signal?: AbortSignal) => Promise<RenewedToken>;
}): Promise<JobSummary> {
  const result: JobSummary = { examined: 0, updated: 0, skipped: 0, failed: 0 };
  if (await runtimeConfig(`platforms.${input.provider}.enabled` as never) !== true) return result;
  const limit = await runtimeConfig('sync.maxItemsPerJob');
  const rows = await listAccountsToRenew(input.provider, new Date(input.now.getTime() + input.leadSeconds * 1000), limit);
  for (const row of rows) {
    if (jobStopRequested()) break;
    result.examined++;
    try {
      await assertWorkspaceJobAccess(row.workspaceId, { provider: input.provider, anyFeatureOf: ['publishing/posts'] });
      const signal = jobAbortSignal();
      const renewed = await renewStoredConnection(row.workspaceId, row.token, refreshToken => withRetries(() => input.refresh(refreshToken, signal), input.retryLimit, input.retryBackoff));
      if (renewed.outcome === 'renewed') result.updated++;
      else if (renewed.outcome === 'unavailable') result.failed++;
      else result.skipped++;
    } catch (error) {
      if (error instanceof OperationError && ['forbidden', 'not_found', 'conflict', 'unavailable'].includes(error.code)) result.skipped++;
      else result.failed++;
    }
  }
  return result;
}
