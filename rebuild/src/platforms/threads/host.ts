import type { PlatformHost } from '@/server/platforms/host';
import { requestLocale } from '@/server/platforms/request-locale';
import { configuredThreadsAdapter } from './runtime';
import { threadsConnection } from './connection';
import { renewThreadsTokens } from './jobs';
import { runtimeConfig } from '@/server/config/store';
import { threadsPolicySchema } from './config';
export const threadsHost = {
  async adapter() {
    const locale = await requestLocale(), adapter = await configuredThreadsAdapter(locale);
    const policy = threadsPolicySchema.parse(await runtimeConfig('threads.policy'));
    const copy = await runtimeConfig('threads.connectionPolicy') as { postLabel: { en: string; fr: string } };
    const media = { kinds: ['image', 'video'] as const, maxImages: policy.maxMedia, maxVideos: policy.maxMedia, mixedKinds: true, linkWithMedia: false, imageAltText: false };
    return { ...adapter, canUseCredential: (credential: import('../types').PlatformCredential) => policy.scopes.every(scope => credential.grantedScopes?.includes(scope)), publishingMedia: media,
      publishingFormats: [{ id: 'post', label: copy.postLabel[locale], media, firstComment: false, remoteStatus: false, remoteDelete: false, scheduling: { application: true, native: false } }],
      defaultPublishingFormatId: 'post', supportsTargetKind: (kind: string) => kind === 'threads',
    };
  }, connection: threadsConnection, jobs: { posts: renewThreadsTokens },
} satisfies PlatformHost;
