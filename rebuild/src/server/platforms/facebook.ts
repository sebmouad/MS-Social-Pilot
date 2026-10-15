import { createFacebookAdapter, createFacebookEngine } from '@/platforms/facebook/publishing';
import type { FacebookConfig } from '@/platforms/facebook/config';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';

async function configured<T>(key: string): Promise<T> {
  return await runtimeConfig(key) as T;
}

/** Server-only adapter construction; all operational inputs come from Root. */
async function configuredFacebookConfig(): Promise<FacebookConfig> {
  const [graphBaseUrl, oauthBaseUrl, graphVersion, requestTimeoutMs, maxPages, pageSize, pageInsightMetrics, adInsightFields, maxImageUploadBytes, allowedImageMimeTypes] = await Promise.all([
    configured<string>('meta.graphBaseUrl'),
    configured<string>('meta.oauthBaseUrl'),
    configured<string>('meta.graphVersion'),
    configured<number>('meta.requestTimeoutMs'),
    configured<number>('meta.maxPages'),
    configured<number>('meta.pageSize'),
    configured<string[]>('meta.pageInsightMetrics'),
    configured<string[]>('meta.adInsightFields'),
    configured<number>('meta.maxImageUploadBytes'),
    configured<string[]>('meta.allowedImageMimeTypes'),
  ]);
  return { graphBaseUrl, oauthBaseUrl, graphVersion, requestTimeoutMs, maxPages, pageSize, pageInsightMetrics, adInsightFields, maxImageUploadBytes, allowedImageMimeTypes };
}

export async function configuredFacebookEngine() { return createFacebookEngine(await configuredFacebookConfig()); }
export async function configuredFacebookAdapter() { return createFacebookAdapter(await configuredFacebookConfig()); }

export async function configuredFacebookOAuth() {
  const [appId, appSecret, redirectUri, scopes, inboxReadScopes, inboxWriteScopes] = await Promise.all([
    configured<string>('meta.appId'),
    runtimeSecret('meta.appSecret'),
    configured<string>('meta.oauthRedirectUri'),
    configured<string[]>('meta.oauthScopes'),
    configured<string[]>('meta.inboxReadScopes'),
    configured<string[]>('meta.inboxWriteScopes'),
  ]);
  if (!appId || !appSecret || !redirectUri || !scopes.length) throw new Error('Meta connection is not configured.');
  return { appId, appSecret, redirectUri, scopes: [...new Set([...scopes, ...inboxReadScopes, ...inboxWriteScopes])] };
}
