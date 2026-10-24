import { createHash, randomBytes } from 'node:crypto';
import { ProviderHttpError } from '@/server/platforms/provider-http';
import type { PlatformAdapter, PlatformCredential } from '../types';
import { xModule } from './manifest';
import { xPolicySchema, type XPolicy } from './config';
export interface XTokens { accessToken: string; refreshToken?: string; expiresAt: Date; grantedScopes: string[] }
export class XProtocolError extends ProviderHttpError {
  constructor(message: string, readonly uncertain: boolean, status?: number) { super(message, uncertain ? 'uncertain' : 'rejected', false, status); }
}
/** Protocol-only adapter. No customer capability is advertised until the shared host is implemented. */
export function createXAdapter(input: XPolicy, credentials: { clientId: string; clientSecret: string }, options: { fetch?: typeof fetch; now?: () => number; locale?: 'en' | 'fr' } = {}) {
  const policy = xPolicySchema.parse(input), send = options.fetch ?? fetch, now = options.now ?? Date.now, locale = options.locale ?? 'en';
  const invalid = () => new XProtocolError(policy.copy.invalid[locale], false);
  const url = (path: string) => `${policy.apiUrl.replace(/\/$/, '')}/${path}`;
  async function request(path: string, init: RequestInit = {}, token?: string): Promise<unknown> {
    const write = init.method === 'POST' || init.method === 'DELETE';
    try {
      const response = await send(url(path), { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(policy.requestTimeoutMs)]) : AbortSignal.timeout(policy.requestTimeoutMs), headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
      if (!response.ok) throw new XProtocolError(policy.copy.unavailable[locale], write && response.status >= 500, response.status);
      return await response.json();
    } catch (error) { if (error instanceof XProtocolError) throw error; throw new XProtocolError(policy.copy.unavailable[locale], write); }
  }
  const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const id = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value) ? value : null;
  async function token(form: URLSearchParams): Promise<XTokens> {
    const data = record(await request('oauth2/token', { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${encodeURIComponent(credentials.clientId)}:${encodeURIComponent(credentials.clientSecret)}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form }));
    if (typeof data.access_token !== 'string' || !data.access_token || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new XProtocolError(policy.copy.unavailable[locale], true);
    return { accessToken: data.access_token, ...(typeof data.refresh_token === 'string' ? { refreshToken: data.refresh_token } : {}), expiresAt: new Date(now() + data.expires_in * 1000), grantedScopes: typeof data.scope === 'string' ? data.scope.split(' ') : [] };
  }
  const adapter: PlatformAdapter = {
    id: 'x', capabilities: xModule.capabilities,
    classifyPublishingFailure: error => error instanceof XProtocolError && !error.uncertain ? 'rejected' : 'uncertain',
    async discover({ credential }) {
      const data = record(record(await request('users/me?user.fields=profile_image_url', {}, credential.accessToken)).data);
      const remoteId = id(data.id);
      if (!remoteId || typeof data.username !== 'string') throw invalid();
      return { targets: [{ id: remoteId, name: `@${data.username}`, kind: 'x' }] };
    },
    async publish(requested) {
      const text = [requested.text, requested.link].filter(Boolean).join('\n\n'), media = requested.media ?? [];
      // Conservative character count; weighted URL shortening remains a host integration gap.
      if (requested.target.kind !== 'x' || !id(requested.target.id) || requested.scheduledAt || (requested.formatId && requested.formatId !== 'post') || !text.trim() && !media.length || [...text].length > policy.maxCharacters || media.length > policy.maxImages || media.some(item => item.kind !== 'image' || !item.localFile || !policy.imageMimeTypes.includes(item.localFile.mimeType) || item.localFile.bytes.byteLength > policy.maxImageBytes || !item.localFile.bytes.byteLength || item.altText)) throw invalid();
      const mediaIds: string[] = [];
      for (const image of media) {
        const file = image.localFile!;
        const form = new FormData(); form.append('media', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.fileName); form.append('media_category', 'tweet_image');
        const mediaId = id(record(record(await request('media/upload', { method: 'POST', body: form, signal: requested.signal }, requested.credential.accessToken)).data).id);
        if (!mediaId) throw new XProtocolError(policy.copy.unavailable[locale], true);
        mediaIds.push(mediaId);
      }
      const data = record(record(await request('tweets', { method: 'POST', signal: requested.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }) }, requested.credential.accessToken)).data);
      const remoteId = id(data.id); if (!remoteId) throw new XProtocolError(policy.copy.unavailable[locale], true);
      return { remoteId, url: `${policy.publicUrl.replace(/\/$/, '')}/i/status/${remoteId}`, state: 'published' };
    },
    async getRemoteStatus(requested) {
      if (!id(requested.remoteId)) throw invalid();
      const data = record(record(await request(`tweets/${requested.remoteId}?tweet.fields=author_id,created_at`, { signal: requested.signal }, requested.credential.accessToken)).data);
      if (id(data.id) !== requested.remoteId || id(data.author_id) !== requested.target.id) return { state: 'unknown' };
      return { state: 'published', remoteId: requested.remoteId, targetId: requested.target.id };
    },
    async deleteRemote(requested) {
      if (!id(requested.remoteId)) throw invalid();
      const data = record(record(await request(`tweets/${requested.remoteId}`, { method: 'DELETE', signal: requested.signal }, requested.credential.accessToken)).data);
      if (data.deleted !== true) throw new XProtocolError(policy.copy.unavailable[locale], true);
    },
  };
  return {
    ...adapter,
    refreshToken(refreshToken: string) { return token(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })); },
    startOAuth(request: { requestOrigin: string; state: string }) {
      if (!request.state) throw invalid();
      const origin = new URL(request.requestOrigin); if (origin.origin !== request.requestOrigin || !['https:', 'http:'].includes(origin.protocol)) throw invalid();
      const verifier = randomBytes(32).toString('base64url'), redirectUri = new URL(policy.callbackPath, origin).toString();
      const authorization = new URL(policy.authorizationUrl);
      authorization.search = new URLSearchParams({ response_type: 'code', client_id: credentials.clientId, redirect_uri: redirectUri, scope: policy.scopes.join(' '), state: request.state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
      return { url: authorization.toString(), verifier, redirectUri };
    },
    exchangeCode(request: { code: string; verifier: string; redirectUri: string }) { return token(new URLSearchParams({ grant_type: 'authorization_code', code: request.code, code_verifier: request.verifier, redirect_uri: request.redirectUri })); },
    /** Host must serialize refresh per connection; persist rotated credentials before any later write. */
    async renewCredential(current: PlatformCredential & { refreshToken?: string; expiresAt: Date }, save: (tokens: XTokens) => Promise<void>) {
      if (current.expiresAt.getTime() - now() > policy.refreshBeforeExpiryMs) return current;
      if (!current.refreshToken) throw invalid();
      const next = await token(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refreshToken }));
      if (!next.refreshToken) throw new XProtocolError(policy.copy.unavailable[locale], true);
      await save(next); return next;
    },
  };
}
