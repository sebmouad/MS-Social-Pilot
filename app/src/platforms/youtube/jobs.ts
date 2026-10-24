import type { RetryBackoff } from '@/server/jobs/retry';
import type { JobSummary } from '@/server/jobs/types';
import { renewProviderTokens } from '@/server/platforms/token-renewal-job';
import { configuredYoutubeApi, configuredYoutubePolicy } from './runtime';

/** Keep stored channel credentials usable ahead of status checks and deletions. */
export async function renewYoutubeTokens(now = new Date(), retryLimit = 0, retryBackoff?: RetryBackoff): Promise<JobSummary> {
  const policy = await configuredYoutubePolicy();
  return renewProviderTokens({
    provider: 'youtube', leadSeconds: policy.renewLeadSeconds, now, retryLimit, retryBackoff,
    async refresh(refreshToken, signal) {
      const configured = await configuredYoutubeApi('en', signal);
      if (!configured) throw new Error('YouTube is not configured.');
      return configured.api.refresh(refreshToken, signal);
    },
  });
}
