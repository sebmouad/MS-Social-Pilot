import { createHash } from 'node:crypto';
import type { PlatformAdapter, PlatformCredential, PublishRequest, PublishResult, RemoteStatus, RemoteStatusRequest } from '../types';
import { fetchPublicMedia, ProviderHttpError } from '@/server/platforms/provider-http';
import { tiktokPolicySchema, type TiktokPolicy } from './config';
import { createTiktokApi, tiktokText, type TiktokApi } from './api';

const hasScopes = (credential: PlatformCredential, required: readonly string[]) => required.every(scope => credential.grantedScopes?.includes(scope));
const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
  const abort = () => { clearTimeout(timer); reject(new Error('Aborted')); };
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
});

export type TiktokAdapterOptions = {
  fetch?: typeof fetch; locale?: 'en' | 'fr'; clientKey?: string; clientSecret?: string;
  resolve?: (host: string) => Promise<string[]>; wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Server-only: the access token to use for this publication, renewed when it is about to end. */
  freshToken?: (publication: NonNullable<PublishRequest['publication']>, accessToken: string) => Promise<string>;
  api?: TiktokApi;
};

export function createTiktokAdapter(input: TiktokPolicy, options: TiktokAdapterOptions = {}): PlatformAdapter {
  const policy = tiktokPolicySchema.parse(input);
  const locale = options.locale ?? 'en';
  const text = (key: keyof TiktokPolicy['copy']) => tiktokText(policy, key, locale);
  const api = options.api ?? createTiktokApi(policy, { clientKey: options.clientKey ?? '', clientSecret: options.clientSecret ?? '', fetch: options.fetch, locale });
  const wait = options.wait ?? sleep;
  const reject = (key: keyof TiktokPolicy['copy']): never => { throw new ProviderHttpError(text(key), 'rejected'); };
  const media = { kinds: ['video'] as const, maxImages: 0, maxVideos: 1, mixedKinds: false, linkWithMedia: false, imageAltText: false };

  async function publish(request: PublishRequest): Promise<PublishResult> {
    if (!hasScopes(request.credential, policy.publishScopes)) reject('permission');
    const items = request.media ?? [];
    if (request.target.kind !== 'tiktok' || request.scheduledAt || request.link || (request.formatId && request.formatId !== 'video') || [...request.text].length > policy.captionMaxCharacters) reject('invalid');
    const video = items.find(item => item.kind === 'video');
    if (!video || items.length !== 1) reject('videoRequired');
    if (video!.localFile) reject('invalid');
    // Download first: nothing exists on TikTok until the upload is created.
    const file = await fetchPublicMedia({ url: video!.url, maxBytes: policy.maxVideoBytes, timeoutMs: policy.mediaFetchTimeoutMs, signal: request.signal, fetch: options.fetch, resolve: options.resolve, messages: { invalid: text('invalid'), tooLarge: text('tooLarge'), unavailable: text('unavailable') } });
    const mimeType = file.mimeType.startsWith('video/') ? file.mimeType : 'video/mp4';
    const accessToken = request.publication && options.freshToken ? await options.freshToken(request.publication, request.credential.accessToken) : request.credential.accessToken;
    const privacyLevel = api.pickPrivacy(await api.privacyLevels(accessToken, request.signal));
    const { publishId, uploadUrl } = await api.initVideo({ accessToken, caption: request.text, privacyLevel, size: file.bytes.byteLength, signal: request.signal });
    await api.sendVideo({ uploadUrl, bytes: file.bytes, mimeType, signal: request.signal });
    // The bytes are with TikTok; from here the publication exists, so any doubt is held for review, never resent.
    for (let attempt = 0; attempt < policy.statusPollAttempts; attempt++) {
      const status = await api.publishStatus(accessToken, publishId, request.signal).catch(() => null);
      if (!status) break; // A failed check does not undo the upload: report it as submitted.
      if (status.state === 'failed') throw new ProviderHttpError(text('processingFailed'), 'rejected');
      if (status.state === 'complete') return { remoteId: publishId, url: status.postId ? `https://www.tiktok.com/@/video/${status.postId}` : null, state: 'published' };
      if (attempt + 1 < policy.statusPollAttempts) await wait(policy.statusPollIntervalMs, request.signal);
    }
    return { remoteId: publishId, url: null, state: 'submitted' };
  }

  async function getRemoteStatus(request: RemoteStatusRequest): Promise<RemoteStatus> {
    if (!hasScopes(request.credential, policy.publishScopes)) reject('permission');
    const status = await api.publishStatus(request.credential.accessToken, request.remoteId, request.signal);
    if (status.state !== 'complete') return { state: 'unknown' };
    return { state: 'published', remoteId: request.remoteId, targetId: request.target.id };
  }

  return {
    id: 'tiktok',
    statusPolicyFingerprint: createHash('sha256').update(JSON.stringify({ policy })).digest('hex'),
    capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
    publishingMedia: media, defaultPublishingFormatId: 'video',
    publishingFormats: [{ id: 'video', label: text('video'), media, firstComment: false, remoteStatus: true, remoteDelete: false, scheduling: { application: true, native: false } }],
    supportsTargetKind: (kind, capability) => kind === 'tiktok' && capability === 'publishing',
    canUseCredential: (credential, capability) => capability === 'remoteDelete' || capability === 'firstComment' ? false : hasScopes(credential, policy.publishScopes),
    classifyPublishingFailure: error => error instanceof ProviderHttpError ? error.outcome : 'uncertain',
    publish, getRemoteStatus,
  };
}
