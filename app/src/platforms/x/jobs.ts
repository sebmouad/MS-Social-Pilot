import type { RetryBackoff } from '@/server/jobs/retry';
import { runtimeConfig } from '@/server/config/store';
import { renewProviderTokens } from '@/server/platforms/token-renewal-job';
import { configuredXAdapter } from './runtime';
export async function renewXTokens(now = new Date(), retryLimit = 0, retryBackoff?: RetryBackoff) {
  const policy = await runtimeConfig('x.connectionPolicy') as { renewLeadSeconds: number };
  return renewProviderTokens({ provider: 'x', leadSeconds: policy.renewLeadSeconds, now, retryLimit, retryBackoff,
    async refresh(refreshToken) {
      const next = await (await configuredXAdapter()).refreshToken(refreshToken);
      return { accessToken: next.accessToken, accessExpiresAt: next.expiresAt, refreshToken: next.refreshToken ?? refreshToken };
    },
  });
}
