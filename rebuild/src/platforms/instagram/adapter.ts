import { createHash } from 'node:crypto';
import type { InstagramJournalFactory } from './container-journal';
import type { PlatformAdapter } from '../types';
import { instagramPolicySchema, type InstagramPolicy } from './config';
import { createInstagramGraph, InstagramError } from './transport';
import { createInstagramPublisher, hasScopes } from './publishing';
import { createInstagramInbox } from './inbox';
import { createInstagramInsights } from './insights';

export function createInstagramAdapter(input: InstagramPolicy, options: { fetch?: typeof fetch; appSecret?: string; locale?: 'en' | 'fr'; journalFactory?: InstagramJournalFactory; wait?: (ms: number, signal?: AbortSignal) => Promise<void> } = {}): PlatformAdapter {
  const policy = instagramPolicySchema.parse(input); const graph = createInstagramGraph(policy, options);
  const publisher = createInstagramPublisher(policy, graph, options.wait, options.journalFactory);
  const inbox = createInstagramInbox(policy, graph);
  const media = { kinds: ['image', 'video'] as const, maxImages: policy.carouselMax, maxVideos: policy.carouselMax, mixedKinds: true, linkWithMedia: false, imageAltText: false };
  return {
    id: 'instagram',
    statusPolicyFingerprint: createHash('sha256').update(JSON.stringify({ policy, appSecret: options.appSecret ?? null })).digest('hex'),
    // Connection and stored-data hosts are assembled by the installed module.
    capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'unsupported', inbox: 'supported', analytics: 'supported', ads: 'unsupported' },
    publishingMedia: media, defaultPublishingFormatId: 'image',
    publishingFormats: (['image', 'video', 'carousel', 'reel', 'story'] as const).map(id => ({ id, label: policy.copy[id][options.locale ?? 'en'], media: { ...media,
      kinds: id === 'image' ? ['image'] : id === 'video' || id === 'reel' ? ['video'] : id === 'story' ? ['image', 'video'] : media.kinds,
      maxImages: id === 'image' || id === 'story' ? 1 : id === 'video' || id === 'reel' ? 0 : policy.carouselMax,
      maxVideos: id === 'image' ? 0 : id === 'video' || id === 'reel' || id === 'story' ? 1 : policy.carouselMax,
      mixedKinds: id === 'carousel' },
      // Stories carry no caption or public comments; their media_publish receipt is the delivery proof.
      firstComment: id !== 'story', remoteStatus: id !== 'story', remoteDelete: false, scheduling: { application: true, native: false } })),
    supportsTargetKind: kind => kind === 'professional' || kind === 'instagram',
    canUseCredential: (credential, capability) => capability === 'remoteDelete' || policy.appSecretProofEnabled && !options.appSecret ? false : hasScopes(credential, capability === 'publishing' ? policy.publishScopes : capability === 'firstComment' ? policy.commentScopes : policy.readScopes),
    classifyPublishingFailure: error => error instanceof InstagramError ? error.outcome : 'uncertain',
    ...publisher, ...inbox,
    publish: request => publisher.publish({ ...request, target: { ...request.target, kind: request.target.kind === 'instagram' ? 'professional' : request.target.kind } }),
  };
}
/** Server collectors retain observations and explicit failures instead of reducing them to misleading totals. */
export function createInstagramCollector(input: InstagramPolicy, options: Parameters<typeof createInstagramGraph>[1] = {}) {
  const policy = instagramPolicySchema.parse(input);
  return createInstagramInsights(policy, createInstagramGraph(policy, options));
}
