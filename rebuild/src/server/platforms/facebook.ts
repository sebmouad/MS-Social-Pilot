import { createFacebookEngine } from '@/platforms/facebook/publishing';
import type { FacebookConfig } from '@/platforms/facebook/config';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';

async function configured<T>(key: string): Promise<T> {
  return await runtimeConfig(key) as T;
}

/** Server-only adapter construction; all operational inputs come from Root. */
export async function configuredFacebookEngine() {
  const [graphBaseUrl, oauthBaseUrl, graphVersion, requestTimeoutMs, maxPages, pageSize, pageInsightMetrics, adInsightFields] = await Promise.all([
    configured<string>('meta.graphBaseUrl'),
    configured<string>('meta.oauthBaseUrl'),
    configured<string>('meta.graphVersion'),
    configured<number>('meta.requestTimeoutMs'),
    configured<number>('meta.maxPages'),
    configured<number>('meta.pageSize'),
    configured<string[]>('meta.pageInsightMetrics'),
    configured<string[]>('meta.adInsightFields'),
  ]);
  const config: FacebookConfig = { graphBaseUrl, oauthBaseUrl, graphVersion, requestTimeoutMs, maxPages, pageSize, pageInsightMetrics, adInsightFields };
  return createFacebookEngine(config);
}

export async function configuredFacebookOAuth() {
  const [appId, appSecret, redirectUri, scopes] = await Promise.all([
    configured<string>('meta.appId'),
    runtimeSecret('meta.appSecret'),
    configured<string>('meta.oauthRedirectUri'),
    configured<string[]>('meta.oauthScopes'),
  ]);
  if (!appId || !appSecret || !redirectUri || !scopes.length) throw new Error('Meta connection is not configured.');
  return { appId, appSecret, redirectUri, scopes };
}
