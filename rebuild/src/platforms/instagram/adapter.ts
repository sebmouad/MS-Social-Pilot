import type { PlatformAdapter } from '../types';
import { instagramPolicySchema, type InstagramPolicy } from './config';
import { createInstagramGraph, InstagramError } from './transport';
import { createInstagramPublisher, hasScopes } from './publishing';
import { createInstagramInbox } from './inbox';
import { createInstagramInsights } from './insights';

export function createInstagramAdapter(input: InstagramPolicy, options: { fetch?: typeof fetch; appSecret?: string; locale?: 'en' | 'fr'; wait?: (ms: number, signal?: AbortSignal) => Promise<void> } = {}): PlatformAdapter {
  const policy = instagramPolicySchema.parse(input); const graph = createInstagramGraph(policy, options);
  const publisher = createInstagramPublisher(policy, graph, options.wait);
  const inbox = createInstagramInbox(policy, graph);
  const media = { kinds: ['image', 'video'] as const, maxImages: policy.carouselMax, maxVideos: policy.carouselMax, mixedKinds: true, linkWithMedia: false, imageAltText: false };
  return {
    id: 'instagram',
    // OAuth/linked-Page persistence and product analytics/inbox hosts are integration gaps.
    capabilities: { connection: 'unsupported', discovery: 'unsupported', publishing: 'supported', remoteStatus: 'supported', remoteDelete: 'unsupported', inbox: 'supported', analytics: 'unsupported', ads: 'unsupported' },
    publishingMedia: media, defaultPublishingFormatId: 'image',
    publishingFormats: (['image', 'carousel', 'reel'] as const).map(id => ({ id, label: policy.copy[id][options.locale ?? 'en'], media: { ...media, kinds: id === 'image' ? ['image'] : id === 'reel' ? ['video'] : media.kinds, maxImages: id === 'image' ? 1 : id === 'reel' ? 0 : policy.carouselMax, maxVideos: id === 'image' ? 0 : id === 'reel' ? 1 : policy.carouselMax }, firstComment: true, remoteStatus: true, remoteDelete: false, scheduling: { application: true, native: false } })),
    supportsTargetKind: kind => kind === 'professional',
    canUseCredential: (credential, capability) => capability === 'remoteDelete' ? false : hasScopes(credential, capability === 'publishing' ? policy.publishScopes : capability === 'firstComment' ? policy.commentScopes : policy.readScopes),
    classifyPublishingFailure: error => error instanceof InstagramError ? error.outcome : 'uncertain',
    ...publisher, ...inbox,
  };
}
/** Server collectors retain observations and explicit failures instead of reducing them to misleading totals. */
export function createInstagramCollector(input: InstagramPolicy, options: Parameters<typeof createInstagramGraph>[1] = {}) {
  const policy = instagramPolicySchema.parse(input);
  return createInstagramInsights(policy, createInstagramGraph(policy, options));
}
