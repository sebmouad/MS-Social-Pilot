import { createHash } from 'node:crypto';
import type { PlatformAdapter, PlatformCredential, PublishRequest, PublishResult, RemoteDeleteRequest, RemoteStatus, RemoteStatusRequest } from '../types';
import { fetchPublicMedia, ProviderHttpError } from '@/server/platforms/provider-http';
import { youtubePolicySchema, type YoutubePolicy } from './config';
import { createYoutubeApi, youtubeDescription, youtubeText, youtubeTitle, type YoutubeApi } from './api';

const hasScopes = (credential: PlatformCredential, required: readonly string[]) => required.every(scope => credential.grantedScopes?.includes(scope));

export type YoutubeAdapterOptions = {
  fetch?: typeof fetch; locale?: 'en' | 'fr'; clientId?: string; clientSecret?: string;
  resolve?: (host: string) => Promise<string[]>;
  /** Server-only: the access token to use for this publication, renewed when it is about to end. */
  freshToken?: (publication: NonNullable<PublishRequest['publication']>, accessToken: string) => Promise<string>;
  api?: YoutubeApi;
};

export function createYoutubeAdapter(input: YoutubePolicy, options: YoutubeAdapterOptions = {}): PlatformAdapter {
  const policy = youtubePolicySchema.parse(input);
  const locale = options.locale ?? 'en';
  const text = (key: keyof YoutubePolicy['copy']) => youtubeText(policy, key, locale);
  const api = options.api ?? createYoutubeApi(policy, { clientId: options.clientId ?? '', clientSecret: options.clientSecret ?? '', fetch: options.fetch, locale });
  const reject = (key: keyof YoutubePolicy['copy']): never => { throw new ProviderHttpError(text(key), 'rejected'); };
  const media = { kinds: ['video'] as const, maxImages: 0, maxVideos: 1, mixedKinds: false, linkWithMedia: true, imageAltText: false };

  async function publish(request: PublishRequest): Promise<PublishResult> {
    if (!hasScopes(request.credential, policy.publishScopes)) reject('permission');
    const items = request.media ?? [];
    if (request.target.kind !== 'youtube' || request.scheduledAt || (request.formatId && request.formatId !== 'video')) reject('invalid');
    const video = items.find(item => item.kind === 'video');
    if (!video || items.length !== 1) reject('videoRequired');
    if (video!.localFile) reject('invalid');
    // Download first: nothing exists on YouTube until the upload session starts.
    const file = await fetchPublicMedia({ url: video!.url, maxBytes: policy.maxVideoBytes, timeoutMs: policy.mediaFetchTimeoutMs, signal: request.signal, fetch: options.fetch, resolve: options.resolve, messages: { invalid: text('invalid'), tooLarge: text('tooLarge'), unavailable: text('unavailable') } });
    const mimeType = file.mimeType.startsWith('video/') ? file.mimeType : 'video/mp4';
    const accessToken = request.publication && options.freshToken ? await options.freshToken(request.publication, request.credential.accessToken) : request.credential.accessToken;
    const sessionUrl = await api.startUpload({
      accessToken, channelId: request.target.id, mimeType, size: file.bytes.byteLength, signal: request.signal,
      title: youtubeTitle(request.text, policy.titleMaxCharacters, text('defaultTitle')),
      description: youtubeDescription(request.text, request.link, policy.descriptionMaxCharacters),
    });
    const id = await api.sendUpload({ sessionUrl, bytes: file.bytes, mimeType, signal: request.signal });
    return { remoteId: id, url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, state: 'published' };
  }

  async function getRemoteStatus(request: RemoteStatusRequest): Promise<RemoteStatus> {
    if (!hasScopes(request.credential, policy.publishScopes)) reject('permission');
    const found = await api.video(request.credential.accessToken, request.remoteId, request.signal);
    // A video that belongs to another channel, or one still failing/rejected, is not this destination's publication.
    if (!found || found.id !== request.remoteId || found.channelId !== request.target.id || !['uploaded', 'processed'].includes(found.uploadStatus ?? '')) return { state: 'unknown' };
    return { state: 'published', remoteId: found.id, targetId: request.target.id, publishedAt: found.publishedAt };
  }

  async function deleteRemote(request: RemoteDeleteRequest): Promise<void> {
    if (!hasScopes(request.credential, policy.deleteScopes)) reject('permission');
    if (!request.remoteId.trim()) reject('invalid');
    await api.remove(request.credential.accessToken, request.remoteId, request.signal);
  }

  return {
    id: 'youtube',
    statusPolicyFingerprint: createHash('sha256').update(JSON.stringify({ policy })).digest('hex'),
    capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'supported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
    publishingMedia: media, defaultPublishingFormatId: 'video',
    publishingFormats: [{ id: 'video', label: text('video'), media, firstComment: false, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } }],
    supportsTargetKind: (kind, capability) => kind === 'youtube' && capability === 'publishing',
    canUseCredential: (credential, capability) => capability === 'firstComment' ? false : hasScopes(credential, capability === 'remoteDelete' ? policy.deleteScopes : policy.publishScopes),
    classifyPublishingFailure: error => error instanceof ProviderHttpError ? error.outcome : 'uncertain',
    publish, getRemoteStatus, deleteRemote,
  };
}
