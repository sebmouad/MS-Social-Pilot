import { z } from 'zod';
import type { PlatformAdapter, PlatformCredential, OAuthExchangeRequest, PublishRequest } from '../types';
import type { Policy } from './config';
import { linkedinModule } from './manifest';
import { ProviderError, transport } from './transport';

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().positive(), refresh_token: z.string().optional(), scope: z.string().optional() });
const person = z.object({ sub: z.string().min(1), name: z.string().min(1), picture: z.string().optional() });
export function linkedinCommentary(text: string) {
  return text.replace(/[\\|{}@[\]()<>*_~]/g, char => `\\${char}`).replace(/(^|\s)#([\p{L}\p{N}_]+)/gu, (_, space: string, tag: string) => `${space}{hashtag|\\#|${tag}}`);
}
export function createLinkedinAdapter(policy: Policy, fetcher: typeof fetch = fetch, locale: 'en' | 'fr' = 'en') {
  const send = transport(policy, fetcher);
  const endpoint = (path: string) => `${policy.apiBaseUrl.replace(/\/$/, '')}${path}`;
  const headers = (token: string) => ({ authorization: `Bearer ${token}`, 'linkedin-version': policy.version, 'x-restli-protocol-version': '2.0.0' });
  const has = (credential: PlatformCredential, scopes: string[]) => scopes.every(scope => credential.grantedScopes?.includes(scope));
  async function exchange(request: OAuthExchangeRequest) {
    const response = await send(policy.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: request.code, redirect_uri: request.redirectUri, client_id: request.appId, client_secret: request.appSecret }) });
    const token = tokenSchema.parse(await response.json());
    return { accessToken: token.access_token, refreshToken: token.refresh_token ?? null, expiresAt: new Date(Date.now() + token.expires_in * 1000), scopes: token.scope?.split(/[\s,]+/).filter(Boolean) ?? [] };
  }
  async function currentUser(accessToken: string) {
    const user = person.parse(await (await send(endpoint('/v2/userinfo'), { headers: headers(accessToken) })).json());
    return { id: user.sub, name: user.name, pictureUrl: user.picture ?? null };
  }
  const adapter: PlatformAdapter = {
    id: 'linkedin', capabilities: linkedinModule.capabilities,
    defaultPublishingFormatId: 'feed',
    publishingMedia: { kinds: ['image'], maxImages: policy.maxImages, maxVideos: 0, mixedKinds: false, linkWithMedia: true, imageAltText: true },
    publishingFormats: [{ id: 'feed', label: policy.copy.format[locale], media: { kinds: ['image'], maxImages: policy.maxImages, maxVideos: 0, mixedKinds: false, linkWithMedia: true, imageAltText: true }, firstComment: false, remoteStatus: true, remoteDelete: false, scheduling: { application: true, native: false } }],
    localImageUpload: { maxBytes: policy.maxUploadBytes, mimeTypes: policy.uploadMimeTypes },
    canUseCredential: (credential, operation) => operation === 'publishing' ? has(credential, policy.memberPublishScopes) || has(credential, policy.organizationPublishScopes) : operation === 'remoteStatus' && (has(credential, policy.memberReadScopes) || has(credential, policy.organizationReadScopes)),
    supportsTargetKind: (kind, capability) => kind === 'linkedin' && capability === 'publishing',
    getAuthorizationUrl(request) {
      const url = new URL(policy.authorizationUrl);
      url.search = new URLSearchParams({ response_type: 'code', client_id: request.appId, redirect_uri: request.redirectUri, state: request.state, scope: request.scopes.join(' ') }).toString();
      return url.toString();
    },
    exchangeCode: exchange,
    async discover({ credential }) {
      const user = await currentUser(credential.accessToken);
      const targets = [{ id: `urn:li:person:${user.id}`, name: user.name, kind: 'linkedin' }];
      if (policy.organizationsEnabled && has(credential, policy.organizationScopes)) {
        for (let page = 0; page < policy.maxPages; page++) {
          const url = new URL(endpoint('/rest/organizationAcls'));
          url.search = new URLSearchParams({ q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED', count: String(policy.pageSize), start: String(page * policy.pageSize) }).toString();
          const result = z.object({ elements: z.array(z.object({ organization: z.string().regex(/^urn:li:organization:[^:]+$/) })) }).parse(await (await send(url, { headers: headers(credential.accessToken) })).json());
          for (const item of result.elements) {
            const detail = z.object({ localizedName: z.string().min(1) }).parse(await (await send(endpoint(`/rest/organizations/${encodeURIComponent(item.organization.split(':').pop()!)}`), { headers: headers(credential.accessToken) })).json());
            targets.push({ id: item.organization, name: detail.localizedName, kind: 'linkedin' });
          }
          if (result.elements.length < policy.pageSize) return { targets };
        }
        throw new ProviderError(0); // Fail closed instead of claiming truncated discovery is complete.
      }
      return { targets };
    },
    async publish(request: PublishRequest) {
      const { credential, target, signal } = request;
      const required = target.id.startsWith('urn:li:organization:') ? policy.organizationPublishScopes : policy.memberPublishScopes;
      if (!/^urn:li:(person|organization):[^:]+$/.test(target.id) || target.kind !== 'linkedin' || !has(credential, required) || request.scheduledAt || request.formatId && request.formatId !== 'feed' || request.text.length > policy.textLength || (request.media?.length ?? 0) > policy.maxImages || !request.text.trim() && !request.link && !request.media?.length) throw new ProviderError(400, true);
      const images = request.media ?? [];
      // Validate the entire batch before any upload side effect. Shared services supply local bytes.
      for (const image of images) if (image.kind !== 'image' || !image.localFile || !policy.uploadMimeTypes.includes(image.localFile.mimeType) || !image.localFile.bytes.length || image.localFile.bytes.length > policy.maxUploadBytes) throw new ProviderError(400, true);
      const uploaded = [];
      for (const image of images) {
        const initialized = z.object({ value: z.object({ uploadUrl: z.string().url(), image: z.string().regex(/^urn:li:image:/) }) }).parse(await (await send(endpoint('/rest/images?action=initializeUpload'), { method: 'POST', headers: { ...headers(credential.accessToken), 'content-type': 'application/json' }, body: JSON.stringify({ initializeUploadRequest: { owner: target.id } }), signal })).json());
        const upload = new URL(initialized.value.uploadUrl);
        if (upload.protocol !== 'https:' || upload.username || upload.password || !policy.uploadHosts.includes(upload.hostname)) throw new ProviderError(0);
        await send(upload, { method: 'PUT', headers: { authorization: `Bearer ${credential.accessToken}`, 'content-type': image.localFile!.mimeType }, body: new Uint8Array(image.localFile!.bytes), signal });
        uploaded.push({ id: initialized.value.image, ...(image.altText ? { altText: image.altText } : {}) });
      }
      const text = images.length && request.link && !request.text.includes(request.link) ? `${request.text}\n\n${request.link}` : request.text;
      if (text.length > policy.textLength) throw new ProviderError(400, true);
      const content = uploaded.length > 1 ? { multiImage: { images: uploaded } } : uploaded.length ? { media: uploaded[0] } : request.link ? { article: { source: request.link, title: request.link } } : undefined;
      const response = await send(endpoint('/rest/posts'), { method: 'POST', headers: { ...headers(credential.accessToken), 'content-type': 'application/json' }, body: JSON.stringify({ author: target.id, commentary: linkedinCommentary(text), visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false, ...(content ? { content } : {}) }), signal });
      const remoteId = response.headers.get('x-restli-id') ?? response.headers.get('x-linkedin-id');
      if (!remoteId || !/^urn:li:(share|ugcPost):[^:]+$/.test(remoteId)) throw new ProviderError(0);
      return { remoteId, url: `${policy.publicPostUrl.replace(/\/$/, '')}/${encodeURIComponent(remoteId)}/`, state: 'published' };
    },
    async getRemoteStatus(request) {
      if (request.formatId && request.formatId !== 'feed' || !/^urn:li:(share|ugcPost):[^:]+$/.test(request.remoteId)) return { state: 'unknown' };
      if (!has(request.credential, request.target.id.startsWith('urn:li:organization:') ? policy.organizationReadScopes : policy.memberReadScopes)) return { state: 'unknown' };
      const result = z.object({ id: z.string(), author: z.string(), lifecycleState: z.string(), publishedAt: z.number().optional() }).parse(await (await send(endpoint(`/rest/posts/${encodeURIComponent(request.remoteId)}`), { headers: headers(request.credential.accessToken), signal: request.signal })).json());
      return result.id === request.remoteId && result.author === request.target.id && result.lifecycleState === 'PUBLISHED' ? { state: 'published', remoteId: result.id, targetId: result.author, publishedAt: result.publishedAt ? new Date(result.publishedAt) : null } : { state: 'unknown' };
    },
    classifyPublishingFailure: error => error instanceof ProviderError && error.rejected ? 'rejected' : 'uncertain',
  };
  return { adapter, exchange, currentUser };
}
