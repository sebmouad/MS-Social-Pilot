import type { RetryBackoff } from '@/server/jobs/retry';
import type { JobSummary } from '@/server/jobs/types';
import { renewProviderTokens } from '@/server/platforms/token-renewal-job';
import { configuredTiktokApi, configuredTiktokPolicy } from './runtime';

/** Keep stored account credentials usable ahead of status checks. */
export async function renewTiktokTokens(now = new Date(), retryLimit = 0, retryBackoff?: RetryBackoff): Promise<JobSummary> {
  const policy = await configuredTiktokPolicy();
  return renewProviderTokens({
    provider: 'tiktok', leadSeconds: policy.renewLeadSeconds, now, retryLimit, retryBackoff,
    async refresh(refreshToken, signal) {
      const configured = await configuredTiktokApi('en', signal);
      if (!configured) throw new Error('TikTok is not configured.');
      return configured.api.refresh(refreshToken, signal);
    },
  });
}
