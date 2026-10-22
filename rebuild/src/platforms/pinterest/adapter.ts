import { z } from 'zod';
import type { PlatformAdapter, OAuthExchangeRequest, PlatformCredential } from '../types';
import type { Policy } from './config';
import { pinterestModule } from './manifest';
import { ProviderError, transport } from './transport';

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive(), refresh_token: z.string().optional(), scope: z.string().optional() });
export function createPinterestAdapter(policy: Policy, fetcher: typeof fetch = fetch, locale: 'en' | 'fr' = 'en') {
  const send = transport(policy, fetcher);
  const endpoint = (path: string) => `${policy.apiBaseUrl.replace(/\/$/, '')}${path}`;
  const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const has = (credential: PlatformCredential, scopes: string[]) => scopes.every(scope => credential.grantedScopes?.includes(scope));
  async function token(appId: string, appSecret: string, body: URLSearchParams, signal?: AbortSignal) {
    const result = tokenSchema.parse(await (await send(policy.tokenUrl, { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body, signal })).json());
    return { accessToken: result.access_token, refreshToken: result.refresh_token ?? null, expiresAt: new Date(Date.now() + result.expires_in * 1000), scopes: result.scope?.split(/[\s,]+/).filter(Boolean) ?? [] };
  }
  async function exchange(request: OAuthExchangeRequest) {
    return token(request.appId, request.appSecret, new URLSearchParams({ grant_type: 'authorization_code', code: request.code, redirect_uri: request.redirectUri }));
  }
  async function currentUser(accessToken: string) {
    const user = z.object({ username: z.string().min(1), business_name: z.string().optional(), profile_image: z.string().optional() }).parse(await (await send(endpoint('/user_account'), { headers: headers(accessToken) })).json());
    return { id: user.username, name: user.business_name || user.username, pictureUrl: user.profile_image ?? null };
  }
  const adapter: PlatformAdapter = {
    id: 'pinterest', capabilities: pinterestModule.capabilities,
    defaultPublishingFormatId: 'pin',
    publishingMedia: { kinds: ['image'], maxImages: policy.maxImages, maxVideos: 0, mixedKinds: false, linkWithMedia: true, imageAltText: true },
    publishingFormats: [{ id: 'pin', label: policy.copy.format[locale], media: { kinds: ['image'], maxImages: policy.maxImages, maxVideos: 0, mixedKinds: false, linkWithMedia: true, imageAltText: true }, firstComment: false, remoteStatus: true, remoteDelete: true, scheduling: { application: true, native: false } }],
    canUseCredential: (credential, operation) => has(credential, operation === 'remoteStatus' ? policy.readScopes : policy.publishScopes) && operation !== 'firstComment',
    supportsTargetKind: (kind, capability) => kind === 'pinterest' && capability === 'publishing',
    getAuthorizationUrl(request) {
      const url = new URL(policy.authorizationUrl);
      url.search = new URLSearchParams({ response_type: 'code', client_id: request.appId, redirect_uri: request.redirectUri, state: request.state, scope: request.scopes.join(',') }).toString();
      return url.toString();
    }, exchangeCode: exchange,
    async discover({ credential }) {
      const targets = [];
      let bookmark: string | null = null;
      const seen = new Set<string>();
      for (let page = 0; page < policy.maxPages; page++) {
        const url = new URL(endpoint('/boards'));
        url.searchParams.set('page_size', String(policy.pageSize));
        if (bookmark) url.searchParams.set('bookmark', bookmark);
        const result = z.object({ items: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })), bookmark: z.string().nullish() }).parse(await (await send(url, { headers: headers(credential.accessToken) })).json());
        targets.push(...result.items.map(item => ({ ...item, kind: 'pinterest' })));
        bookmark = result.bookmark ?? null;
        if (!bookmark) return { targets };
        if (seen.has(bookmark)) throw new ProviderError(0);
        seen.add(bookmark);
      }
      throw new ProviderError(0);
    },
    async publish(request) {
      const images = request.media ?? [];
      if (!has(request.credential, policy.publishScopes) || request.target.kind !== 'pinterest' || !request.target.id || request.scheduledAt || request.formatId && request.formatId !== 'pin' || !images.length || images.length > policy.maxImages || request.text.length > policy.textLength) throw new ProviderError(400, true);
      for (const image of images) {
        let url: URL;
        try { url = new URL(image.url); } catch { throw new ProviderError(400, true); }
        if (image.kind !== 'image' || url.protocol !== 'https:' || url.username || url.password || (image.altText?.length ?? 0) > policy.altTextLength) throw new ProviderError(400, true);
      }
      const result = z.object({ id: z.string().min(1) }).parse(await (await send(endpoint('/pins'), { method: 'POST', headers: headers(request.credential.accessToken), signal: request.signal, body: JSON.stringify({
        board_id: request.target.id, title: (request.text.split('\n').find(line => line.trim()) ?? '').slice(0, policy.titleLength), description: request.text,
        ...(request.link ? { link: request.link } : {}), ...(images[0]!.altText ? { alt_text: images[0]!.altText } : {}),
        media_source: images.length > 1 ? { source_type: 'multiple_image_urls', items: images.map(image => ({ url: image.url, ...(image.altText ? { description: image.altText } : {}) })) } : { source_type: 'image_url', url: images[0]!.url },
      }) })).json());
      return { state: 'published', remoteId: result.id, url: `${policy.publicPostUrl.replace(/\/$/, '')}/${encodeURIComponent(result.id)}/` };
    },
    async getRemoteStatus(request) {
      if (!has(request.credential, policy.readScopes) || request.formatId && request.formatId !== 'pin') return { state: 'unknown' };
      const result = z.object({ id: z.string(), board_id: z.string(), created_at: z.string().datetime().optional() }).parse(await (await send(endpoint(`/pins/${encodeURIComponent(request.remoteId)}`), { headers: headers(request.credential.accessToken), signal: request.signal })).json());
      return result.id === request.remoteId && result.board_id === request.target.id ? { state: 'published', remoteId: result.id, targetId: result.board_id, publishedAt: result.created_at ? new Date(result.created_at) : null } : { state: 'unknown' };
    },
    async deleteRemote(request) {
      if (!request.remoteId || !has(request.credential, policy.publishScopes) || request.formatId && request.formatId !== 'pin') throw new ProviderError(400, true);
      try { await send(endpoint(`/pins/${encodeURIComponent(request.remoteId)}`), { method: 'DELETE', headers: headers(request.credential.accessToken), signal: request.signal }); }
      catch (error) { if (!(error instanceof ProviderError && error.status === 404)) throw error; }
    },
    classifyPublishingFailure: error => error instanceof ProviderError && error.rejected ? 'rejected' : 'uncertain',
  };
  return { adapter, exchange, currentUser, renew: (appId: string, appSecret: string, refreshToken: string, signal?: AbortSignal) => token(appId, appSecret, new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }), signal) };
}
