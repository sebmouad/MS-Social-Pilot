import { createFacebookAdapter, createFacebookEngine } from '@/platforms/facebook/publishing';
import type { FacebookConfig } from '@/platforms/facebook/config';
import { runtimeConfig, runtimeSecret } from '@/server/config/store';
import { facebookMediaJournal } from './media-journal';

async function configured<T>(key: string): Promise<T> {
  return await runtimeConfig(key) as T;
}

/** Server-only adapter construction; all operational inputs come from Root. */
async function configuredFacebookConfig(): Promise<FacebookConfig> {
  const [graphBaseUrl, oauthBaseUrl, graphVersion, requestTimeoutMs, maxPages, pageSize, pageInsightMetrics, adInsightFields, maxImageUploadBytes, allowedImageMimeTypes, appSecretProofEnabled, appSecret] = await Promise.all([
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
    configured<boolean>('meta.appSecretProofEnabled'),
    runtimeSecret('meta.appSecret').catch(() => null),
  ]);
  return { graphBaseUrl, oauthBaseUrl, graphVersion, requestTimeoutMs, maxPages, pageSize, pageInsightMetrics, adInsightFields, maxImageUploadBytes, allowedImageMimeTypes, appSecretProofEnabled, ...(appSecret?.trim() ? { appSecret } : {}) };
}

export async function configuredFacebookEngine(options?: { signal?: AbortSignal }) {
  const signal = options?.signal;
  const transport: typeof fetch = signal ? (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal }) : fetch;
  return createFacebookEngine(await configuredFacebookConfig(), transport, facebookMediaJournal);
}
export async function configuredFacebookAdapter() {
  const [config, postReadScopes, postPublishScopes, postDeleteScopes, firstCommentScopes, feedFormatLabel] = await Promise.all([
    configuredFacebookConfig(), configured<string[]>('meta.postReadScopes'), configured<string[]>('meta.postPublishScopes'),
    configured<string[]>('meta.postDeleteScopes'), configured<string[]>('meta.firstCommentScopes'), configured<string>('meta.feedFormatLabel'),
  ]);
  return createFacebookAdapter(config, fetch, { feedFormatLabel, postReadScopes, postPublishScopes, postDeleteScopes, firstCommentScopes, mediaJournalFactory: facebookMediaJournal });
}

export async function configuredFacebookOAuth() {
  const [appId, appSecret, redirectUri, scopes, insightReadScopes, inboxReadScopes, inboxWriteScopes, postReadScopes, postPublishScopes, postDeleteScopes, firstCommentScopes, manualMediaCleanupEnabled, mediaReadScopes, mediaDeleteScopes] = await Promise.all([
    configured<string>('meta.appId'),
    runtimeSecret('meta.appSecret'),
    configured<string>('meta.oauthRedirectUri'),
    configured<string[]>('meta.oauthScopes'),
    configured<string[]>('meta.pageInsightReadScopes'),
    configured<string[]>('meta.inboxReadScopes'),
    configured<string[]>('meta.inboxWriteScopes'),
    configured<string[]>('meta.postReadScopes'),
    configured<string[]>('meta.postPublishScopes'),
    configured<string[]>('meta.postDeleteScopes'),
    configured<string[]>('meta.firstCommentScopes'),
    configured<boolean>('meta.manualMediaCleanupEnabled'),
    configured<string[]>('meta.mediaReadScopes'),
    configured<string[]>('meta.mediaDeleteScopes'),
  ]);
  if (!appId || !appSecret || !redirectUri || !scopes.length) throw new Error('Meta connection is not configured.');
  return { appId, appSecret, redirectUri, scopes: [...new Set([...scopes, ...insightReadScopes, ...inboxReadScopes, ...inboxWriteScopes, ...postReadScopes, ...postPublishScopes, ...postDeleteScopes, ...firstCommentScopes, ...(manualMediaCleanupEnabled ? [...mediaReadScopes, ...mediaDeleteScopes] : [])])] };
}
