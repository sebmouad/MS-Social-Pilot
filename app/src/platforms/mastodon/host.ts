import { runtimeConfig } from '@/server/config/store';
import type { PlatformHost } from '@/server/platforms/host';
import type { PlatformAdapter, PlatformCredential } from '../types';
import { requestLocale } from '@/server/platforms/request-locale';
import { createMastodonAdapter } from './adapter';
import { mastodonConnection, decodeMastodonCredential, mastodonSettings } from './connection';
import { mastodonTransport } from './transport';

export const mastodonHost = {
  connection: mastodonConnection,
  async adapter(): Promise<PlatformAdapter> {
    const s = await mastodonSettings(), locale = await requestLocale();
    const make = (credential: PlatformCredential) => {
      const stored = decodeMastodonCredential(credential.accessToken);
      return { adapter: createMastodonAdapter(s.policy, { instance: stored.instance, transport: mastodonTransport(s.maxBytes), locale }), credential: { ...credential, accessToken: stored.token } };
    };
    const adapter = createMastodonAdapter(s.policy, { instance: s.instance, transport: mastodonTransport(s.maxBytes), locale });
    const copy = await runtimeConfig('mastodon.connectionPolicy') as { postLabel: { en: string; fr: string } };
    return { ...adapter,
      publishingFormats: [{ id: 'post', label: copy.postLabel[locale], media: adapter.publishingMedia, firstComment: false, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } }],
      defaultPublishingFormatId: 'post', supportsTargetKind: kind => kind === 'mastodon',
      canUseCredential: credential => { try { decodeMastodonCredential(credential.accessToken); return s.policy.scopes.every(scope => credential.grantedScopes?.includes(scope)); } catch { return false; } },
      async discover(input) { const current = make(input.credential); return current.adapter.discover({ ...input, credential: current.credential }); },
      async publish(input) { const current = make(input.credential); return current.adapter.publish({ ...input, credential: current.credential }); },
      async getRemoteStatus(input) { const current = make(input.credential); return current.adapter.getRemoteStatus({ ...input, credential: current.credential }); },
      async deleteRemote(input) { const current = make(input.credential); return current.adapter.deleteRemote({ ...input, credential: current.credential }); },
    };
  },
} satisfies PlatformHost;
