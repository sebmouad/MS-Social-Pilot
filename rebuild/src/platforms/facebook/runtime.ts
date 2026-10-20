import { createFacebookAdapter, createFacebookEngine, type FacebookNativePublishingPolicy } from '@/platforms/facebook/publishing';
import { createFacebookNativePublisher } from './formats/publish';
import { inspectMediaSnapshot } from '@/modules/publishing/server/media/inspect';
import { resolveRemoteMediaSnapshot } from '@/modules/publishing/server/media/resolve-remote';
import type { FacebookConfig } from '@/platforms/facebook/config';
import { runtimeConfig, runtimeConfigBatch, runtimeSecret } from '@/server/config/store';
import { facebookMediaJournal } from './media-journal';
import { FACEBOOK_NATIVE_CONFIG, FACEBOOK_NATIVE_TRANSPORT_CONFIG, facebookNativePolicyFrom, facebookNativeTransportPolicyFrom } from './native-config';
import { createFacebookNativeTransport } from './formats/transport';

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
  const [config, postReadScopes, postPublishScopes, postDeleteScopes, firstCommentScopes, feedFormatLabel, native] = await Promise.all([
    configuredFacebookConfig(), configured<string[]>('meta.postReadScopes'), configured<string[]>('meta.postPublishScopes'),
    configured<string[]>('meta.postDeleteScopes'), configured<string[]>('meta.firstCommentScopes'), configured<string>('meta.feedFormatLabel'),
    configuredFacebookNativePublishing(),
  ]);
  return createFacebookAdapter(config, fetch, { feedFormatLabel, postReadScopes, postPublishScopes, postDeleteScopes, firstCommentScopes, mediaJournalFactory: facebookMediaJournal, ...(native ? { native } : {}) });
}

/** Private switch: native formats are declared only while it is on and the native policy is valid. */
export async function configuredFacebookNativePublishing(): Promise<FacebookNativePublishingPolicy | null> {
  try {
    const enabled = await configured<boolean>('facebook.native.publishingEnabled');
    if (enabled !== true) return null;
    const [{ policy }, videoLabel, reelLabel, storyPhotoLabel, storyVideoLabel] = await Promise.all([
      configuredFacebookNativeSettings(), configured<string>('facebook.native.videoFormatLabel'), configured<string>('facebook.native.reelFormatLabel'),
      configured<string>('facebook.native.storyPhotoFormatLabel'), configured<string>('facebook.native.storyVideoFormatLabel'),
    ]);
    const inspected = (snapshot: Awaited<ReturnType<typeof inspectMediaSnapshot>> | Awaited<ReturnType<typeof resolveRemoteMediaSnapshot>>) => ({
      bytes: snapshot.bytes, mimeType: snapshot.mimeType, sizeBytes: snapshot.sizeBytes, width: snapshot.width, height: snapshot.height,
      ...(snapshot.durationSeconds !== undefined ? { durationSeconds: snapshot.durationSeconds } : {}),
    });
    return {
      videoLabel, reelLabel, storyPhotoLabel, storyVideoLabel,
      publish: createFacebookNativePublisher({
        policy,
        transport: async (accessToken, signal) => configuredFacebookNativeTransport(accessToken, { signal }),
        inspect: async (bytes, signal, kind) => inspected(await inspectMediaSnapshot(bytes, kind, { signal })),
        resolveRemote: async (url, signal, kind) => inspected(await resolveRemoteMediaSnapshot(url, kind, { signal })),
      }),
    };
  } catch {
    return null; // Invalid native policy fails closed: no native format is declared.
  }
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


/** Private native-engine dependency. Constructing it does not advertise a format or dispatch I/O. */
export async function configuredFacebookNativeTransport(accessToken: string, options?: { signal?: AbortSignal }) {
  const [config, transportValues] = await Promise.all([
    configuredFacebookConfig(),
    runtimeConfigBatch(FACEBOOK_NATIVE_TRANSPORT_CONFIG.map(setting => setting.key)),
  ]);
  if (config.appSecretProofEnabled && !config.appSecret) throw new Error('Native Facebook signing configuration is unavailable.');
  const policy = facebookNativeTransportPolicyFrom(transportValues);
  return createFacebookNativeTransport(config, accessToken, policy, fetch, options?.signal);
}


/** One validated snapshot for Root diagnostics and future native dispatch. No provider I/O. */
export async function configuredFacebookNativeSettings() {
  const values = await runtimeConfigBatch([...FACEBOOK_NATIVE_CONFIG, ...FACEBOOK_NATIVE_TRANSPORT_CONFIG].map(setting => setting.key));
  return { policy: facebookNativePolicyFrom(values), transport: facebookNativeTransportPolicyFrom(values) };
}
