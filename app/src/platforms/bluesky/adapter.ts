import { createHash } from 'node:crypto';
import type { PlatformAdapter, PlatformCredential, PublishRequest, PublishResult } from '../types';
import { ProviderHttpError } from '@/server/platforms/provider-http';
import { policySchema, type Policy } from './config';
import { createClient } from './client';

/** The stored credential is module-owned: the account identifier and app password, encoded together. */
export const encodeBlueskyCredential = (identifier: string, appPassword: string) => JSON.stringify({ identifier, appPassword });
export function decodeBlueskyCredential(raw: string): { identifier: string; appPassword: string } | null {
  try {
    const value = JSON.parse(raw) as { identifier?: unknown; appPassword?: unknown };
    return typeof value.identifier === 'string' && typeof value.appPassword === 'string' ? { identifier: value.identifier, appPassword: value.appPassword } : null;
  } catch { return null; }
}

const usable = (credential: PlatformCredential) => decodeBlueskyCredential(credential.accessToken) !== null;

/** Text-only publishing. Every failure after the write was sent is uncertain and never resent automatically. */
export function createBlueskyAdapter(input: Policy, options: { fetch?: typeof fetch; locale?: 'en' | 'fr' } = {}): PlatformAdapter {
  const policy = policySchema.parse(input);
  const locale = options.locale ?? 'en';
  const client = createClient(policy, options.fetch ?? fetch, locale);
  const media = { kinds: [] as const, maxImages: 0, maxVideos: 0, mixedKinds: false, linkWithMedia: false, imageAltText: false };

  async function publish(request: PublishRequest): Promise<PublishResult> {
    const credential = decodeBlueskyCredential(request.credential.accessToken);
    if (!credential) throw new ProviderHttpError(policy.copy.reconnect[locale], 'rejected');
    if (request.target.kind !== 'bluesky' || request.scheduledAt || request.media?.length || (request.formatId && request.formatId !== 'post')) throw new ProviderHttpError(policy.copy.invalid[locale], 'rejected');
    const text = request.link ? `${request.text}\n${request.link}` : request.text;
    let session;
    try { session = await client.connect(credential.identifier, credential.appPassword); }
    catch { throw new ProviderHttpError(policy.copy.reconnect[locale], 'rejected'); }
    try { return { ...(await client.publish(session, text)), url: null }; }
    catch { throw new ProviderHttpError(policy.copy.uncertain[locale], 'uncertain'); }
  }

  return {
    id: 'bluesky',
    statusPolicyFingerprint: createHash('sha256').update(JSON.stringify({ policy })).digest('hex'),
    capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'unsupported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
    publishingMedia: media, defaultPublishingFormatId: 'post',
    publishingFormats: [{ id: 'post', label: policy.copy.post[locale], media, firstComment: false, remoteStatus: false, remoteDelete: false, scheduling: { application: true, native: false } }],
    supportsTargetKind: (kind, capability) => kind === 'bluesky' && capability === 'publishing',
    canUseCredential: (credential, capability) => capability === 'publishing' && usable(credential),
    classifyPublishingFailure: error => error instanceof ProviderHttpError ? error.outcome : 'uncertain',
    publish,
  };
}
