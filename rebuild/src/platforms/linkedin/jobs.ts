import { ProviderHttpError } from '@/server/platforms/provider-http';
import { ProviderError } from './transport';
import type { RetryBackoff } from '@/server/jobs/retry';
import type { JobSummary } from '@/server/jobs/types';
import { renewProviderTokens } from '@/server/platforms/token-renewal-job';
import { configuredPolicy, configuredCredentials, configuredEngine } from './runtime';

/** Renew selected, authorized connections ahead of expiry through the neutral locked service. */
export async function renewLinkedinTokens(now = new Date(), retryLimit = 0, retryBackoff?: RetryBackoff): Promise<JobSummary> {
  const policy = await configuredPolicy();
  return renewProviderTokens({
    provider: 'linkedin', leadSeconds: policy.renewLeadSeconds, now, retryLimit, retryBackoff,
    async refresh(refreshToken, signal) {
      const [credentials, engine] = await Promise.all([configuredCredentials(), configuredEngine()]);
      try {
        const renewed = await engine.renew(credentials.appId, credentials.appSecret, refreshToken, signal);
        return { accessToken: renewed.accessToken, refreshToken: renewed.refreshToken ?? refreshToken, accessExpiresAt: renewed.expiresAt };
      } catch (error) {
        // The neutral persistence service revokes positively rejected refresh grants only.
        if (error instanceof ProviderError && error.rejected && [400, 401].includes(error.status)) {
          throw new ProviderHttpError(policy.copy.permission.en, 'rejected', false, error.status);
        }
        throw error;
      }
    },
  });
}
