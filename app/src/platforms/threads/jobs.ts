import type { RetryBackoff } from '@/server/jobs/retry';
import { runtimeConfig } from '@/server/config/store';
import { renewProviderTokens } from '@/server/platforms/token-renewal-job';
import { configuredThreadsAdapter } from './runtime';
export async function renewThreadsTokens(now = new Date(), retryLimit = 0, retryBackoff?: RetryBackoff) {
  const policy = await runtimeConfig('threads.connectionPolicy') as { renewLeadSeconds: number };
  return renewProviderTokens({ provider: 'threads', leadSeconds: policy.renewLeadSeconds, now, retryLimit, retryBackoff,
    async refresh(refreshToken) {
      const next = await (await configuredThreadsAdapter()).refreshToken(refreshToken);
      return { accessToken: next.accessToken, accessExpiresAt: next.expiresAt, refreshToken: next.accessToken };
    },
  });
}
