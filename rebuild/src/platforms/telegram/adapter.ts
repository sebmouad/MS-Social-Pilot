import { createHash } from 'node:crypto';
import type { PlatformAdapter, PlatformCredential, PublishRequest, PublishResult } from '../types';
import { ProviderHttpError } from '@/server/platforms/provider-http';
import { policySchema, type Policy } from './config';
import { createClient } from './client';

/** The stored credential is module-owned: bot token and channel, encoded together. */
export const encodeTelegramCredential = (token: string, channel: string) => JSON.stringify({ token, channel });
export function decodeTelegramCredential(raw: string): { token: string; channel: string } | null {
  try {
    const value = JSON.parse(raw) as { token?: unknown; channel?: unknown };
    return typeof value.token === 'string' && typeof value.channel === 'string' ? { token: value.token, channel: value.channel } : null;
  } catch { return null; }
}

/** Text-only channel messages. A failure after sending began is uncertain and never resent automatically. */
export function createTelegramAdapter(input: Policy, options: { fetch?: typeof fetch; locale?: 'en' | 'fr' } = {}): PlatformAdapter {
  const policy = policySchema.parse(input);
  const locale = options.locale ?? 'en';
  const client = createClient(policy, options.fetch ?? fetch, locale);
  const media = { kinds: [] as const, maxImages: 0, maxVideos: 0, mixedKinds: false, linkWithMedia: false, imageAltText: false };
  const usable = (credential: PlatformCredential) => decodeTelegramCredential(credential.accessToken) !== null;

  async function publish(request: PublishRequest): Promise<PublishResult> {
    const credential = decodeTelegramCredential(request.credential.accessToken);
    if (!credential) throw new ProviderHttpError(policy.copy.reconnect[locale], 'rejected');
    if (request.target.kind !== 'telegram' || request.scheduledAt || request.media?.length || (request.formatId && request.formatId !== 'post')) throw new ProviderHttpError(policy.copy.invalid[locale], 'rejected');
    const text = request.link ? `${request.text}\n${request.link}` : request.text;
    if (!text.trim() || text.length > policy.maxTextCharacters) throw new ProviderHttpError(policy.copy.invalid[locale], 'rejected');
    try { return { ...(await client.publish(credential.token, credential.channel, text)), url: null }; }
    catch { throw new ProviderHttpError(policy.copy.uncertain[locale], 'uncertain'); }
  }

  return {
    id: 'telegram',
    statusPolicyFingerprint: createHash('sha256').update(JSON.stringify({ policy })).digest('hex'),
    capabilities: { connection: 'supported', discovery: 'supported', publishing: 'supported', remoteStatus: 'unsupported', remoteDelete: 'unsupported', inbox: 'unsupported', analytics: 'unsupported', ads: 'unsupported' },
    publishingMedia: media, defaultPublishingFormatId: 'post',
    publishingFormats: [{ id: 'post', label: policy.copy.post[locale], media, firstComment: false, remoteStatus: false, remoteDelete: false, scheduling: { application: true, native: false } }],
    supportsTargetKind: (kind, capability) => kind === 'telegram' && capability === 'publishing',
    canUseCredential: (credential, capability) => capability === 'publishing' && usable(credential),
    classifyPublishingFailure: error => error instanceof ProviderHttpError ? error.outcome : 'uncertain',
    publish,
  };
}
