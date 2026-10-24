import { mastodonModule } from './manifest';
import type { PlatformAdapter, PlatformCredential } from '../types';
import { mastodonPolicySchema, type MastodonPolicy } from './config';
/** The host MUST implement DNS resolution/pinning, public-IP checks, redirect refusal,
 * timeout and response-size limits. There is deliberately no raw-fetch fallback. */
export class MastodonError extends Error { constructor(message: string) { super(message); this.name = 'MastodonError'; } }
export type MastodonSafeTransport = (url: string, init: RequestInit & { timeoutMs: number }) => Promise<unknown>;
export function normaliseInstance(raw: string): string {
  const value = raw.trim().toLowerCase();
  const handle = /^@?[^@\s/]+@([^@\s/]+)$/.exec(value);
  const url = new URL(handle ? `https://${handle[1]}` : value.includes('://') ? value : `https://${value}`);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/' || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(url.hostname) || /(?:^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)) throw new Error('Invalid Mastodon server');
  return url.origin;
}
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Mastodon response'); return value as Record<string, unknown>; }
function id(value: unknown): string { if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Invalid Mastodon identifier'); return value; }
export function createMastodonAdapter(input: MastodonPolicy, context: { instance: string; transport: MastodonSafeTransport; sleep?: (ms: number) => Promise<void>; locale?: 'en' | 'fr' }) {
  const policy = mastodonPolicySchema.parse(input), instance = normaliseInstance(context.instance);
  const sleep = context.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const call = async (path: string, init: RequestInit = {}) => { try { return record(await context.transport(`${instance}${path}`, { ...init, redirect: 'error', timeoutMs: policy.timeoutMs })); } catch { throw new MastodonError(policy.copy.unavailable[context.locale ?? 'en']); } };
  const auth = (credential: PlatformCredential) => ({ authorization: `Bearer ${credential.accessToken}` });
  const json = (data: unknown) => JSON.stringify(data);
  const account = async (credential: PlatformCredential) => call(policy.paths.account, { headers: auth(credential) });
  const ownStatus = async (credential: PlatformCredential, remoteId: string, signal?: AbortSignal) => {
    const [me, status] = await Promise.all([account(credential), call(`${policy.paths.statuses}/${id(remoteId)}`, { headers: auth(credential), signal })]);
    if (id(record(status.account).id) !== id(me.id)) throw new Error('Mastodon status ownership mismatch');
    return status;
  };
  const adapter = {
    id: 'mastodon', capabilities: mastodonModule.capabilities,
    publishingMedia: { kinds: ['image', 'video'], maxImages: policy.maxImages, maxVideos: policy.maxVideos, mixedKinds: false, linkWithMedia: true, imageAltText: true },
    getAuthorizationUrl(request) { const url = new URL(`${instance}${policy.paths.authorize}`); url.search = new URLSearchParams({ client_id: request.appId, redirect_uri: request.redirectUri, response_type: 'code', scope: policy.scopes.join(' '), state: request.state }).toString(); return url.href; },
    async exchangeCode(request) { const data = await call(policy.paths.token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ grant_type: 'authorization_code', client_id: request.appId, client_secret: request.appSecret, code: request.code, redirect_uri: request.redirectUri, scope: policy.scopes.join(' ') }) }); if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('Missing Mastodon token'); return { accessToken: data.access_token, grantedScopes: typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : policy.scopes }; },
    async discover(request) { const me = await account(request.credential); return { targets: [{ id: `${id(me.id)}@${new URL(instance).host}`, name: String(me.display_name || me.acct || me.username), kind: 'mastodon-account' }] }; },
    async publish(request) {
      if (request.scheduledAt || (request.formatId && request.formatId !== 'post')) throw new Error('Unsupported Mastodon format');
      const me = await account(request.credential);
      if (request.target.id !== `${id(me.id)}@${new URL(instance).host}`) throw new Error('Mastodon target ownership mismatch');
      const text = [request.text, request.link].filter(Boolean).join('\n\n');
      if (Array.from(text).length > policy.maxCharacters || !request.operationId) throw new Error('Invalid Mastodon publication');
      const media = request.media ?? [];
      if (media.some(item => item.kind === 'video') && media.some(item => item.kind !== 'video') || media.filter(item => item.kind === 'image').length > policy.maxImages || media.filter(item => item.kind === 'video').length > policy.maxVideos) throw new Error('Unsupported Mastodon media');
      if (media.some(item => !item.localFile || item.localFile.bytes.byteLength > policy.maxMediaBytes || (item.altText?.length ?? 0) > policy.maxAltCharacters) || (!text && !media.length)) throw new Error('Invalid Mastodon media');
      const mediaIds: string[] = [];
      for (const item of media) {
        const file = item.localFile!; const form = new FormData();
        form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.fileName);
        if (item.altText) form.append('description', item.altText);
        let uploaded = await call(policy.paths.mediaUpload, { method: 'POST', headers: auth(request.credential), body: form, signal: request.signal });
        const mediaId = id(uploaded.id);
        for (let attempt = 0; !uploaded.url && attempt < policy.pollAttempts; attempt++) { await sleep(policy.pollIntervalMs); uploaded = await call(`${policy.paths.mediaStatus}/${mediaId}`, { headers: auth(request.credential), signal: request.signal }); }
        if (!uploaded.url) throw new Error('Mastodon media processing unresolved');
        mediaIds.push(mediaId);
      }
      const status = await call(policy.paths.statuses, { method: 'POST', headers: { ...auth(request.credential), 'content-type': 'application/json', 'idempotency-key': request.operationId }, body: json({ status: text, media_ids: mediaIds, visibility: policy.visibility }), signal: request.signal });
      return { remoteId: id(status.id), url: typeof status.url === 'string' ? status.url : null, state: 'published' };
    },
    classifyPublishingFailure() { return 'uncertain'; },
    async getRemoteStatus(request) { const status = await ownStatus(request.credential, request.remoteId, request.signal); const targetId = `${id(record(status.account).id)}@${new URL(instance).host}`; if (targetId !== request.target.id) throw new Error('Mastodon target ownership mismatch'); return { state: 'published', remoteId: id(status.id), targetId }; },
    async deleteRemote(request) { await ownStatus(request.credential, request.remoteId, request.signal); await call(`${policy.paths.statuses}/${id(request.remoteId)}`, { method: 'DELETE', headers: auth(request.credential), signal: request.signal }); },
  } satisfies PlatformAdapter;
  return { ...adapter, async registerApp(redirectUri: string, website: string) { const data = await call(policy.paths.apps, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ client_name: policy.appName, redirect_uris: redirectUri, scopes: policy.scopes.join(' '), website }) }); if (typeof data.client_id !== 'string' || typeof data.client_secret !== 'string') throw new Error('Invalid Mastodon app registration'); return { clientId: data.client_id, clientSecret: data.client_secret }; } };
}
