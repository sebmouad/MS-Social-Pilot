import { object, providerRequest, ProviderHttpError, type ProviderMessages } from '@/server/platforms/provider-http';
import type { RenewedToken } from '@/server/platforms/token-connection';
import type { TiktokPolicy } from './config';

type Locale = 'en' | 'fr';

export function tiktokText(policy: TiktokPolicy, key: keyof TiktokPolicy['copy'], locale: Locale = 'en') {
  return policy.copy[key][locale];
}
export function tiktokMessages(policy: TiktokPolicy, locale: Locale = 'en'): ProviderMessages {
  return { unavailable: tiktokText(policy, 'unavailable', locale), permission: tiktokText(policy, 'permission', locale), uncertain: tiktokText(policy, 'uncertain', locale) };
}

export type TiktokPublishState = 'processing' | 'complete' | 'failed';

/**
 * TikTok Login Kit and Content Posting API calls. Request paths, field names and the `error.code` envelope
 * are protocol invariants and stay in this file. TikTok often answers 200 with an error body, so every
 * response is checked for it.
 */
export function createTiktokApi(policy: TiktokPolicy, options: { clientKey: string; clientSecret: string; fetch?: typeof fetch; locale?: Locale }) {
  const messages = tiktokMessages(policy, options.locale ?? 'en');
  const base = policy.apiBaseUrl.replace(/\/+$/, '');
  const bearer = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' });

  /** An error envelope on a 200 answer. Authorization problems map to 401 so callers treat them as permission failures. */
  function assertOk(json: Record<string, unknown>, committing: boolean) {
    const code = object(json.error).code;
    if (typeof json.error === 'string' && json.error) throw new ProviderHttpError(messages.permission, 'rejected', false, 400);
    if (typeof code === 'string' && code !== 'ok') {
      if (code === 'access_token_invalid' || code === 'scope_not_authorized' || code === 'scope_permission_missed') throw new ProviderHttpError(messages.permission, 'rejected', false, 401);
      if (code === 'rate_limit_exceeded') throw new ProviderHttpError(messages.unavailable, 'rejected', true, 429);
      throw new ProviderHttpError(committing ? messages.uncertain : messages.unavailable, committing ? 'uncertain' : 'rejected', code === 'internal_error');
    }
  }

  function authorizationUrl(input: { redirectUri: string; state: string; challenge: string }) {
    const url = new URL(policy.authorizeUrl);
    url.search = new URLSearchParams({
      client_key: options.clientKey, redirect_uri: input.redirectUri, response_type: 'code', scope: policy.connectScopes.join(','),
      state: input.state, code_challenge: input.challenge, code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async function token(params: Record<string, string>, signal?: AbortSignal) {
    const { json } = await providerRequest({
      fetch: options.fetch, url: `${base}/oauth/token/`, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: options.clientKey, client_secret: options.clientSecret, ...params }), timeoutMs: policy.requestTimeoutMs, signal, messages,
    });
    assertOk(json, false);
    if (typeof json.access_token !== 'string' || !json.access_token || typeof json.expires_in !== 'number' || !(json.expires_in > 0)) throw new ProviderHttpError(messages.unavailable, 'rejected');
    const now = Date.now();
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === 'string' && json.refresh_token ? json.refresh_token : null,
      accessExpiresAt: new Date(now + json.expires_in * 1000),
      grantExpiresAt: typeof json.refresh_expires_in === 'number' && json.refresh_expires_in > 0 ? new Date(now + json.refresh_expires_in * 1000) : null,
      openId: typeof json.open_id === 'string' ? json.open_id : null,
      scopes: typeof json.scope === 'string' ? json.scope.split(/[\s,]+/).filter(Boolean) : [],
    };
  }

  const exchange = (input: { code: string; redirectUri: string; verifier: string; signal?: AbortSignal }) =>
    token({ grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri, code_verifier: input.verifier }, input.signal);

  async function refresh(refreshToken: string, signal?: AbortSignal): Promise<RenewedToken> {
    const renewed = await token({ grant_type: 'refresh_token', refresh_token: refreshToken }, signal);
    // TikTok rotates refresh tokens: the new one replaces the old.
    return { accessToken: renewed.accessToken, refreshToken: renewed.refreshToken ?? refreshToken, accessExpiresAt: renewed.accessExpiresAt, grantExpiresAt: renewed.grantExpiresAt };
  }

  async function user(accessToken: string, signal?: AbortSignal): Promise<{ openId: string; name: string; pictureUrl: string | null }> {
    const { json } = await providerRequest({ fetch: options.fetch, url: `${base}/user/info/?fields=open_id,display_name,avatar_url`, headers: bearer(accessToken), timeoutMs: policy.requestTimeoutMs, signal, messages });
    assertOk(json, false);
    const info = object(object(json.data).user);
    if (typeof info.open_id !== 'string' || !info.open_id) throw new ProviderHttpError(messages.unavailable, 'rejected');
    return { openId: info.open_id, name: typeof info.display_name === 'string' && info.display_name ? info.display_name : info.open_id, pictureUrl: typeof info.avatar_url === 'string' && info.avatar_url.startsWith('https://') ? info.avatar_url : null };
  }

  async function privacyLevels(accessToken: string, signal?: AbortSignal): Promise<string[]> {
    const { json } = await providerRequest({ fetch: options.fetch, url: `${base}/post/publish/creator_info/query/`, method: 'POST', headers: bearer(accessToken), timeoutMs: policy.requestTimeoutMs, signal, messages });
    assertOk(json, false);
    const levels = object(json.data).privacy_level_options;
    return Array.isArray(levels) ? levels.filter((level): level is string => typeof level === 'string') : [];
  }

  /** The most open level in Root's preference order that this creator allows. Private is the safe floor. */
  function pickPrivacy(allowed: readonly string[]): string {
    return policy.privacyPreference.find(level => allowed.includes(level)) ?? 'SELF_ONLY';
  }

  /** Create the upload. Nothing is posted yet, so a failure here is a clean refusal. */
  async function initVideo(input: { accessToken: string; caption: string; privacyLevel: string; size: number; signal?: AbortSignal }): Promise<{ publishId: string; uploadUrl: string }> {
    const { json } = await providerRequest({
      fetch: options.fetch, url: `${base}/post/publish/video/init/`, method: 'POST', headers: bearer(input.accessToken), timeoutMs: policy.requestTimeoutMs, signal: input.signal, messages,
      body: JSON.stringify({ post_info: { title: input.caption, privacy_level: input.privacyLevel }, source_info: { source: 'FILE_UPLOAD', video_size: input.size, chunk_size: input.size, total_chunk_count: 1 } }),
    });
    assertOk(json, false);
    const data = object(json.data);
    if (typeof data.publish_id !== 'string' || !data.publish_id || typeof data.upload_url !== 'string') throw new ProviderHttpError(messages.unavailable, 'rejected');
    let upload: URL;
    try { upload = new URL(data.upload_url); } catch { throw new ProviderHttpError(messages.unavailable, 'rejected'); }
    if (upload.protocol !== 'https:' || upload.username || upload.password) throw new ProviderHttpError(messages.unavailable, 'rejected');
    return { publishId: data.publish_id, uploadUrl: upload.toString() };
  }

  /** Send the bytes. TikTok may start posting once they arrive, so a lost answer is uncertain. No credentials are sent to the upload host. */
  async function sendVideo(input: { uploadUrl: string; bytes: Uint8Array; mimeType: string; signal?: AbortSignal }): Promise<void> {
    await providerRequest({
      fetch: options.fetch, url: input.uploadUrl, method: 'PUT', allowEmpty: true, committing: true, timeoutMs: policy.uploadTimeoutMs, signal: input.signal, messages,
      headers: { 'content-type': input.mimeType, 'content-range': `bytes 0-${input.bytes.byteLength - 1}/${input.bytes.byteLength}` }, body: input.bytes as unknown as BodyInit,
    });
  }

  async function publishStatus(accessToken: string, publishId: string, signal?: AbortSignal): Promise<{ state: TiktokPublishState; postId: string | null }> {
    const { json } = await providerRequest({ fetch: options.fetch, url: `${base}/post/publish/status/fetch/`, method: 'POST', headers: bearer(accessToken), body: JSON.stringify({ publish_id: publishId }), timeoutMs: policy.requestTimeoutMs, signal, messages });
    assertOk(json, false);
    const data = object(json.data); const status = data.status;
    const ids = Array.isArray(data.publicaly_available_post_id) ? data.publicaly_available_post_id : [];
    const postId = ids.map(String).find(id => /^\d+$/.test(id)) ?? null;
    if (status === 'PUBLISH_COMPLETE') return { state: 'complete', postId };
    if (status === 'FAILED') return { state: 'failed', postId: null };
    return { state: 'processing', postId: null };
  }

  return { authorizationUrl, exchange, refresh, user, privacyLevels, pickPrivacy, initVideo, sendVideo, publishStatus, messages };
}
export type TiktokApi = ReturnType<typeof createTiktokApi>;
