import type { PlatformHost } from '@/server/platforms/host';
import { requestLocale } from '@/server/platforms/request-locale';
import { configuredXAdapter } from './runtime';
import { xConnection } from './connection';
import { renewXTokens } from './jobs';
import { runtimeConfig } from '@/server/config/store';
import { xPolicySchema } from './config';
export const xHost = {
  async adapter() {
    const locale = await requestLocale(), adapter = await configuredXAdapter(locale);
    const policy = xPolicySchema.parse(await runtimeConfig('x.policy'));
    const copy = await runtimeConfig('x.connectionPolicy') as { postLabel: { en: string; fr: string } };
    const media = { kinds: ['image'] as const, maxImages: policy.maxImages, maxVideos: 0, mixedKinds: false, linkWithMedia: true, imageAltText: false };
    const { exchangeCode: _exchange, ...engine } = adapter;
    return { ...engine, canUseCredential: (credential: import('../types').PlatformCredential) => policy.scopes.every(scope => credential.grantedScopes?.includes(scope)), publishingMedia: media,
      publishingFormats: [{ id: 'post', label: copy.postLabel[locale], media, firstComment: false, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } }],
      defaultPublishingFormatId: 'post', supportsTargetKind: (kind: string) => kind === 'x',
    };
  }, connection: xConnection, jobs: { posts: renewXTokens },
} satisfies PlatformHost;
